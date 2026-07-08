// /api/sessions/[id]/enrollments — multi-company session enrollment
// POST: enroll a trainee (from ANY company) into a session
// GET:  list all enrollments for the session (shows trainees from multiple companies)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";

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

  // Support both single traineeId and batch traineeIds
  const ids: string[] = Array.isArray(traineeIds) ? traineeIds : (traineeId ? [traineeId] : []);
  if (ids.length === 0) {
    return fail("traineeId or traineeIds is required", 422, "VALIDATION_ERROR");
  }

  const session = await db.trainingSession.findFirst({ where: { id: sessionId, deletedAt: null } });
  if (!session) return fail("Session not found", 404);

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

  // Check capacity
  const currentEnrolled = await db.sessionEnrollment.count({
    where: { sessionId, deletedAt: null },
  });
  if (currentEnrolled + trainees.length > session.capacity) {
    return fail(
      `Cannot enroll ${trainees.length} trainee(s): would exceed session capacity of ${session.capacity} (current: ${currentEnrolled})`,
      422,
      "CAPACITY_EXCEEDED",
      { current: currentEnrolled, adding: trainees.length, capacity: session.capacity }
    );
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

  // Get the set of unique companies among the new enrollees
  const companyIds = new Set(newTrainees.map((t) => t.companyId));

  // Create enrollments + update SessionCompany tracking in a transaction
  const result = await db.$transaction(async (tx) => {
    // Create enrollment records
    const enrollments = await Promise.all(
      newTrainees.map((trainee) =>
        tx.sessionEnrollment.create({
          data: {
            sessionId,
            traineeId: trainee.id,
            companyId: trainee.companyId, // trainee's ORIGINAL company — preserved
            enrolledBy: user.id,
            enrollmentStatus: "PENDING",
            enrollmentDate: new Date(),
            notes: notes ?? null,
            createdBy: user.id,
            updatedBy: user.id,
          },
        })
      )
    );

    // Upsert SessionCompany records for each company
    for (const companyId of companyIds) {
      const count = newTrainees.filter((t) => t.companyId === companyId).length;
      await tx.sessionCompany.upsert({
        where: { sessionId_companyId: { sessionId, companyId } },
        update: { traineeCount: { increment: count } },
        create: {
          sessionId,
          companyId,
          traineeCount: count,
          createdBy: user.id,
        },
      });
    }

    // Update session expectedTrainees
    await tx.trainingSession.update({
      where: { id: sessionId },
      data: {
        expectedTrainees: { increment: newTrainees.length },
        updatedBy: user.id,
      },
    });

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
