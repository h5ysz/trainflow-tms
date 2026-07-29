// Canonical URLs for the two public, token-addressed pages.
//
// These strings used to be built inline in two places that disagreed with reality:
// the QR endpoint emitted "/check-in?token=…" for a page that did not exist, and the
// certificate PDF printed `${req.headers.get("origin") ?? ""}/verify/${token}` — a
// route that also did not exist, and which degraded to a hostless "/verify/…" whenever
// the Origin header was absent (which it is for most non-browser callers).

/**
 * Absolute origin for links that leave the app (printed on PDFs, encoded into QR codes).
 *
 * APP_URL wins because it is the only source that is correct when there is no browser
 * in the loop. The request headers are the fallback for local development.
 */
export function resolveOrigin(req?: Request): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  if (req) {
    const origin = req.headers.get("origin");
    if (origin) return origin.replace(/\/+$/, "");

    const host = req.headers.get("host");
    if (host) {
      const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
      return `${proto}://${host}`;
    }
  }

  return "";
}

export function buildCheckInUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/check-in?token=${encodeURIComponent(token)}`;
}

export function buildVerifyUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/verify/${encodeURIComponent(token)}`;
}
