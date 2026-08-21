// /api/renewal/dashboard — Renewal Center dashboard
// Sprint 6: Shows certificates expiring today / this week / this month + already expired.
//
// Permissions: SUPER_ADMIN, COORDINATOR (all companies) or CONTRACTOR (own company only)
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, companyScope } from "@/lib/auth/api";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const GET = withErrorEnvelope(async function GET(req: Request) {
  const user = await requireRole("SUPER_ADMIN", "COORDINATOR", "CONTRACTOR");

  const companyFilter = companyScope(user) ?? {};

  const now = new Date();
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);
  const endOfWeek = new Date(now.getTime() + 7 * MS_PER_DAY);
  const endOfMonth = new Date(now.getTime() + 30 * MS_PER_DAY);

  const baseWhere = { ...companyFilter, deletedAt: null, status: { in: ["VALID", "ISSUED"] } };

  const [
    expiringToday,
    expiringThisWeek,
    expiringThisMonth,
    alreadyExpired,
    totalActive,
    totalExpired,
    totalRenewed,
  ] = await Promise.all([
    // Expiring today
    db.certificate.findMany({
      where: { ...baseWhere, validUntil: { gte: now, lte: endOfToday } },
      include: {
        course: { select: { id: true, code: true, title: true, validityMonths: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { validUntil: "asc" },
      take: 50,
    }),
    // Expiring this week (after today, within 7 days)
    db.certificate.findMany({
      where: { ...baseWhere, validUntil: { gt: endOfToday, lte: endOfWeek } },
      include: {
        course: { select: { id: true, code: true, title: true, validityMonths: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { validUntil: "asc" },
      take: 50,
    }),
    // Expiring this month (after this week, within 30 days)
    db.certificate.findMany({
      where: { ...baseWhere, validUntil: { gt: endOfWeek, lte: endOfMonth } },
      include: {
        course: { select: { id: true, code: true, title: true, validityMonths: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { validUntil: "asc" },
      take: 100,
    }),
    // Already expired (not yet renewed)
    db.certificate.findMany({
      where: { ...companyFilter, deletedAt: null, status: "EXPIRED" },
      include: {
        course: { select: { id: true, code: true, title: true, validityMonths: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { validUntil: "desc" },
      take: 100,
    }),
    // Counts
    db.certificate.count({ where: baseWhere }),
    db.certificate.count({ where: { ...companyFilter, deletedAt: null, status: "EXPIRED" } }),
    db.certificate.count({ where: { ...companyFilter, deletedAt: null, status: "RENEWED" } }),
  ]);

  const formatCert = (c: typeof expiringToday[0]) => ({
    id: c.id,
    refNumber: c.refNumber,
    traineeName: c.traineeName,
    traineeIdNational: c.traineeIdNational,
    courseCode: c.course.code,
    courseTitle: c.course.title,
    companyName: c.company?.name ?? null,
    issuedAt: c.issuedAt,
    validUntil: c.validUntil,
    daysRemaining: Math.ceil((c.validUntil.getTime() - now.getTime()) / MS_PER_DAY),
    version: c.version ?? 1,
    status: c.status,
  });

  return ok({
    summary: {
      expiringTodayCount: expiringToday.length,
      expiringThisWeekCount: expiringThisWeek.length,
      expiringThisMonthCount: expiringThisMonth.length,
      alreadyExpiredCount: alreadyExpired.length,
      totalActive,
      totalExpired,
      totalRenewed,
    },
    expiringToday: expiringToday.map(formatCert),
    expiringThisWeek: expiringThisWeek.map(formatCert),
    expiringThisMonth: expiringThisMonth.map(formatCert),
    alreadyExpired: alreadyExpired.map(formatCert),
  });
});
