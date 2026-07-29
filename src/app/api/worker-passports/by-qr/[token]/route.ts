// /api/worker-passports/by-qr/[token] — public endpoint: get passport by QR token
// No auth required — this is what loads when someone scans the worker's QR code.
import { db } from "@/lib/db";
import { ok, fail } from "@/lib/auth/api";
import { getPassportByQrToken } from "@/lib/worker/passport-service";
import { calculateCompliance } from "@/lib/worker/compliance-engine";

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  const passport = await getPassportByQrToken(token);
  if (!passport || passport.deletedAt) {
    return fail("Worker passport not found", 404, "NOT_FOUND");
  }

  // Fetch certificates for compliance calculation
  const certificates = await db.certificate.findMany({
    where: {
      workerPassportId: passport.id,
      deletedAt: null,
      status: { not: "REVOKED" },
    },
    include: {
      course: { select: { id: true, code: true, title: true, validityMonths: true } },
      session: {
        select: {
          id: true,
          refNumber: true,
          startDate: true,
          endDate: true,
          trainer: { select: { fullName: true } },
        },
      },
    },
    orderBy: { issuedAt: "desc" },
  });

  const compliance = await calculateCompliance(
    { nationalId: passport.nationalId, companyId: passport.companyId, jobTitle: passport.jobTitle },
    certificates
  );

  // Categorize certificates
  const now = new Date();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const activeCertificates: Array<Record<string, unknown>> = [];
  const expiredCertificates: Array<Record<string, unknown>> = [];
  const expiringSoonCertificates: Array<Record<string, unknown>> = [];

  for (const cert of certificates) {
    const daysRemaining = Math.ceil((cert.validUntil.getTime() - now.getTime()) / MS_PER_DAY);
    const certInfo = {
      refNumber: cert.refNumber,
      courseCode: cert.course.code,
      courseTitle: cert.course.title,
      issuedAt: cert.issuedAt,
      validUntil: cert.validUntil,
      daysRemaining,
      status: cert.status,
      finalScore: cert.finalScore,
      trainerName: cert.session.trainer?.fullName ?? null,
    };

    if (daysRemaining < 0) {
      expiredCertificates.push(certInfo);
    } else if (daysRemaining <= 60) {
      expiringSoonCertificates.push(certInfo);
    } else {
      activeCertificates.push(certInfo);
    }
  }

  return ok({
    passport: {
      passportNumber: passport.passportNumber,
      fullName: passport.fullName,
      companyName: passport.company?.name ?? null,
      jobTitle: passport.jobTitle,
    },
    compliance: {
      percent: compliance.compliancePercent,
      level: compliance.level,
      totalRequired: compliance.totalRequired,
      totalCompleted: compliance.totalCompleted,
      totalMissing: compliance.totalMissing,
      totalExpired: compliance.totalExpired,
      totalExpiringSoon: compliance.totalExpiringSoon,
    },
    activeCertificates,
    expiredCertificates,
    expiringSoonCertificates,
    remainingRequiredCourses: compliance.requirements
      .filter((r) => r.status !== "VALID")
      .map((r) => ({
        courseCode: r.courseCode,
        courseTitle: r.courseTitle,
        status: r.status,
        isCoreMandatory: r.isCoreMandatory,
      })),
    allRequirements: compliance.requirements.map((r) => ({
      courseCode: r.courseCode,
      courseTitle: r.courseTitle,
      status: r.status,
      isCoreMandatory: r.isCoreMandatory,
      hasValidCertificate: r.hasValidCertificate,
    })),
  });
}
