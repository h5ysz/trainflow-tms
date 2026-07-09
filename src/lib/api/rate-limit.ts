// GCCLAB TMS — in-memory fixed-window rate limiter
// Single-node deployment (bun + SQLite), so a module-level Map is sufficient.
// NOTE: resets on process restart and is per-process; if this app is ever scaled
// horizontally, move this to a shared store (Redis/SQLite table).

interface Bucket {
  count: number;
  resetAt: number; // epoch ms when the window rolls over
}

const buckets = new Map<string, Bucket>();

// Periodic sweep so the Map doesn't grow unbounded.
const SWEEP_INTERVAL_MS = 5 * 60_000;
let lastSweep = Date.now();

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, b] of buckets) {
    if (b.resetAt <= now) buckets.delete(key);
  }
}

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSec: number;
}

/**
 * Fixed-window rate limit. Returns { ok:false } once `limit` requests have been
 * made from the same IP within `windowMs` for the given `routeKey`.
 */
export function checkRateLimit(
  req: Request,
  routeKey: string,
  opts: { limit: number; windowMs: number }
): RateLimitResult {
  const now = Date.now();
  sweep(now);

  const key = `${clientIp(req)}:${routeKey}`;
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { ok: true, remaining: opts.limit - 1, retryAfterSec: 0 };
  }

  existing.count += 1;
  if (existing.count > opts.limit) {
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { ok: true, remaining: opts.limit - existing.count, retryAfterSec: 0 };
}
