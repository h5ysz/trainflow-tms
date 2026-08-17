// Certificate utilities: masking, validity computation, UA parsing.
// Sprint 6: enterprise certificate management helpers.
import type { Certificate } from "@prisma/client";

/** Far-future date used as a sentinel for "Never Expires" certificates. */
export const NEVER_EXPIRES_DATE = new Date("9999-12-31T23:59:59.999Z");

/**
 * Compute the `validUntil` date for a certificate from `validityMonths`.
 * - `validityMonths = 0` → Never Expires (far-future sentinel).
 * - `validityMonths > 0` → `now + validityMonths` months.
 */
export function computeValidUntil(validityMonths: number, now: Date = new Date()): Date {
  if (validityMonths <= 0) return new Date(NEVER_EXPIRES_DATE);
  const d = new Date(now);
  d.setMonth(d.getMonth() + validityMonths);
  return d;
}

/**
 * Check whether a certificate's `validUntil` represents "Never Expires".
 */
export function isNeverExpires(validUntil: Date): boolean {
  return validUntil.getFullYear() >= 9999;
}

/**
 * Mask a National ID / Iqama for display on certificates.
 * Shows first 2 + last 2 digits, masks the middle with •.
 * Example: "1002003004" → "10•••••••04"
 *          "1234567890" → "12•••••••90"
 * Returns null if input is null/empty.
 */
export function maskNationalId(id: string | null | undefined): string | null {
  if (!id) return null;
  const s = id.trim();
  if (s.length < 4) return "•".repeat(s.length);
  return `${s.slice(0, 2)}${"•".repeat(s.length - 4)}${s.slice(-2)}`;
}

/**
 * Compute certificate validity metadata for display.
 * - daysRemaining: number of days until validUntil (negative if expired)
 * - daysSinceExpiry: number of days since validUntil (0 if not expired)
 * - isExpiringSoon: true if within 30 days of expiry
 * - isExpired: true if past validUntil
 * - expiringSoonThreshold: configurable threshold (default 30 days)
 */
export function computeValidityMetadata(
  cert: { validUntil: Date; status: string },
  now: Date = new Date(),
  expiringSoonThresholdDays = 30
): {
  daysRemaining: number;
  daysSinceExpiry: number;
  isExpiringSoon: boolean;
  isExpired: boolean;
  computedStatus: string;
} {
  const msPerDay = 24 * 60 * 60 * 1000;
  const diffMs = cert.validUntil.getTime() - now.getTime();
  const daysRemaining = Math.ceil(diffMs / msPerDay);
  const daysSinceExpiry = daysRemaining < 0 ? Math.abs(daysRemaining) : 0;
  const isExpired = daysRemaining < 0;
  const isExpiringSoon = !isExpired && daysRemaining <= expiringSoonThresholdDays;

  // Computed status takes into account time-based expiry on top of stored status.
  // If cert is REVOKED, that wins. Otherwise EXPIRED if past validUntil,
  // EXPIRING_SOON if within threshold, otherwise the stored status.
  let computedStatus = cert.status;
  if (cert.status === "REVOKED") {
    computedStatus = "REVOKED";
  } else if (isExpired) {
    computedStatus = "EXPIRED";
  } else if (isExpiringSoon) {
    computedStatus = "EXPIRING_SOON";
  }
  // LEGACY: VALID maps to ISSUED for consistency with the new workflow.
  if (computedStatus === "VALID") computedStatus = "ISSUED";

  return {
    daysRemaining,
    daysSinceExpiry,
    isExpiringSoon,
    isExpired,
    computedStatus,
  };
}

/**
 * Parse a User-Agent string into browser, OS, and device.
 * Best-effort — no external dependencies. Returns null for unknown parts.
 *
 * Examples:
 *   "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
 *     → { browser: "Chrome 120", os: "Windows 10", device: "Desktop" }
 *   "Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1"
 *     → { browser: "Safari 17", os: "iOS 17", device: "iPhone" }
 */
export function parseUserAgent(ua: string | null | undefined): {
  browser: string | null;
  os: string | null;
  device: string | null;
} {
  if (!ua) return { browser: null, os: null, device: null };

  const result = { browser: null as string | null, os: null as string | null, device: null as string | null };

  // ── Browser ────────────────────────────────────────────────────────
  // Order matters — Edge contains "Chrome", Chrome contains "Safari".
  let m: RegExpMatchArray | null;
  if ((m = ua.match(/Edg(?:e|A|iOS)?\/(\d+)/))) {
    result.browser = `Edge ${m[1]}`;
  } else if ((m = ua.match(/OPR\/(\d+)/))) {
    result.browser = `Opera ${m[1]}`;
  } else if ((m = ua.match(/Firefox\/(\d+)/))) {
    result.browser = `Firefox ${m[1]}`;
  } else if ((m = ua.match(/Chrome\/(\d+)/))) {
    result.browser = `Chrome ${m[1]}`;
  } else if ((m = ua.match(/Version\/(\d+).*Safari/))) {
    result.browser = `Safari ${m[1]}`;
  } else {
    result.browser = "Unknown";
  }

  // ── OS ─────────────────────────────────────────────────────────────
  if ((m = ua.match(/Windows NT (\d+\.\d+)/))) {
    const v = m[1];
    result.os = v === "10.0" ? "Windows 10/11" : `Windows ${v}`;
  } else if ((m = ua.match(/Mac OS X (\d+[._]\d+)/))) {
    result.os = `macOS ${m[1].replace("_", ".")}`;
  } else if ((m = ua.match(/Android (\d+)/))) {
    result.os = `Android ${m[1]}`;
  } else if ((m = ua.match(/iPhone OS (\d+[._]\d+)/))) {
    result.os = `iOS ${m[1].replace("_", ".")}`;
  } else if ((m = ua.match(/Linux/))) {
    result.os = "Linux";
  } else {
    result.os = "Unknown";
  }

  // ── Device ─────────────────────────────────────────────────────────
  if (/iPad/.test(ua)) {
    result.device = "iPad";
  } else if (/iPhone/.test(ua)) {
    result.device = "iPhone";
  } else if (/Android/.test(ua)) {
    result.device = /Mobile/.test(ua) ? "Android Phone" : "Android Tablet";
  } else if (/Mobile/.test(ua)) {
    result.device = "Mobile";
  } else {
    result.device = "Desktop";
  }

  return result;
}

/**
 * Format a date for PDF display: "15 January 2026"
 */
export function formatPdfDate(date: Date): string {
  return date.toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * Format a validity period in months as a human-readable string.
 * Example: 24 → "24 Months", 12 → "12 Months"
 */
export function formatValidityMonths(months: number): string {
  if (months === 1) return "1 Month";
  if (months === 12) return "1 Year";
  if (months % 12 === 0) return `${months / 12} Years`;
  return `${months} Months`;
}
