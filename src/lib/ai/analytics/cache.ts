// GCCLAB AI Copilot — Phase 3 — Analytics cache
// =====================================================================
// In-memory cache with TTL + tagged invalidation. Cache is per-user-scope
// (so contractor data never leaks into a super-admin's cache and vice
// versa). Tags allow bulk invalidation when underlying data changes
// (e.g. "sessions:*" invalidates all session-related entries).
//
// Cache is process-local (single Next.js server). For multi-instance
// deployments, replace with Redis — the interface is identical.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  tags: string[];
}

const STORE = new Map<string, CacheEntry<unknown>>();
const TAG_INDEX = new Map<string, Set<string>>(); // tag → set of cache keys

// Default TTLs per data category (ms)
const TTL = {
  KPI: 60_000,           // 1 min — KPIs change frequently but not second-by-second
  CHART: 120_000,        // 2 min
  RECOMMENDATIONS: 60_000,
  RISKS: 60_000,
  FORECAST: 300_000,     // 5 min — forecasts are stable
  NL_QUERY: 120_000,
} as const;

export function getTtl(category: keyof typeof TTL): number {
  return TTL[category];
}

/**
 * Build a cache key that includes the user's scope so cached data never
 * leaks across roles or companies.
 */
export function buildKey(scope: { role: string; companyId: string | null }, ...parts: unknown[]): string {
  return [scope.role, scope.companyId ?? "none", ...parts.map(String)].join(":");
}

export function get<T>(key: string): T | null {
  const entry = STORE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    invalidate(key);
    return null;
  }
  return entry.value as T;
}

export function set<T>(key: string, value: T, ttlMs: number, tags: string[] = []): void {
  // Remove old tag associations
  invalidate(key);
  STORE.set(key, { value, expiresAt: Date.now() + ttlMs, tags });
  for (const tag of tags) {
    let set = TAG_INDEX.get(tag);
    if (!set) {
      set = new Set();
      TAG_INDEX.set(tag, set);
    }
    set.add(key);
  }
}

export function invalidate(key: string): void {
  const entry = STORE.get(key);
  if (entry) {
    for (const tag of entry.tags) {
      TAG_INDEX.get(tag)?.delete(key);
    }
  }
  STORE.delete(key);
}

export function invalidateTag(tag: string): void {
  const keys = TAG_INDEX.get(tag);
  if (!keys) return;
  for (const key of keys) {
    STORE.delete(key);
  }
  TAG_INDEX.delete(tag);
}

export function invalidateAll(): void {
  STORE.clear();
  TAG_INDEX.clear();
}

/** For tests + ops — returns the cache size. */
export function size(): number {
  return STORE.size;
}

/**
 * Wrap a function with cache. If the cache has a fresh value, return it.
 * Otherwise call the producer, cache the result, and return it.
 */
export async function cached<T>(
  key: string,
  ttlMs: number,
  tags: string[],
  producer: () => Promise<T>
): Promise<T> {
  const hit = get<T>(key);
  if (hit !== null) return hit;
  const value = await producer();
  set(key, value, ttlMs, tags);
  return value;
}
