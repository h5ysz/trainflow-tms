// /api/certificates/verify — public QR verification endpoint
// GET /api/certificates/verify?token=... → returns certificate info (no auth required)
//
// The lookup, validity rule and side effect live in @/lib/certificates/verify so the
// public /verify page can reuse them without going through HTTP — and without
// double-counting the verification.
import { ok, fail } from "@/lib/auth/api";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";
import {
  lookupCertificate,
  computeValidity,
  recordVerification,
  publicCertificateView,
} from "@/lib/certificates/verify";

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, "certificates:verify", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return fail("Too many verification requests. Please try again shortly.", 429, "RATE_LIMITED");

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return fail("Verification token is required", 400, "VALIDATION_ERROR");

  const cert = await lookupCertificate(token);
  if (!cert) return fail("Certificate not found or invalid token", 404, "NOT_FOUND");

  await recordVerification({
    certificateId: cert.id,
    token,
    ipAddress: req.headers.get("x-forwarded-for"),
    userAgent: req.headers.get("user-agent"),
    channel: "API",
  });

  const validity = computeValidity(cert);

  // `valid` is preserved for existing integrations; `validity` is the finer-grained
  // value that distinguishes expired from revoked.
  return ok({
    valid: validity === "VALID",
    validity,
    certificate: publicCertificateView(cert),
  });
}
