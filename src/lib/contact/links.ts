// GCCLAB TMS — Contact link helpers
// =====================================================================
// Pure functions used by the trainer "contact & follow-up" panel to turn a
// stored phone / email value into a usable `tel:` / `mailto:` href.
//
// Both are deliberately conservative: a value that is empty, whitespace-only,
// or not a plausible phone number yields null, so the UI renders
// "غير متوفر / Not available" instead of a dead call button.
// =====================================================================

/**
 * Build a `tel:` href from a stored number. Returns null when the value is
 * missing or does not contain at least 7 phone digits — the caller must then
 * show "not available" instead of a call button.
 */
export function telHref(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d+]/g, "");
  return digits.length >= 7 ? `tel:${digits}` : null;
}

/**
 * Build a `mailto:` href from a stored email. Returns null when missing.
 */
export function mailHref(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  return `mailto:${value.trim()}`;
}
