// /api/sessions — list + create (UUID, SES-000001 ref number, soft delete, audit)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { nextRefNumber } from "@/lib/api/ref-number";
import { list } from "@/lib/api/response";
import { validateTrainerAssignment, validationErrorToResponse } from "@/lib/api/trainer-assignment";
import { randomBytes, randomUUID } from "crypto";

const ALLOWED_SORT_FIELDS = ["refNumber", "title", "startDate", "endDate", "createdAt", "status", "location", "city", "shift"];

export function genQrToken(): string {
  return randomBytes(16).toString("hex");
}

const SHIFT_DURATION_HOURS = 6; // Morning/Evening = 6 hours each

export const GET = withModuleAction("sessions", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { refNumber: { contains: q.search } },
      { title: { contains: q.search } },
      { location: { contains: q.search } },
      { city: { contains: q.search } },
      { venue: { contains: q.search } },
    ];
  }
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.trainerId) where.trainerId = q.filters.trainerId;
  if (q.filters.courseId) where.courseId = q.filters.courseId;
  if (q.filters.shift) where.shift = q.filters.shift;
  if (q.filters.city) where.city = q.filters.city;
  if (q.filters.region) where.region = q.filters.region;
  if (q.filters.requestCourseId) where.requestCourseId = q.filters.requestCourseId;
  if (q.filters.from || q.filters.to) {
    where.startDate = {};
    if (q.filters.from) (where.startDate as any).gte = new Date(q.filters.from);
    if (q.filters.to) (where.startDate as any).lte = new Date(q.filters.to);
  }

  // Coordinator and Trainer have equivalent operational permissions — no trainer scoping

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.trainingSession.findMany({
      where,
      include: {
        course: { select: { id: true, title: true, code: true, refNumber: true } },
        trainer: { select: { id: true, nameEn: true, nameAr: true, refNumber: true } },
        request: { select: { id: true, refNumber: true } },
        requestCourse: { select: { id: true, course: { select: { title: true, code: true } } } },
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
      requestCourseId: s.requestCourseId,
      trainerId: s.trainerId,
      trainer: s.trainer
        ? { id: s.trainer.id, nameEn: s.trainer.nameEn, nameAr: s.trainer.nameAr, refNumber: s.trainer.refNumber }
        : null,
      trainerName: s.trainer?.nameEn ?? null,
      trainerRef: s.trainer?.refNumber ?? null,
      title: s.title,
      location: s.location,
      city: s.city,
      region: s.region,
      venue: s.venue,
      shift: s.shift,
      durationHours: s.durationHours,
      capacity: s.capacity,
      language: s.language,
      startDate: s.startDate,
      endDate: s.endDate,
      expectedTrainees: s.expectedTrainees,
      actualTrainees: s.actualTrainees,
      status: s.status,
      notes: s.notes,
      instituteName: s.instituteName,
      classification: s.classification,
      locationMapUrl: s.locationMapUrl,
      durationDays: s.durationDays,
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
    courseId, requestId, requestCourseId, trainerId, title, location, city, region, venue,
    shift, durationHours, capacity, language,
    startDate, endDate, expectedTrainees, notes,
    instituteName, classification, locationMapUrl, durationDays,
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

  // Validate trainer assignment (certification + conflict + role)
  if (trainerId) {
    const validation = await validateTrainerAssignment({
      user,
      trainerId,
      courseId,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
    });
    if (!validation.valid) {
      return validationErrorToResponse(validation);
    }
  }

  // Compute duration based on shift (Morning/Evening = 6 hours)
  const finalDuration = durationHours ?? (shift ? SHIFT_DURATION_HOURS : course.durationHours);

  const refNumber = await nextRefNumber("SESSION");
  const qrToken = genQrToken();

  const session = await db.trainingSession.create({
    data: {
      id: randomUUID(),
      refNumber,
      courseId,
      requestId: requestId ?? null,
      requestCourseId: requestCourseId ?? null,
      trainerId: trainerId ?? null,
      title,
      location: location ?? null,
      city: city ?? null,
      region: region ?? null,
      venue: venue ?? null,
      shift: shift ?? null,
      durationHours: finalDuration,
      capacity: capacity ?? course.maxTrainees,
      language: language ?? course.language,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      expectedTrainees: expectedTrainees ?? 0,
      actualTrainees: 0,
      status: "SCHEDULED",
      notes: notes ?? null,
      instituteName: instituteName ?? null,
      classification: classification ?? "COURSE",
      locationMapUrl: locationMapUrl ?? null,
      durationDays: durationDays ?? null,
      qrCodeToken: qrToken,
      qrCodeGeneratedAt: new Date(),
      createdBy: user.id,
      updatedBy: user.id,
      updatedAt: new Date(),
    },
  });

  // If linked to a request, mark it SCHEDULED (workflow transition)
  if (requestId) {
    const requestRec = await db.trainingRequest.findUnique({ where: { id: requestId } });
    if (requestRec && requestRec.status === "APPROVED") {
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
    metadata: { shift, durationHours: finalDuration, capacity: session.capacity, trainerId },
  });

  return created(session);
});
