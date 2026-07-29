// Settings that must never be returned to a client, and the category each known key
// belongs to.

/**
 * Keys whose values are encrypted at rest and never sent to the browser.
 * `GET /api/settings` reports `{ value: "", isSet: boolean }` for these instead.
 */
export const SECRET_SETTING_KEYS = new Set<string>(["email.smtpPassword"]);

export function isSecretSetting(key: string): boolean {
  return SECRET_SETTING_KEYS.has(key);
}

/**
 * Category for a setting key, derived from its prefix.
 *
 * The bulk-update handler used to default every newly created key to "GENERAL" because
 * the UI sent no category, so settings drifted out of the tab they were edited on and
 * the Settings page gradually lost its grouping.
 */
const CATEGORY_BY_PREFIX: Array<[string, string]> = [
  ["email.", "EMAIL"],
  ["notif.", "NOTIFICATION"],
  ["brand.", "BRANDING"],
  ["branding.", "BRANDING"],
  ["security.", "SECURITY"],
  ["auth.", "SECURITY"],
  ["reports.", "SYSTEM"],
  ["scheduler.", "SYSTEM"],
  ["system.", "SYSTEM"],
];

export function categoryForKey(key: string, fallback = "GENERAL"): string {
  for (const [prefix, category] of CATEGORY_BY_PREFIX) {
    if (key.startsWith(prefix)) return category;
  }
  return fallback;
}
