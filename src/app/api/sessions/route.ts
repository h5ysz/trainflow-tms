// /api/sessions — list + create training sessions
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, auditLog } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";
import { randomBytes } from "crypto";

function genSessionCode(): string {
  const d = new Date();
  const yy = d.getFullYear().toString().slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase();
  return `TS-${yy}${mm}-${rand}`;
}

function genQrToken(): string {
  return randomBytes(16).toString("hex");
}

export const GET = withModuleAction("sessions", "view", async ({ req, user }) => {
  const params = parseListParams(req);
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { sessionCode: { contains: params.search } },
      { title: { contains: params.search } },
      { location: { contains: params.search } },
    ];
  }
  if (params.status) where.status = params.status;
  const url = new URL(req.url);
  const trainerId = url.searchParams.get("trainerId");
  const courseId = url.searchParams.get("courseId");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (trainerId) where.trainerId = trainerId;
  if (courseId) where.courseId = courseId;
  if (from || to) {
    where.startDate = {};
    if (from) (where.startDate as any).gte = new Date(from);
    if (to) (where.startDate as any).lte = new Date(to);
  }

  // Trainers see only their own sessions
  if (user.role === "TRAINER" && user.trainerId) {
    where.trainerId = user.trainerId;
  }

  const [rows, total] = await Promise.all([
    db.trainingSession.findMany({
      where,
      include: {
        course: { select: { id: true, title: true, code: true } },
        trainer: { select: { id: true, fullName: true } },
        request: { select: { id: true, requestNumber: true } },
        _count: { select: { attendance: true, certificates: true } },
      },
      orderBy: { startDate: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.trainingSession.count({ where }),
  ]);

  return ok(
    listResponse(
      rows.map((s) => ({
        id: s.id,
        sessionCode: s.sessionCode,
        courseId: s.courseId,
        courseTitle: s.course?.title ?? null,
        courseCode: s.course?.code ?? null,
        requestId: s.requestId,
        requestNumber: s.request?.requestNumber ?? null,
        trainerId: s.trainerId,
        trainerName: s.trainer?.fullName ?? null,
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
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        attendanceCount: s._count.attendance,
        certificatesCount: s._count.certificates,
      })),
      total,
      params
    )
  );
});

export const POST = withModuleAction("sessions", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    courseId, requestId, trainerId, title, location, venue, language,
    startDate, endDate, expectedTrainees, notes,
  } = body;

  if (!courseId || !title || !startDate || !endDate) {
    return fail("courseId, title, startDate, endDate are required", 400);
  }

  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course) return fail("Course not found", 404);

  if (trainerId) {
    const trainer = await db.trainer.findUnique({ where: { id: trainerId } });
    if (!trainer) return fail("Trainer not found", 404);
  }

  // Unique session code
  let sessionCode = genSessionCode();
  while (await db.trainingSession.findUnique({ where: { sessionCode } })) {
    sessionCode = genSessionCode();
  }

  const session = await db.trainingSession.create({
    data: {
      sessionCode,
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
      qrCodeToken: genQrToken(),
    },
  });

  // If linked to a request, mark it SCHEDULED
  if (requestId) {
    await db.trainingRequest.update({
      where: { id: requestId },
      data: { status: "SCHEDULED" },
    });
  }

  await auditLog({
    userId: user.id,
    action: "CREATE",
    entity: "SESSION",
    entityId: session.id,
    description: `Created session ${sessionCode} (${course.title})`,
    req,
  });

  return created(session);
});
