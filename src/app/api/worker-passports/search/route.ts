// /api/worker-passports/search — search by National ID / Iqama / QR token / Passport #
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, fail, companyScope } from "@/lib/auth/api";
import { calculateCompliance } from "@/lib/worker/compliance-engine";

export const GET = withErrorEnvelope(async function GET(req: Request) {
  const user = await requireRole("SUPER_ADMIN", "COORDINATOR", "CONTRACTOR");

  const url = new URL(req.url);
  const query = (url.searchParams.get("q") || "").trim();
  if (!query) return fail("Query parameter 'q' is required", 422, "VALIDATION_ERROR");

  // Search by nationalId, passportNumber, or qrToken
  const where: Record<string, unknown> = {
    deletedAt: null,
    OR: [
      { nationalId: { contains: query } },
      { passportNumber: { contains: query } },
      { qrToken: { contains: query } },
    ],
  };

  // Company scope for contractors
  const scope = companyScope(user);
  if (scope) Object.assign(where, scope);

  const passports = await db.workerPassport.findMany({
    where,
    include: {
      company: { select: { id: true, name: true } },
      certificates: {
        where: { deletedAt: null, status: { not: "REVOKED" } },
        select: {
          id: true,
          refNumber: true,
          status: true,
          issuedAt: true,
          validUntil: true,
          courseId: true,
          course: { select: { id: true, code: true, title: true, validityMonths: true } },
        },
        orderBy: { issuedAt: "desc" },
      },
    },
    take: 20,
  });

  const results = await Promise.all(
    passports.map(async (p) => {
      const compliance = await calculateCompliance(
        { nationalId: p.nationalId, companyId: p.companyId, jobTitle: p.jobTitle },
        p.certificates
      );
      return {
        id: p.id,
        passportNumber: p.passportNumber,
        nationalId: p.nationalId,
        fullName: p.fullName,
        companyName: p.company?.name ?? null,
        jobTitle: p.jobTitle,
        qrToken: p.qrToken,
        compliancePercent: compliance.compliancePercent,
        complianceLevel: compliance.level,
        totalActive: compliance.totalCompleted,
        totalExpired: compliance.totalExpired,
        totalExpiringSoon: compliance.totalExpiringSoon,
      };
    })
  );

  return ok({ results, count: results.length });
});
