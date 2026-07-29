// /api/worker-passports/[id] — get a single passport with full details + compliance
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, notFound, fail } from "@/lib/auth/api";
import { calculateCompliance } from "@/lib/worker/compliance-engine";
import { getPassportWithCertificates } from "@/lib/worker/passport-service";

export const GET = withErrorEnvelope(async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SUPER_ADMIN", "COORDINATOR", "CONTRACTOR");
  const { id } = await ctx.params;

  const passport = await getPassportWithCertificates(id);
  if (!passport || passport.deletedAt) return notFound("Worker passport not found");

  // Contractors can only see their own company's passports
  if (user.role === "CONTRACTOR" && passport.companyId !== user.companyId) {
    return notFound("Worker passport not found");
  }

  // Calculate compliance
  const compliance = await calculateCompliance(
    { nationalId: passport.nationalId, companyId: passport.companyId, jobTitle: passport.jobTitle },
    passport.certificates
  );

  // Categorize certificates
  const now = new Date();
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const activeCertificates: Array<Record<string, unknown>> = [];
  const expiredCertificates: Array<Record<string, unknown>> = [];
  const expiringSoonCertificates: Array<Record<string, unknown>> = [];

  for (const cert of passport.certificates) {
    const daysRemaining = Math.ceil((cert.validUntil.getTime() - now.getTime()) / MS_PER_DAY);
    const certInfo = {
      id: cert.id,
      refNumber: cert.refNumber,
      courseCode: cert.course.code,
      courseTitle: cert.course.title,
      validityMonths: cert.course.validityMonths,
      issuedAt: cert.issuedAt,
      validUntil: cert.validUntil,
      daysRemaining,
      status: cert.status,
      finalScore: cert.finalScore,
      trainerName: cert.session.trainer?.fullName ?? null,
      sessionRef: cert.session.refNumber,
      verificationToken: cert.verificationToken,
      pdfGeneratedAt: cert.pdfGeneratedAt,
    };

    if (cert.status === "REVOKED") continue;
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
      id: passport.id,
      passportNumber: passport.passportNumber,
      nationalId: passport.nationalId,
      fullName: passport.fullName,
      companyId: passport.companyId,
      companyName: passport.company?.name ?? null,
      jobTitle: passport.jobTitle,
      mobile: passport.mobile,
      email: passport.email,
      qrToken: passport.qrToken,
      createdAt: passport.createdAt,
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
    allRequirements: compliance.requirements,
    certificateHistory: passport.certificates.map((c) => ({
      id: c.id,
      refNumber: c.refNumber,
      courseCode: c.course.code,
      courseTitle: c.course.title,
      issuedAt: c.issuedAt,
      validUntil: c.validUntil,
      status: c.status,
      verificationToken: c.verificationToken,
      pdfGeneratedAt: c.pdfGeneratedAt,
    })),
  });
});
