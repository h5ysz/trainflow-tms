// /api/reports/[type] — aggregated report data by type
import { db } from "@/lib/db";
import { getCurrentUser, ok, fail } from "@/lib/auth/api";

const REPORT_TYPES = ["summary", "byCompany", "byCourse", "byTrainer", "byPeriod", "compliance", "attendance", "scores"];

export async function GET(req: Request, ctx: { params: Promise<{ type: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);

  const { type } = await ctx.params;
  if (!REPORT_TYPES.includes(type)) return fail("Invalid report type", 400);

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const from = fromStr ? new Date(fromStr) : new Date(new Date().getFullYear(), 0, 1);
  const to = toStr ? new Date(toStr) : new Date();

  const companyScope = user.role === "CONTRACTOR" && user.companyId
    ? { companyId: user.companyId }
    : {};
  const trainerScope = user.role === "TRAINER" && user.trainerId
    ? { trainerId: user.trainerId }
    : {};

  const dateFilter = { startDate: { gte: from, lte: to } };

  switch (type) {
    case "summary": {
      const [sessions, requests, certs, trainees, revenue] = await Promise.all([
        db.trainingSession.count({ where: { ...dateFilter, ...trainerScope } }),
        db.trainingRequest.count({ where: { createdAt: { gte: from, lte: to }, ...companyScope } }),
        db.certificate.count({ where: { issuedAt: { gte: from, lte: to }, ...companyScope } }),
        db.attendance.groupBy({ by: ["traineeEmail"], where: { session: { ...dateFilter, ...trainerScope } } }),
        db.course.count(),
      ]);
      return ok({
        type,
        from,
        to,
        metrics: {
          totalSessions: sessions,
          totalRequests: requests,
          totalCertificates: certs,
          uniqueTrainees: trainees.length,
          totalCourses: revenue,
        },
      });
    }
    case "byCompany": {
      const rows = await db.trainingRequest.groupBy({
        by: ["companyId"],
        where: { createdAt: { gte: from, lte: to }, ...companyScope },
        _count: { id: true },
      });
      const companies = await db.company.findMany({
        where: { id: { in: rows.map((r) => r.companyId).filter(Boolean) as string[] } },
      });
      return ok({
        type,
        from,
        to,
        rows: rows.map((r) => ({
          companyName: companies.find((c) => c.id === r.companyId)?.name ?? "—",
          requestCount: r._count.id,
        })),
      });
    }
    case "byCourse": {
      const rows = await db.trainingSession.groupBy({
        by: ["courseId"],
        where: { ...dateFilter, ...trainerScope },
        _count: { id: true },
      });
      const courses = await db.course.findMany({
        where: { id: { in: rows.map((r) => r.courseId) } },
      });
      return ok({
        type,
        from,
        to,
        rows: rows.map((r) => ({
          courseTitle: courses.find((c) => c.id === r.courseId)?.title ?? "—",
          courseCode: courses.find((c) => c.id === r.courseId)?.code ?? "—",
          sessionCount: r._count.id,
        })),
      });
    }
    case "byTrainer": {
      const rows = await db.trainingSession.groupBy({
        by: ["trainerId"],
        where: { ...dateFilter, ...trainerScope },
        _count: { id: true },
      });
      const trainers = await db.trainer.findMany({
        where: { id: { in: rows.map((r) => r.trainerId).filter(Boolean) as string[] } },
      });
      return ok({
        type,
        from,
        to,
        rows: rows.map((r) => ({
          trainerName: trainers.find((t) => t.id === r.trainerId)?.fullName ?? "—",
          sessionCount: r._count.id,
        })),
      });
    }
    case "byPeriod": {
      // Group sessions by month
      const sessions = await db.trainingSession.findMany({
        where: { ...dateFilter, ...trainerScope },
        select: { startDate: true },
      });
      const grouped: Record<string, number> = {};
      for (const s of sessions) {
        const d = new Date(s.startDate);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        grouped[key] = (grouped[key] ?? 0) + 1;
      }
      return ok({
        type,
        from,
        to,
        rows: Object.entries(grouped).map(([month, count]) => ({ month, count })),
      });
    }
    case "compliance": {
      const now = new Date();
      const validCerts = await db.certificate.count({
        where: { status: "VALID", ...companyScope },
      });
      const expiredCerts = await db.certificate.count({
        where: { status: "EXPIRED", ...companyScope },
      });
      const expiringSoon = await db.certificate.count({
        where: {
          status: "VALID",
          validUntil: { gte: now, lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) },
          ...companyScope,
        },
      });
      return ok({
        type,
        from,
        to,
        metrics: { validCerts, expiredCerts, expiringSoon },
      });
    }
    case "attendance": {
      const total = await db.attendance.count({
        where: { session: { ...dateFilter, ...trainerScope } },
      });
      const present = await db.attendance.count({
        where: { status: "PRESENT", session: { ...dateFilter, ...trainerScope } },
      });
      const absent = await db.attendance.count({
        where: { status: "ABSENT", session: { ...dateFilter, ...trainerScope } },
      });
      const late = await db.attendance.count({
        where: { status: "LATE", session: { ...dateFilter, ...trainerScope } },
      });
      return ok({
        type,
        from,
        to,
        metrics: { total, present, absent, late, rate: total > 0 ? Math.round((present / total) * 100) : null },
      });
    }
    case "scores": {
      const preAvg = await db.testResult.aggregate({
        where: { testType: "PRE_TEST", attemptedAt: { gte: from, lte: to } },
        _avg: { scorePercent: true },
      });
      const finalAvg = await db.testResult.aggregate({
        where: { testType: "FINAL_TEST", attemptedAt: { gte: from, lte: to } },
        _avg: { scorePercent: true },
      });
      const passed = await db.testResult.count({
        where: { testType: "FINAL_TEST", passed: true, attemptedAt: { gte: from, lte: to } },
      });
      const failed = await db.testResult.count({
        where: { testType: "FINAL_TEST", passed: false, attemptedAt: { gte: from, lte: to } },
      });
      return ok({
        type,
        from,
        to,
        metrics: {
          preTestAvg: preAvg._avg.scorePercent ? Math.round(preAvg._avg.scorePercent) : null,
          finalTestAvg: finalAvg._avg.scorePercent ? Math.round(finalAvg._avg.scorePercent) : null,
          passed,
          failed,
          passRate: passed + failed > 0 ? Math.round((passed / (passed + failed)) * 100) : null,
        },
      });
    }
    default:
      return fail("Report type not implemented", 400);
  }
}
