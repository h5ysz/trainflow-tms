// /api/sessions — list + create (UUID, SES-000001 ref number, soft delete, audit)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { nextRefNumber } from "@/lib/api/ref-number";
import { list } from "@/lib/api/response";
import { randomBytes } from "crypto";

const ALLOWED_SORT_FIELDS = ["refNumber", "title", "startDate", "endDate", "createdAt", "status", "location"];

function genQrToken(): string {
  return randomBytes(16).toString("hex");
}

export const GET = withModuleAction("sessions", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { refNumber: { contains: q.search } },
      { title: { contains: q.search } },
      { location: { contains: q.search } },
    ];
  }
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.trainerId) where.trainerId = q.filters.trainerId;
  if (q.filters.courseId) where.courseId = q.filters.courseId;
  if (q.filters.from || q.filters.to) {
    where.startDate = {};
    if (q.filters.from) (where.startDate as any).gte = new Date(q.filters.from);
    if (q.filters.to) (where.startDate as any).lte = new Date(q.filters.to);
  }

  // Trainers see only their own sessions
  if (user.role === "TRAINER" && user.trainerId) {
    where.trainerId = user.trainerId;
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.trainingSession.findMany({
      where,
      include: {
        course: { select: { id: true, title: true, code: true, refNumber: true } },
        trainer: { select: { id: true, fullName: true, refNumber: true } },
        request: { select: { id: true, refNumber: true } },
        _count: { select: { attendance: true, certificates: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.trainingSession.count({ where }),
  ]);

  return list(
    rows.map((s) => ({
      id: s.id,
      refNumber: s.refNumber,
      courseId: s.courseId,
      courseTitle: s.course?.title ?? null,
      courseCode: s.course?.code ?? null,
      courseRef: s.course?.refNumber ?? null,
      requestId: s.requestId,
      requestRef: s.request?.refNumber ?? null,
      trainerId: s.trainerId,
      trainerName: s.trainer?.fullName ?? null,
      trainerRef: s.trainer?.refNumber ?? null,
      title: s.title,
      location: s.location,
      venue: s.venue,
      language: s.language,
      startDate: s.startDate,
      endDate: s.endDate,
      expectedTrainees: s.expectedTrainees,
      actualTrainees: s.actualTrainees,
      status: s.status,
      notes: s.notes,
      qrCodeToken: s.qrCodeToken,
      qrCodeGeneratedAt: s.qrCodeGeneratedAt,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      attendanceCount: s._count.attendance,
      certificatesCount: s._count.certificates,
    })),
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("sessions", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    courseId, requestId, trainerId, title, location, venue, language,
    startDate, endDate, expectedTrainees, notes,
  } = body;

  if (!courseId || !title || !startDate || !endDate) {
    return fail("courseId, title, startDate, endDate are required", 422, "VALIDATION_ERROR");
  }

  const course = await db.course.findFirst({ where: { id: courseId, deletedAt: null } });
  if (!course) return fail("Course not found", 404);

  if (trainerId) {
    const trainer = await db.trainer.findFirst({ where: { id: trainerId, deletedAt: null } });
    if (!trainer) return fail("Trainer not found", 404);
  }

  const refNumber = await nextRefNumber("SESSION");
  const qrToken = genQrToken();

  const session = await db.trainingSession.create({
    data: {
      refNumber,
      courseId,
      requestId: requestId ?? null,
      trainerId: trainerId ?? null,
      title,
      location: location ?? null,
      venue: venue ?? null,
      language: language ?? course.language,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      expectedTrainees: expectedTrainees ?? 0,
      actualTrainees: 0,
      status: "SCHEDULED",
      notes: notes ?? null,
      qrCodeToken: qrToken,
      qrCodeGeneratedAt: new Date(),
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  // If linked to a request, mark it SCHEDULED (workflow transition)
  if (requestId) {
    const req = await db.trainingRequest.findUnique({ where: { id: requestId } });
    if (req && req.status === "APPROVED") {
      await db.trainingRequest.update({
        where: { id: requestId },
        data: { status: "SCHEDULED", scheduledAt: new Date(), updatedBy: user.id },
      });
    }
  }

  await audit({
    user,
    action: "CREATE",
    entity: "SESSION",
    entityId: session.id,
    entityRef: session.refNumber,
    description: `Created session ${session.refNumber} (${course.title})`,
    descriptionAr: `تم إنشاء جلسة ${session.refNumber} (${course.title})`,
    req,
  });

  return created(session);
});
