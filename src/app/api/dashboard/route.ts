// /api/dashboard — aggregated KPIs + chart data
// Sprint 2 KPIs: pending/under-review/approved requests, scheduled sessions,
// today's sessions, available trainers, trainer conflicts, companies, trainees
import { db } from "@/lib/db";
import { getCurrentUser, ok, fail } from "@/lib/auth/api";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);

  const notDeleted = { deletedAt: null };
  const companyFilter = user.role === "CONTRACTOR" && user.companyId
    ? { companyId: user.companyId }
    : {};
  // Coordinator and Trainer have equivalent operational permissions — no trainer scoping
  const trainerFilter = {};

  // ─── KPI counts (parallel for performance) ───────────────────────────
  const [
    totalSessions,
    activeTrainees,
    pendingRequests,           // NEW: DRAFT + SUBMITTED
    underReviewRequests,       // NEW: UNDER_REVIEW
    approvedRequests,          // NEW: APPROVED (not yet scheduled)
    scheduledSessions,         // NEW: SCHEDULED status
    todaySessions,             // NEW: sessions starting today
    issuedCertificates,
    expiringCerts,
    activeTrainers,
    availableTrainers,         // NEW: trainers with no overlapping sessions today/next 7 days
    trainerConflicts,          // NEW: count of sessions that have time-overlapping trainer assignments
    companiesCount,            // NEW
    traineesCount,             // NEW
    completedSessions,
    sessionsThisYear,
    certsThisYear,
  ] = await Promise.all([
    db.trainingSession.count({ where: { ...notDeleted, ...trainerFilter } }),
    db.attendance.groupBy({
      by: ["traineeEmail"],
      where: { deletedAt: null, session: { ...notDeleted, ...trainerFilter } },
    }).then((r) => r.length),
    // pendingRequests = DRAFT + SUBMITTED
    db.trainingRequest.count({
      where: {
        deletedAt: null,
        status: { in: ["DRAFT", "SUBMITTED"] },
        ...(user.role === "CONTRACTOR" && user.companyId ? { companyId: user.companyId } : {}),
      },
    }),
    // underReviewRequests = UNDER_REVIEW
    db.trainingRequest.count({
      where: {
        deletedAt: null,
        status: "UNDER_REVIEW",
        ...(user.role === "CONTRACTOR" && user.companyId ? { companyId: user.companyId } : {}),
      },
    }),
    // approvedRequests = APPROVED (ready for scheduling)
    db.trainingRequest.count({
      where: {
        deletedAt: null,
        status: "APPROVED",
        ...(user.role === "CONTRACTOR" && user.companyId ? { companyId: user.companyId } : {}),
      },
    }),
    // scheduledSessions
    db.trainingSession.count({
      where: { ...notDeleted, status: "SCHEDULED", ...trainerFilter },
    }),
    // todaySessions — sessions starting today
    db.trainingSession.count({
      where: {
        ...notDeleted,
        ...trainerFilter,
        startDate: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
          lt: new Date(new Date().setHours(23, 59, 59, 999)),
        },
      },
    }),
    db.certificate.count({ where: { deletedAt: null, ...companyFilter } }),
    db.certificate.count({
      where: {
        deletedAt: null,
        ...companyFilter,
        status: "VALID",
        validUntil: { gte: new Date(), lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      },
    }),
    db.trainer.count({ where: { ...notDeleted, status: "ACTIVE" } }),
    // availableTrainers = ACTIVE trainers with no sessions starting in next 7 days
    (async () => {
      const now = new Date();
      const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const busyTrainerIds = await db.trainingSession.findMany({
        where: {
          deletedAt: null,
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
          startDate: { gte: now, lte: sevenDaysLater },
        },
        select: { trainerId: true },
        distinct: ["trainerId"],
      });
      const busySet = new Set(busyTrainerIds.map((s) => s.trainerId).filter(Boolean) as string[]);
      const activeTrainersList = await db.trainer.findMany({
        where: { deletedAt: null, status: "ACTIVE" },
        select: { id: true },
      });
      return activeTrainersList.filter((t) => !busySet.has(t.id)).length;
    })(),
    // trainerConflicts — count of overlapping session pairs per trainer
    (async () => {
      // Get all scheduled/in-progress sessions with trainer assigned
      const sessions = await db.trainingSession.findMany({
        where: {
          deletedAt: null,
          trainerId: { not: null },
          status: { in: ["SCHEDULED", "IN_PROGRESS"] },
        },
        select: { id: true, trainerId: true, startDate: true, endDate: true },
        orderBy: { startDate: "asc" },
      });
      // Group by trainer, count overlaps
      const byTrainer = new Map<string, typeof sessions>();
      for (const s of sessions) {
        if (!s.trainerId) continue;
        const arr = byTrainer.get(s.trainerId) ?? [];
        arr.push(s);
        byTrainer.set(s.trainerId, arr);
      }
      let conflictPairs = 0;
      for (const [, arr] of byTrainer) {
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            if (arr[i].startDate < arr[j].endDate && arr[j].startDate < arr[i].endDate) {
              conflictPairs++;
            }
          }
        }
      }
      return conflictPairs;
    })(),
    // companiesCount
    db.company.count({ where: notDeleted }),
    // traineesCount
    db.trainee.count({
      where: {
        ...notDeleted,
        ...(user.role === "CONTRACTOR" && user.companyId ? { companyId: user.companyId } : {}),
      },
    }),
    db.trainingSession.count({ where: { ...notDeleted, status: "COMPLETED", ...trainerFilter } }),
    db.trainingSession.count({
      where: {
        ...notDeleted,
        startDate: { gte: new Date(new Date().getFullYear(), 0, 1) },
        ...trainerFilter,
      },
    }),
    db.certificate.count({
      where: {
        deletedAt: null,
        issuedAt: { gte: new Date(new Date().getFullYear(), 0, 1) },
        ...companyFilter,
      },
    }),
  ]);

  // ─── Charts ──────────────────────────────────────────────────────────
  // Sessions by month (last 12 months)
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
  twelveMonthsAgo.setDate(1);
  twelveMonthsAgo.setHours(0, 0, 0, 0);

  const sessionsByMonthRaw = await db.trainingSession.findMany({
    where: { deletedAt: null, startDate: { gte: twelveMonthsAgo }, ...trainerFilter },
    select: { startDate: true, status: true },
  });

  const sessionsByMonth: { month: string; count: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const count = sessionsByMonthRaw.filter((s) => {
      const sd = new Date(s.startDate);
      return `${sd.getFullYear()}-${String(sd.getMonth() + 1).padStart(2, "0")}` === key;
    }).length;
    sessionsByMonth.push({ month: key, count });
  }

  // Requests by status (new workflow states)
  const requestStatuses = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "REJECTED"];
  const requestsByStatus: { status: string; count: number }[] = [];
  for (const status of requestStatuses) {
    const count = await db.trainingRequest.count({
      where: {
        deletedAt: null,
        status: status as any,
        ...(user.role === "CONTRACTOR" && user.companyId ? { companyId: user.companyId } : {}),
      },
    });
    requestsByStatus.push({ status, count });
  }

  // Certificates by course (top 5)
  const certsByCourseRaw = await db.certificate.groupBy({
    by: ["courseId"],
    where: { deletedAt: null, ...companyFilter },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 5,
  });
  const courseIds = certsByCourseRaw.map((c) => c.courseId);
  const courses = await db.course.findMany({
    where: { id: { in: courseIds } },
    select: { id: true, title: true },
  });
  const certificatesByCourse = certsByCourseRaw.map((c) => ({
    course: courses.find((co) => co.id === c.courseId)?.title ?? "—",
    count: c._count.id,
  }));

  // Average score (from final test results)
  const avgScoreResult = await db.testResult.aggregate({
    where: { deletedAt: null, testType: "FINAL_TEST" },
    _avg: { scorePercent: true },
  });
  const avgScore = avgScoreResult._avg.scorePercent ? Math.round(avgScoreResult._avg.scorePercent) : null;

  const completionRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : null;

  // Upcoming sessions (next 5)
  const upcomingSessions = await db.trainingSession.findMany({
    where: {
      deletedAt: null,
      startDate: { gte: new Date() },
      status: "SCHEDULED",
      ...trainerFilter,
    },
    include: {
      course: { select: { id: true, title: true, code: true, refNumber: true } },
      trainer: { select: { id: true, fullName: true, refNumber: true } },
    },
    orderBy: { startDate: "asc" },
    take: 5,
  });

  // Recent activity (last 10 audit entries — Coordinator+ only)
  let recentActivity: any[] = [];
  if (user.role === "SUPER_ADMIN" || user.role === "COORDINATOR") {
    recentActivity = await db.auditLog.findMany({
      take: 10,
      orderBy: { createdAt: "desc" },
      include: { user: { select: { fullName: true, role: true } } },
    });
  }

  return ok({
    kpis: {
      // Sprint 2 new KPIs
      pendingRequests,
      underReviewRequests,
      approvedRequests,
      scheduledSessions,
      todaySessions,
      availableTrainers,
      trainerConflicts,
      companies: companiesCount,
      trainees: traineesCount,

      // Existing KPIs
      totalSessions,
      sessionsThisYear,
      activeTrainees,
      issuedCertificates,
      certsThisYear,
      expiringCerts,
      activeTrainers,
      completionRate,
      avgScore,
    },
    charts: {
      sessionsByMonth,
      requestsByStatus,
      certificatesByCourse,
    },
    upcomingSessions: upcomingSessions.map((s) => ({
      id: s.id,
      refNumber: s.refNumber,
      sessionCode: s.refNumber,
      title: s.title,
      courseTitle: s.course?.title ?? null,
      courseCode: s.course?.code ?? null,
      courseRef: s.course?.refNumber ?? null,
      trainerName: s.trainer?.fullName ?? null,
      trainerRef: s.trainer?.refNumber ?? null,
      startDate: s.startDate,
      endDate: s.endDate,
      status: s.status,
    })),
    recentActivity: recentActivity.map((a) => ({
      id: a.id,
      action: a.action,
      entity: a.entity,
      entityRef: a.entityRef,
      description: a.description,
      descriptionAr: a.descriptionAr,
      userName: a.user?.fullName ?? null,
      createdAt: a.createdAt,
    })),
  });
}
