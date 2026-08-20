// In-process memory of recently generated AI question drafts per course. The
// route uses it so that regenerating the same material in the same session does
// not reproduce the same questions even before they are approved into the bank.
// Kept in its own module so tests can reset it without importing the route.

const MAX_RECENT_DRAFTS = 120;

const recentDraftStems = new Map<string, string[]>();

function dedupeStems(stems: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of stems) {
    const n = s.trim().toLowerCase().replace(/\s+/g, " ");
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(s);
  }
  return out;
}

/** Stems of drafts previously generated for a course in this process. */
export function sessionDraftStems(courseId: string): string[] {
  return recentDraftStems.get(courseId) ?? [];
}

/** Record the stems of a newly generated batch for a course. */
export function rememberDraftStems(courseId: string, stems: string[]): void {
  const prev = recentDraftStems.get(courseId) ?? [];
  const merged = dedupeStems([...prev, ...stems]);
  recentDraftStems.set(courseId, merged.slice(-MAX_RECENT_DRAFTS));
}

/** Test-only: clear the memory. */
export function _resetDraftMemory(): void {
  recentDraftStems.clear();
}

/** Clear session memory for a specific course (used on regenerate). */
export function clearDraftStems(courseId: string): void {
  recentDraftStems.delete(courseId);
}
