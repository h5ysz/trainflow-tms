// /api/reports/[type] — aggregated report data by type (soft-delete aware)
// Sprint 2: Added trainees, conflicts, todaySessions report types
import { db } from "@/lib/db";
import { getCurrentUser, ok, fail } from "@/lib/auth/api";

const REPORT_TYPES = [
  "summary", "byCompany", "byCourse", "byTrainer", "byPeriod",
  "compliance", "attendance", "scores",
  // Sprint 2 new:
  "trainees", "conflicts", "todaySessions",
];
const NOT_DELETED = { deletedAt: null };

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

  const companyScope = user.role === "CONTRACTOR" && user.companyId ? { companyId: user.companyId } : {};
  const trainerScope = user.role === "TRAINER" && user.trainerId ? { trainerId: user.trainerId } : {};
  const dateFilter = { startDate: { gte: from, lte: to } };

  switch (type) {
    case "summary": {
      const [sessions, requests, certs, trainees, courseCount, companiesCount, trainersCount, traineesTotal] = await Promise.all([
        db.trainingSession.count({ where: { ...NOT_DELETED, ...dateFilter, ...trainerScope } }),
        db.trainingRequest.count({ where: { deletedAt: null, createdAt: { gte: from, lte: to }, ...companyScope } }),
        db.certificate.count({ where: { deletedAt: null, issuedAt: { gte: from, lte: to }, ...companyScope } }),
        db.attendance.groupBy({ by: ["traineeEmail"], where: { deletedAt: null, session: { ...NOT_DELETED, ...dateFilter, ...trainerScope } } }),
        db.course.count({ where: NOT_DELETED }),
        db.company.count({ where: NOT_DELETED }),
        db.trainer.count({ where: { ...NOT_DELETED, status: "ACTIVE" } }),
        db.trainee.count({ where: { ...NOT_DELETED, ...companyScope } }),
      ]);
      return ok({
        type, from, to,
        metrics: {
          totalSessions: sessions,
          totalRequests: requests,
          totalCertificates: certs,
          uniqueTrainees: trainees.length,
          totalCourses: courseCount,
          totalCompanies: companiesCount,
          activeTrainers: trainersCount,
          totalTrainees: traineesTotal,
        },
      });
    }

    case "trainees": {
      // Trainees report — by company, with their request count
      const where: Record<string, unknown> = { ...NOT_DELETED, ...companyScope };
      if (q_search(req)) {
        where.OR = [
          { fullName: { contains: q_search(req) } },
          { nationalId: { contains: q_search(req) } },
        ];
      }
      const [rows, total] = await Promise.all([
        db.trainee.findMany({
          where,
          include: {
            company: { select: { id: true, name: true, refNumber: true } },
            _count: { select: { requestCourses: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 200,
        }),
        db.trainee.count({ where }),
      ]);
      return ok({
        type, from, to,
        metrics: { totalTrainees: total },
        rows: rows.map((t) => ({
          refNumber: t.refNumber,
          fullName: t.fullName,
          nationalId: t.nationalId,
          nationality: t.nationality,
          jobTitle: t.jobTitle,
          mobile: t.mobile,
          email: t.email,
          companyName: t.company?.name ?? null,
          companyRef: t.company?.refNumber ?? null,
          status: t.status,
          requestsCount: t._count.requestCourses,
        })),
      });
    }

    case "conflicts": {
      // Trainer scheduling conflicts report
      const sessions = await db.trainingSession.findMany({
        where: {
          ...NOT_DELETED,
          trainerId: { not: null },
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
          ...(from || to ? { startDate: { gte: from, lte: to } } : {}),
        },
        include: {
          trainer: { select: { id: true, fullName: true, refNumber: true } },
          course: { select: { id: true, title: true, code: true } },
        },
        orderBy: { startDate: "asc" },
      });

      // Group by trainer, find overlaps
      const byTrainer = new Map<string, typeof sessions>();
      for (const s of sessions) {
        if (!s.trainerId) continue;
        const arr = byTrainer.get(s.trainerId) ?? [];
        arr.push(s);
        byTrainer.set(s.trainerId, arr);
      }

      const conflictPairs: Array<{
        trainerName: string;
        trainerRef: string;
        session1: { refNumber: string; title: string; startDate: Date; endDate: Date };
        session2: { refNumber: string; title: string; startDate: Date; endDate: Date };
      }> = [];

      for (const [, arr] of byTrainer) {
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            if (arr[i].startDate < arr[j].endDate && arr[j].startDate < arr[i].endDate) {
              conflictPairs.push({
                trainerName: arr[i].trainer?.fullName ?? "—",
                trainerRef: arr[i].trainer?.refNumber ?? "—",
                session1: {
                  refNumber: arr[i].refNumber,
                  title: arr[i].title,
                  startDate: arr[i].startDate,
                  endDate: arr[i].endDate,
                },
                session2: {
                  refNumber: arr[j].refNumber,
                  title: arr[j].title,
                  startDate: arr[j].startDate,
                  endDate: arr[j].endDate,
                },
              });
            }
          }
        }
      }

      return ok({
        type, from, to,
        metrics: {
          totalConflicts: conflictPairs.length,
          affectedTrainers: new Set(conflictPairs.map((c) => c.trainerRef)).size,
        },
        rows: conflictPairs,
      });
    }

    case "todaySessions": {
      const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));
      const endOfToday = new Date(new Date().setHours(23, 59, 59, 999));

      const sessions = await db.trainingSession.findMany({
        where: {
          ...NOT_DELETED,
          ...trainerScope,
          startDate: { gte: startOfToday, lte: endOfToday },
        },
        include: {
          course: { select: { id: true, title: true, code: true, refNumber: true } },
          trainer: { select: { id: true, fullName: true, refNumber: true } },
          _count: { select: { attendance: true, certificates: true } },
        },
        orderBy: { startDate: "asc" },
      });

      return ok({
        type,
        from: startOfToday,
        to: endOfToday,
        metrics: {
          totalSessions: sessions.length,
          morningSessions: sessions.filter((s) => s.shift === "MORNING").length,
          eveningSessions: sessions.filter((s) => s.shift === "EVENING").length,
          withTrainer: sessions.filter((s) => s.trainerId).length,
          withoutTrainer: sessions.filter((s) => !s.trainerId).length,
        },
        rows: sessions.map((s) => ({
          refNumber: s.refNumber,
          title: s.title,
          courseTitle: s.course?.title ?? null,
          courseCode: s.course?.code ?? null,
          trainerName: s.trainer?.fullName ?? null,
          trainerRef: s.trainer?.refNumber ?? null,
          shift: s.shift,
          startDate: s.startDate,
          endDate: s.endDate,
          city: s.city,
          venue: s.venue,
          status: s.status,
          attendanceCount: s._count.attendance,
          certificatesCount: s._count.certificates,
        })),
      });
    }

    case "byCompany": {
      const rows = await db.trainingRequest.groupBy({
        by: ["companyId"],
        where: { deletedAt: null, createdAt: { gte: from, lte: to }, ...companyScope },
        _count: { id: true },
      });
      const companies = await db.company.findMany({
        where: { id: { in: rows.map((r) => r.companyId).filter(Boolean) as string[] }, ...NOT_DELETED },
      });
      return ok({
        type, from, to,
        rows: rows.map((r) => ({
          companyName: companies.find((c) => c.id === r.companyId)?.name ?? "—",
          companyRef: companies.find((c) => c.id === r.companyId)?.refNumber ?? null,
          requestCount: r._count.id,
        })),
      });
    }
    case "byCourse": {
      const rows = await db.trainingSession.groupBy({
        by: ["courseId"],
        where: { ...NOT_DELETED, ...dateFilter, ...trainerScope },
        _count: { id: true },
      });
      const courses = await db.course.findMany({
        where: { id: { in: rows.map((r) => r.courseId) }, ...NOT_DELETED },
      });
      return ok({
        type, from, to,
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
        where: { ...NOT_DELETED, ...dateFilter, ...trainerScope },
        _count: { id: true },
      });
      const trainers = await db.trainer.findMany({
        where: { id: { in: rows.map((r) => r.trainerId).filter(Boolean) as string[] }, ...NOT_DELETED },
      });
      return ok({
        type, from, to,
        rows: rows.map((r) => ({
          trainerName: trainers.find((t) => t.id === r.trainerId)?.fullName ?? "—",
          trainerRef: trainers.find((t) => t.id === r.trainerId)?.refNumber ?? null,
          sessionCount: r._count.id,
        })),
      });
    }
    case "byPeriod": {
      const sessions = await db.trainingSession.findMany({
        where: { ...NOT_DELETED, ...dateFilter, ...trainerScope },
        select: { startDate: true },
      });
      const grouped: Record<string, number> = {};
      for (const s of sessions) {
        const d = new Date(s.startDate);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        grouped[key] = (grouped[key] ?? 0) + 1;
      }
      return ok({
        type, from, to,
        rows: Object.entries(grouped).map(([month, count]) => ({ month, count })),
      });
    }
    case "compliance": {
      const now = new Date();
      const validCerts = await db.certificate.count({ where: { deletedAt: null, status: "VALID", ...companyScope } });
      const expiredCerts = await db.certificate.count({ where: { deletedAt: null, status: "EXPIRED", ...companyScope } });
      const expiringSoon = await db.certificate.count({
        where: {
          deletedAt: null, status: "VALID",
          validUntil: { gte: now, lte: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000) },
          ...companyScope,
        },
      });
      return ok({
        type, from, to,
        metrics: { validCerts, expiredCerts, expiringSoon },
      });
    }
    case "attendance": {
      const total = await db.attendance.count({ where: { deletedAt: null, session: { ...NOT_DELETED, ...dateFilter, ...trainerScope } } });
      const present = await db.attendance.count({ where: { deletedAt: null, status: "PRESENT", session: { ...NOT_DELETED, ...dateFilter, ...trainerScope } } });
      const absent = await db.attendance.count({ where: { deletedAt: null, status: "ABSENT", session: { ...NOT_DELETED, ...dateFilter, ...trainerScope } } });
      const late = await db.attendance.count({ where: { deletedAt: null, status: "LATE", session: { ...NOT_DELETED, ...dateFilter, ...trainerScope } } });
      return ok({
        type, from, to,
        metrics: { total, present, absent, late, rate: total > 0 ? Math.round((present / total) * 100) : null },
      });
    }
    case "scores": {
      const preAvg = await db.testResult.aggregate({
        where: { deletedAt: null, testType: "PRE_TEST", attemptedAt: { gte: from, lte: to } },
        _avg: { scorePercent: true },
      });
      const finalAvg = await db.testResult.aggregate({
        where: { deletedAt: null, testType: "FINAL_TEST", attemptedAt: { gte: from, lte: to } },
        _avg: { scorePercent: true },
      });
      const passed = await db.testResult.count({
        where: { deletedAt: null, testType: "FINAL_TEST", passed: true, attemptedAt: { gte: from, lte: to } },
      });
      const failed = await db.testResult.count({
        where: { deletedAt: null, testType: "FINAL_TEST", passed: false, attemptedAt: { gte: from, lte: to } },
      });
      return ok({
        type, from, to,
        metrics: {
          preTestAvg: preAvg._avg.scorePercent ? Math.round(preAvg._avg.scorePercent) : null,
          finalTestAvg: finalAvg._avg.scorePercent ? Math.round(finalAvg._avg.scorePercent) : null,
          passed, failed,
          passRate: passed + failed > 0 ? Math.round((passed / (passed + failed)) * 100) : null,
        },
      });
    }
    default:
      return fail("Report type not implemented", 400);
  }
}

function q_search(req: Request): string | null {
  return new URL(req.url).searchParams.get("search");
}
