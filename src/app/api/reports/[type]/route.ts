// /api/reports/[type] — aggregated report data by type (soft-delete aware)
// Sprint 2: Added trainees, conflicts, todaySessions report types
import { db } from "@/lib/db";
import { withModuleAction, ok, fail } from "@/lib/auth/api";

const REPORT_TYPES = [
  "summary", "byCompany", "byCourse", "byTrainer", "byPeriod",
  "compliance", "attendance", "scores",
  // Sprint 2 new:
  "trainees", "conflicts", "todaySessions",
  // Sprint 3 multi-company:
  "attendanceByCompany", "scoresByCompany", "certificatesByCompany", "sessionParticipation",
];
const NOT_DELETED = { deletedAt: null };

export const GET = withModuleAction("reports", "view", async ({ req, params, user }) => {
  const type = params.type as string;
  if (!REPORT_TYPES.includes(type)) return fail("Invalid report type", 400);

  const url = new URL(req.url);
  const fromStr = url.searchParams.get("from");
  const toStr = url.searchParams.get("to");
  const from = fromStr ? new Date(fromStr) : new Date(new Date().getFullYear(), 0, 1);
  const to = toStr ? new Date(toStr) : new Date();

  const isContractor = user.role === "CONTRACTOR";
  // A contractor with no company assigned must see nothing, not everything: this
  // sentinel cannot match any uuid, so their scope is empty rather than absent.
  const scopedCompanyId = user.companyId ?? "__no_company__";
  const companyScope = isContractor ? { companyId: scopedCompanyId } : {};
  // Coordinator and Trainer have equivalent operational permissions — no trainer scoping.
  // Sessions carry no companyId, so a contractor is scoped through the originating
  // request or an enrolment belonging to their company. Without this, `trainerScope`
  // was an empty object and every session-derived report was org-wide.
  const trainerScope = isContractor
    ? {
        OR: [
          { request: { companyId: scopedCompanyId } },
          { enrollments: { some: { companyId: scopedCompanyId, deletedAt: null } } },
        ],
      }
    : {};
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
      // Count training requests per company
      const requestRows = await db.trainingRequest.groupBy({
        by: ["companyId"],
        where: { deletedAt: null, createdAt: { gte: from, lte: to }, ...companyScope },
        _count: { id: true },
      });

      // Also count session enrollments per company (multi-company sessions)
      const enrollmentRows = await db.sessionEnrollment.groupBy({
        by: ["companyId"],
        where: {
          deletedAt: null,
          enrollmentDate: { gte: from, lte: to },
          ...(user.role === "CONTRACTOR" && user.companyId ? { companyId: user.companyId } : {}),
        },
        _count: { id: true },
      });

      // Count certificates per company
      const certRows = await db.certificate.groupBy({
        by: ["companyId"],
        where: {
          deletedAt: null,
          issuedAt: { gte: from, lte: to },
          ...companyScope,
        },
        _count: { id: true },
      });

      // Merge all company IDs
      const allCompanyIds = new Set<string>();
      requestRows.forEach((r) => allCompanyIds.add(r.companyId));
      enrollmentRows.forEach((r) => allCompanyIds.add(r.companyId));
      certRows.forEach((r) => { if (r.companyId) allCompanyIds.add(r.companyId); });

      const companies = await db.company.findMany({
        where: { id: { in: Array.from(allCompanyIds) }, ...NOT_DELETED },
      });

      return ok({
        type, from, to,
        rows: companies.map((c) => {
          const reqRow = requestRows.find((r) => r.companyId === c.id);
          const enrollRow = enrollmentRows.find((r) => r.companyId === c.id);
          const certRow = certRows.find((r) => r.companyId === c.id);
          return {
            companyName: c.name,
            companyRef: c.refNumber,
            requestCount: reqRow?._count.id ?? 0,
            enrolledTrainees: enrollRow?._count.id ?? 0,
            certificatesIssued: certRow?._count.id ?? 0,
          };
        }),
      });
    }

    case "attendanceByCompany": {
      // Attendance records grouped by trainee's company
      const rows = await db.attendance.groupBy({
        by: ["companyId"],
        where: {
          deletedAt: null,
          checkInAt: { gte: from, lte: to },
          ...(user.role === "CONTRACTOR" && user.companyId ? { companyId: user.companyId } : {}),
        },
        _count: { id: true },
      });

      const allCompanyIds = rows.map((r) => r.companyId).filter(Boolean) as string[];
      const companies = await db.company.findMany({
        where: { id: { in: allCompanyIds }, ...NOT_DELETED },
      });

      // Also get PRESENT count per company
      const presentRows = await db.attendance.groupBy({
        by: ["companyId"],
        where: {
          deletedAt: null,
          status: "PRESENT",
          checkInAt: { gte: from, lte: to },
          ...(user.role === "CONTRACTOR" && user.companyId ? { companyId: user.companyId } : {}),
        },
        _count: { id: true },
      });

      return ok({
        type, from, to,
        rows: companies.map((c) => {
          const totalRow = rows.find((r) => r.companyId === c.id);
          const presentRow = presentRows.find((r) => r.companyId === c.id);
          const total = totalRow?._count.id ?? 0;
          const present = presentRow?._count.id ?? 0;
          return {
            companyName: c.name,
            companyRef: c.refNumber,
            totalAttendance: total,
            presentCount: present,
            attendanceRate: total > 0 ? Math.round((present / total) * 100) : null,
          };
        }),
      });
    }

    case "scoresByCompany": {
      // Exam results grouped by trainee's company (uses companyId on TestResult)
      const rows = await db.testResult.groupBy({
        by: ["companyId"],
        where: {
          deletedAt: null,
          testType: "FINAL_TEST",
          attemptedAt: { gte: from, lte: to },
          ...(user.role === "CONTRACTOR" && user.companyId ? { companyId: user.companyId } : {}),
        },
        _count: { id: true },
        _avg: { scorePercent: true },
      });

      const passedRows = await db.testResult.groupBy({
        by: ["companyId"],
        where: {
          deletedAt: null,
          testType: "FINAL_TEST",
          passed: true,
          attemptedAt: { gte: from, lte: to },
          ...(user.role === "CONTRACTOR" && user.companyId ? { companyId: user.companyId } : {}),
        },
        _count: { id: true },
      });

      const allCompanyIds = rows.map((r) => r.companyId).filter(Boolean) as string[];
      const companies = await db.company.findMany({
        where: { id: { in: allCompanyIds }, ...NOT_DELETED },
      });

      return ok({
        type, from, to,
        rows: companies.map((c) => {
          const totalRow = rows.find((r) => r.companyId === c.id);
          const passedRow = passedRows.find((r) => r.companyId === c.id);
          const total = totalRow?._count.id ?? 0;
          const passed = passedRow?._count.id ?? 0;
          return {
            companyName: c.name,
            companyRef: c.refNumber,
            totalExams: total,
            passed: passed,
            failed: total - passed,
            avgScore: totalRow?._avg.scorePercent ? Math.round(totalRow._avg.scorePercent) : null,
            passRate: total > 0 ? Math.round((passed / total) * 100) : null,
          };
        }),
      });
    }

    case "certificatesByCompany": {
      // Certificates grouped by trainee's company
      const rows = await db.certificate.groupBy({
        by: ["companyId"],
        where: {
          deletedAt: null,
          issuedAt: { gte: from, lte: to },
          ...(user.role === "CONTRACTOR" && user.companyId ? { companyId: user.companyId } : {}),
        },
        _count: { id: true },
      });

      const validRows = await db.certificate.groupBy({
        by: ["companyId"],
        where: {
          deletedAt: null,
          status: "VALID",
          issuedAt: { gte: from, lte: to },
          ...(user.role === "CONTRACTOR" && user.companyId ? { companyId: user.companyId } : {}),
        },
        _count: { id: true },
      });

      const allCompanyIds = rows.map((r) => r.companyId).filter(Boolean) as string[];
      const companies = await db.company.findMany({
        where: { id: { in: allCompanyIds }, ...NOT_DELETED },
      });

      return ok({
        type, from, to,
        rows: companies.map((c) => {
          const totalRow = rows.find((r) => r.companyId === c.id);
          const validRow = validRows.find((r) => r.companyId === c.id);
          return {
            companyName: c.name,
            companyRef: c.refNumber,
            totalCertificates: totalRow?._count.id ?? 0,
            validCertificates: validRow?._count.id ?? 0,
          };
        }),
      });
    }

    case "sessionParticipation": {
      // Shows which companies have trainees in which sessions (multi-company view)
      const sessions = await db.trainingSession.findMany({
        where: {
          ...NOT_DELETED,
          startDate: { gte: from, lte: to },
          ...trainerScope,
        },
        include: {
          course: { select: { id: true, title: true, code: true } },
          sessionCompanies: {
            include: { company: { select: { id: true, name: true, refNumber: true } } },
          },
          _count: { select: { enrollments: true, attendance: true, certificates: true } },
        },
        orderBy: { startDate: "desc" },
        take: 100,
      });

      return ok({
        type, from, to,
        rows: sessions.map((s) => ({
          sessionRef: s.refNumber,
          sessionTitle: s.title,
          courseTitle: s.course?.title ?? null,
          startDate: s.startDate,
          companies: s.sessionCompanies.map((sc) => ({
            companyName: sc.company?.name ?? null,
            companyRef: sc.company?.refNumber ?? null,
            traineeCount: sc.traineeCount,
          })),
          totalEnrollments: s._count.enrollments,
          totalAttendance: s._count.attendance,
          totalCertificates: s._count.certificates,
          isMultiCompany: s.sessionCompanies.length > 1,
        })),
        metrics: {
          totalSessions: sessions.length,
          multiCompanySessions: sessions.filter((s) => s.sessionCompanies.length > 1).length,
          totalCompanies: new Set(sessions.flatMap((s) => s.sessionCompanies.map((sc) => sc.companyId))).size,
        },
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
      return fail(`Unknown report type. Supported types: summary, trainees, conflicts, todaySessions, byCompany, attendanceByCompany, scoresByCompany, certificatesByCompany, sessionParticipation, byCourse, byTrainer, byPeriod, compliance, attendance, scores`, 400, "UNKNOWN_REPORT_TYPE");
  }
});

function q_search(req: Request): string | null {
  return new URL(req.url).searchParams.get("search");
}
