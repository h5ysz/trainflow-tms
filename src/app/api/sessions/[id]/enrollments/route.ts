// /api/sessions/[id]/enrollments — multi-company session enrollment
// POST: enroll a trainee (from ANY company) into a session
// GET:  list all enrollments for the session (shows trainees from multiple companies)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { recomputeSessionCounts } from "@/lib/sessions/session-management";

const ALLOWED_SORT_FIELDS = ["enrollmentDate", "createdAt", "enrollmentStatus", "traineeName"];

export const GET = withModuleAction("sessions", "view", async ({ req, params }) => {
  const sessionId = params.id as string;
  const q = parseListQuery(req);
  const where: Record<string, unknown> = {
    ...whereWithSoftDelete({}, q.includeDeleted),
    sessionId,
  };
  if (q.filters.companyId) where.companyId = q.filters.companyId;
  if (q.filters.enrollmentStatus) where.enrollmentStatus = q.filters.enrollmentStatus;
  if (q.filters.attendanceStatus) where.attendanceStatus = q.filters.attendanceStatus;

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "enrollmentDate");

  const [rows, total] = await Promise.all([
    db.sessionEnrollment.findMany({
      where,
      include: {
        trainee: {
          select: {
            id: true, refNumber: true, fullName: true, nationalId: true,
            nationality: true, jobTitle: true, mobile: true, email: true,
          },
        },
        company: { select: { id: true, name: true, refNumber: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.sessionEnrollment.count({ where }),
  ]);

  // Also return a summary of companies enrolled in this session
  const companySummary = await db.sessionCompany.findMany({
    where: { sessionId },
    include: { company: { select: { id: true, name: true, refNumber: true } } },
    orderBy: { traineeCount: "desc" },
  });

  return ok({
    enrollments: rows,
    companies: companySummary.map((sc) => ({
      companyId: sc.companyId,
      companyName: sc.company?.name ?? null,
      companyRef: sc.company?.refNumber ?? null,
      traineeCount: sc.traineeCount,
    })),
    pagination: buildListMeta(total, q),
  });
});

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const sessionId = params.id as string;
  const body = await req.json().catch(() => ({}));
  const { traineeId, traineeIds, notes } = body;

  // ── Enrollment source + trainer emergency-add tracking ─────────────────
  // Determine who is adding the trainee and set the source accordingly.
  // Trainers get addedByTrainer=true + pendingReview=true so the coordinator
  // can review later.
  const isTrainer = user.role === "TRAINER";
  const enrollmentSource = isTrainer ? "TRAINER" : "COORDINATOR";
  const addedByTrainer = isTrainer;
  const pendingReview = isTrainer;

  // Support both single traineeId and batch traineeIds
  const ids: string[] = Array.isArray(traineeIds) ? traineeIds : (traineeId ? [traineeId] : []);
  if (ids.length === 0) {
    return fail("traineeId or traineeIds is required", 422, "VALIDATION_ERROR");
  }

  const session = await db.trainingSession.findFirst({ where: { id: sessionId, deletedAt: null } });
  if (!session) return fail("Session not found", 404);

  // No status gate — coordinators and trainers can enroll trainees into any
  // session at any time (SCHEDULED, IN_PROGRESS, even COMPLETED). Every
  // change is audit-logged. This matches the real-world training-center
  // model where the coordinator must always be able to fix issues.

  // Fetch all trainees with their company info — NOTE: trainees can be from ANY company
  const trainees = await db.trainee.findMany({
    where: { id: { in: ids }, deletedAt: null },
    include: { company: { select: { id: true, name: true, refNumber: true } } },
  });

  if (trainees.length !== ids.length) {
    const found = new Set(trainees.map((t) => t.id));
    const missing = ids.filter((id) => !found.has(id));
    return fail(`Some trainees not found: ${missing.join(", ")}`, 404, "TRAINEES_NOT_FOUND", { missing });
  }

  // Filter out already-enrolled trainees
  const existingEnrollments = await db.sessionEnrollment.findMany({
    where: { sessionId, traineeId: { in: ids }, deletedAt: null },
    select: { traineeId: true },
  });
  const existingIds = new Set(existingEnrollments.map((e) => e.traineeId));
  const newTrainees = trainees.filter((t) => !existingIds.has(t.id));

  if (newTrainees.length === 0) {
    return fail("All trainees are already enrolled in this session", 400, "ALREADY_ENROLLED");
  }

  // Check capacity against NEW trainees only (not the full list, which
  // includes already-enrolled ones). This prevents over-rejecting when
  // re-enrolling a mix of new and existing trainees.
  const currentEnrolled = await db.sessionEnrollment.count({
    where: { sessionId, deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
  });
  if (currentEnrolled + newTrainees.length > session.capacity) {
    return fail(
      `Cannot enroll ${newTrainees.length} new trainee(s): would exceed session capacity of ${session.capacity} (current: ${currentEnrolled})`,
      422,
      "CAPACITY_EXCEEDED",
      { current: currentEnrolled, adding: newTrainees.length, capacity: session.capacity }
    );
  }

  // Get the set of unique companies among the new enrollees
  const companyIds = new Set(newTrainees.map((t) => t.companyId));

  // ── Re-Exam detection ──────────────────────────────────────────────────
  // Check if any of the new trainees have a prior enrollment in another
  // session of the SAME course where they FAILED the final test. If so,
  // this enrollment is a re-exam. We set isReExam=true on the new row.
  const newTraineeIds = newTrainees.map((t) => t.id);
  const priorEnrollments = await db.sessionEnrollment.findMany({
    where: {
      traineeId: { in: newTraineeIds },
      deletedAt: null,
      finalTestStatus: "FAILED",
      sessionId: { not: sessionId },
      session: { courseId: session.courseId, deletedAt: null },
    },
    select: { traineeId: true },
  });
  const reExamTraineeIds = new Set(priorEnrollments.map((e) => e.traineeId));

  // Create enrollments + recompute SessionCompany in a transaction.
  // We use recomputeSessionCounts (the source of truth) instead of manual
  // increment/decrement — it's idempotent and handles every edge case
  // (revived soft-deleted enrollments, last-trainee-of-company removal, etc).
  const result = await db.$transaction(async (tx) => {
    // Create enrollment records.
    //
    // Upsert, not create: @@unique([sessionId, traineeId]) does not include
    // deletedAt, while the already-enrolled filter above does. A trainee who
    // was enrolled and then removed therefore looks absent but still owns the
    // unique key, and a plain create would violate it. Re-enrolling revives
    // the soft-deleted row.
    const enrollments = await Promise.all(
      newTrainees.map((trainee) => {
        const isReExam = reExamTraineeIds.has(trainee.id);
        const source = isReExam ? "RE_EXAM" : enrollmentSource;
        return tx.sessionEnrollment.upsert({
          where: { sessionId_traineeId: { sessionId, traineeId: trainee.id } },
          update: {
            deletedAt: null,
            companyId: trainee.companyId,
            enrolledBy: user.id,
            enrollmentStatus: "PENDING",
            enrollmentDate: new Date(),
            notes: notes ?? null,
            isReExam,
            enrollmentSource: source,
            addedByTrainer,
            pendingReview,
            updatedBy: user.id,
          },
          create: {
            sessionId,
            traineeId: trainee.id,
            companyId: trainee.companyId,
            enrolledBy: user.id,
            enrollmentStatus: "PENDING",
            enrollmentDate: new Date(),
            notes: notes ?? null,
            isReExam,
            enrollmentSource: source,
            addedByTrainer,
            pendingReview,
            createdBy: user.id,
            updatedBy: user.id,
          },
        });
      })
    );

    // Recompute SessionCompany + expectedTrainees from the active enrollments.
    // This is the source of truth — the manual increment pattern was fragile
    // and could desync if a trainee was previously enrolled+removed.
    await recomputeSessionCounts(sessionId, tx);

    return enrollments;
  });

  // Build a summary of which companies were involved
  const companyBreakdown = newTrainees.reduce((acc, t) => {
    const key = t.company?.name ?? t.companyId;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  await audit({
    user,
    action: "CREATE",
    entity: "SESSION",
    entityId: sessionId,
    entityRef: session.refNumber,
    description: `Enrolled ${newTrainees.length} trainee(s) from ${companyIds.size} company/companies into session ${session.refNumber}. Companies: ${Object.entries(companyBreakdown).map(([c, n]) => `${c} (${n})`).join(", ")}`,
    descriptionAr: `تسجيل ${newTrainees.length} متدرب من ${companyIds.size} شركة/شركات في الجلسة ${session.refNumber}`,
    req,
    metadata: {
      enrolledCount: newTrainees.length,
      skippedCount: ids.length - newTrainees.length,
      companyIds: Array.from(companyIds),
      companyBreakdown,
    },
  });

  return created({
    enrolled: newTrainees.length,
    skipped: ids.length - newTrainees.length,
    companies: Array.from(companyIds),
    companyBreakdown,
    enrollments: result,
  });
});
