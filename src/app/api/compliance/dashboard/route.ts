// /api/compliance/dashboard — enterprise compliance dashboard
// =====================================================================
// Sprint 6: Compliance Dashboard
//
// Returns certificate statistics by expiry window + status, plus
// per-company breakdown for company-scoped views.
//
// Auth: SUPER_ADMIN or COORDINATOR (global view)
//       CONTRACTOR sees only their own company's data
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok } from "@/lib/auth/api";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const GET = withErrorEnvelope(async function GET(req: Request) {
  const user = await requireRole("SUPER_ADMIN", "COORDINATOR", "CONTRACTOR");

  // Company scope: contractors see only their own company
  const companyFilter = user.role === "CONTRACTOR" && user.companyId
    ? { companyId: user.companyId }
    : {};

  const now = new Date();
  const inDays = (n: number) => new Date(now.getTime() + n * MS_PER_DAY);

  // ── Count certificates by expiry window ────────────────────────────
  const [
    expiring180,
    expiring90,
    expiring30,
    expired,
    valid,
    revoked,
    issued,
    pendingApproval,
    verifiedCount,
  ] = await Promise.all([
    // Expiring within 180 days (and not already expired)
    db.certificate.count({
      where: {
        ...companyFilter,
        deletedAt: null,
        status: { in: ["ISSUED", "VALID"] },
        validUntil: { gte: now, lte: inDays(180) },
      },
    }),
    // Expiring within 90 days
    db.certificate.count({
      where: {
        ...companyFilter,
        deletedAt: null,
        status: { in: ["ISSUED", "VALID"] },
        validUntil: { gte: now, lte: inDays(90) },
      },
    }),
    // Expiring within 30 days
    db.certificate.count({
      where: {
        ...companyFilter,
        deletedAt: null,
        status: { in: ["ISSUED", "VALID"] },
        validUntil: { gte: now, lte: inDays(30) },
      },
    }),
    // Expired (past validUntil, not revoked)
    db.certificate.count({
      where: {
        ...companyFilter,
        deletedAt: null,
        status: { not: "REVOKED" },
        validUntil: { lt: now },
      },
    }),
    // Valid (current + not expired + not revoked)
    db.certificate.count({
      where: {
        ...companyFilter,
        deletedAt: null,
        status: { in: ["ISSUED", "VALID"] },
        validUntil: { gte: now },
      },
    }),
    // Revoked
    db.certificate.count({
      where: {
        ...companyFilter,
        deletedAt: null,
        status: "REVOKED",
      },
    }),
    // Issued (total ever issued)
    db.certificate.count({
      where: {
        ...companyFilter,
        deletedAt: null,
        status: { in: ["ISSUED", "VALID", "EXPIRED"] },
      },
    }),
    // Pending approval
    db.certificate.count({
      where: {
        ...companyFilter,
        deletedAt: null,
        status: "PENDING_APPROVAL",
      },
    }),
    // Total verifications
    db.certificateVerification.count({
      where: {
        certificate: { ...companyFilter, deletedAt: null },
      },
    }),
  ]);

  // ── Per-company breakdown (only for SUPER_ADMIN/COORDINATOR) ────────
  let byCompany: Array<{
    companyId: string;
    companyName: string;
    valid: number;
    expiringSoon: number;
    expired: number;
    pendingApproval: number;
    total: number;
  }> = [];

  if (user.role !== "CONTRACTOR") {
    const companies = await db.company.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });

    byCompany = await Promise.all(
      companies.map(async (c) => {
        const [v, es, ex, pa, t] = await Promise.all([
          db.certificate.count({
            where: { companyId: c.id, deletedAt: null, status: { in: ["ISSUED", "VALID"] }, validUntil: { gte: now } },
          }),
          db.certificate.count({
            where: { companyId: c.id, deletedAt: null, status: { in: ["ISSUED", "VALID"] }, validUntil: { gte: now, lte: inDays(30) } },
          }),
          db.certificate.count({
            where: { companyId: c.id, deletedAt: null, status: { not: "REVOKED" }, validUntil: { lt: now } },
          }),
          db.certificate.count({
            where: { companyId: c.id, deletedAt: null, status: "PENDING_APPROVAL" },
          }),
          db.certificate.count({
            where: { companyId: c.id, deletedAt: null },
          }),
        ]);
        return {
          companyId: c.id,
          companyName: c.name,
          valid: v,
          expiringSoon: es,
          expired: ex,
          pendingApproval: pa,
          total: t,
        };
      })
    );
  }

  // ── Per-course breakdown ───────────────────────────────────────────
  const courses = await db.course.findMany({
    where: { deletedAt: null },
    select: { id: true, code: true, title: true, validityMonths: true },
    orderBy: { title: "asc" },
  });

  const byCourse = await Promise.all(
    courses.map(async (c) => {
      const [v, es, ex, pa] = await Promise.all([
        db.certificate.count({
          where: { courseId: c.id, deletedAt: null, status: { in: ["ISSUED", "VALID"] }, validUntil: { gte: now } },
        }),
        db.certificate.count({
          where: { courseId: c.id, deletedAt: null, status: { in: ["ISSUED", "VALID"] }, validUntil: { gte: now, lte: inDays(30) } },
        }),
        db.certificate.count({
          where: { courseId: c.id, deletedAt: null, status: { not: "REVOKED" }, validUntil: { lt: now } },
        }),
        db.certificate.count({
          where: { courseId: c.id, deletedAt: null, status: "PENDING_APPROVAL" },
        }),
      ]);
      return {
        courseId: c.id,
        courseCode: c.code,
        courseTitle: c.title,
        validityMonths: c.validityMonths,
        valid: v,
        expiringSoon: es,
        expired: ex,
        pendingApproval: pa,
      };
    })
  );

  return ok({
    kpis: {
      expiring180Days: expiring180,
      expiring90Days: expiring90,
      expiring30Days: expiring30,
      expired,
      valid,
      revoked,
      issued,
      pendingApproval,
      verifiedCount,
    },
    byCompany,
    byCourse,
  });
});
