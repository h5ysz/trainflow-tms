// Tolerant reader for the JSON-in-TEXT columns this schema uses (SQLite has no JSON
// type, so `metadata`, `registrationData`, `questionSet`, `recipients`, … are all
// stringified JSON).
//
// These were parsed with a bare `JSON.parse` on list endpoints. One malformed or
// truncated row — a legacy record, a partial write, a hand-edited value — threw inside
// the response mapper and took down the entire Audit Log or User Approvals page, with
// no way to recover from the UI. A single bad row should cost that row's detail, not
// the page.

/**
 * Parse a JSON text column, returning `fallback` if the value is null, empty, or not
 * valid JSON. Logs once per bad value so the corruption is still visible in the logs.
 */
export function parseJsonColumn<T>(value: string | null | undefined, fallback: T, context?: string): T {
  if (value === null || value === undefined || value === "") return fallback;
  try {
    const parsed = JSON.parse(value);
    return (parsed ?? fallback) as T;
  } catch {
    console.warn(
      `[json-column] Malformed JSON${context ? ` in ${context}` : ""}; falling back. Value starts: ${value.slice(0, 80)}`
    );
    return fallback;
  }
}
