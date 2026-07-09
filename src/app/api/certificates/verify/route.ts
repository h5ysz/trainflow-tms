// /api/certificates/verify — public QR verification endpoint
// GET /api/certificates/verify?token=... → returns certificate info (no auth required)
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/auth/api";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  const rl = checkRateLimit(req, "certificates:verify", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return fail("Too many verification requests. Please try again shortly.", 429, "RATE_LIMITED");

  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!token) return fail("Verification token is required", 400, "VALIDATION_ERROR");

  const cert = await db.certificate.findFirst({
    where: { verificationToken: token, deletedAt: null },
    include: {
      course: { select: { id: true, title: true, code: true, refNumber: true, durationHours: true } },
      session: { select: { id: true, refNumber: true, startDate: true, endDate: true } },
      company: { select: { id: true, name: true, refNumber: true } },
    },
  });

  if (!cert) return fail("Certificate not found or invalid token", 404, "NOT_FOUND");

  // Log verification (no auth — public)
  await db.certificateVerification.create({
    data: {
      certificateId: cert.id,
      verificationToken: token,
      ipAddress: req.headers.get("x-forwarded-for") ?? null,
      userAgent: req.headers.get("user-agent") ?? null,
    },
  });

  // Bump verification count
  await db.certificate.update({
    where: { id: cert.id },
    data: { verificationCount: { increment: 1 }, lastVerifiedAt: new Date() },
  });

  // Public-safe response (no PII beyond what's on the certificate)
  return ok({
    valid: cert.status === "VALID" && cert.validUntil > new Date(),
    certificate: {
      refNumber: cert.refNumber,
      traineeName: cert.traineeName,
      courseTitle: cert.course.title,
      courseCode: cert.course.code,
      finalScore: cert.finalScore,
      issuedAt: cert.issuedAt,
      validUntil: cert.validUntil,
      status: cert.status,
      sessionRef: cert.session.refNumber,
      companyName: cert.company?.name ?? null,
    },
  });
}
