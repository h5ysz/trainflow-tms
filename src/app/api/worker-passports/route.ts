// /api/worker-passports — list all worker passports
// GET — list passports with compliance summary
//
// Query params:
//   search     — search by nationalId, fullName, passportNumber
//   companyId  — filter by company
//   page, pageSize — pagination
//
// Permissions: SUPER_ADMIN / COORDINATOR see all; CONTRACTOR sees own company only.
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, companyScope } from "@/lib/auth/api";
import { calculateCompliance } from "@/lib/worker/compliance-engine";

export const GET = withErrorEnvelope(async function GET(req: Request) {
  const user = await requireRole("SUPER_ADMIN", "COORDINATOR", "CONTRACTOR");

  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const companyId = url.searchParams.get("companyId");
  const page = parseInt(url.searchParams.get("page") || "1", 10);
  const pageSize = parseInt(url.searchParams.get("pageSize") || "20", 10);

  const where: Record<string, unknown> = { deletedAt: null };

  // Company scope for contractors
  const scope = companyScope(user);
  if (scope) {
    Object.assign(where, scope);
  } else if (companyId) {
    where.companyId = companyId;
  }

  if (search) {
    where.OR = [
      { nationalId: { contains: search } },
      { fullName: { contains: search } },
      { passportNumber: { contains: search } },
      { qrToken: { contains: search } },
    ];
  }

  const [passports, total] = await Promise.all([
    db.workerPassport.findMany({
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
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.workerPassport.count({ where }),
  ]);

  // Calculate compliance for each passport
  const passportsWithCompliance = await Promise.all(
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
        totalMissing: compliance.totalMissing,
        createdAt: p.createdAt,
      };
    })
  );

  return ok({
    passports: passportsWithCompliance,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
});
