// /api/attendance — list + create (manual check-in / QR check-in)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, auditLog } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";

export const GET = withModuleAction("attendance", "view", async ({ req, user }) => {
  const params = parseListParams(req);
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { traineeName: { contains: params.search } },
      { traineeEmail: { contains: params.search } },
      { company: { contains: params.search } },
    ];
  }
  if (params.status) where.status = params.status;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (sessionId) where.sessionId = sessionId;

  // Trainers see only their own sessions' attendance
  if (user.role === "TRAINER" && user.trainerId) {
    where.session = { trainerId: user.trainerId };
  }

  const [rows, total] = await Promise.all([
    db.attendance.findMany({
      where,
      include: {
        session: {
          select: {
            id: true,
            sessionCode: true,
            title: true,
            course: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.attendance.count({ where }),
  ]);

  return ok(
    listResponse(
      rows.map((a) => ({
        id: a.id,
        sessionId: a.sessionId,
        sessionCode: a.session?.sessionCode ?? null,
        sessionTitle: a.session?.title ?? null,
        courseTitle: a.session?.course?.title ?? null,
        traineeName: a.traineeName,
        traineeIdNational: a.traineeIdNational,
        traineeEmail: a.traineeEmail,
        traineePhone: a.traineePhone,
        company: a.company,
        checkInAt: a.checkInAt,
        checkOutAt: a.checkOutAt,
        status: a.status,
        checkInMethod: a.checkInMethod,
        notes: a.notes,
        createdAt: a.createdAt,
      })),
      total,
      params
    )
  );
});

export const POST = withModuleAction("attendance", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    sessionId, qrCodeToken, traineeName, traineeIdNational, traineeEmail,
    traineePhone, company, status, checkInMethod, notes,
  } = body;

  if (!sessionId) return fail("sessionId is required", 400);

  // If QR token provided, validate it
  if (qrCodeToken) {
    const session = await db.trainingSession.findUnique({
      where: { qrCodeToken },
    });
    if (!session || session.id !== sessionId) {
      return fail("Invalid QR code", 400);
    }
  } else {
    const session = await db.trainingSession.findUnique({ where: { id: sessionId } });
    if (!session) return fail("Session not found", 404);
  }

  if (!traineeName) return fail("traineeName is required", 400);

  // Prevent duplicate check-ins (same trainee + session)
  const existing = await db.attendance.findFirst({
    where: {
      sessionId,
      traineeName: { equals: traineeName },
      ...(traineeIdNational && { traineeIdNational }),
    },
  });
  if (existing) {
    return fail("Trainee already checked in for this session", 400);
  }

  const attendance = await db.attendance.create({
    data: {
      sessionId,
      traineeName,
      traineeIdNational: traineeIdNational ?? null,
      traineeEmail: traineeEmail ?? null,
      traineePhone: traineePhone ?? null,
      company: company ?? null,
      checkInAt: new Date(),
      status: status ?? "PRESENT",
      checkInMethod: checkInMethod ?? (qrCodeToken ? "QR" : "MANUAL"),
      notes: notes ?? null,
    },
  });

  // Bump actualTrainees on the session
  await db.trainingSession.update({
    where: { id: sessionId },
    data: { actualTrainees: { increment: 1 } },
  });

  await auditLog({
    userId: user.id,
    action: "CREATE",
    entity: "SESSION",
    entityId: sessionId,
    description: `Checked in ${traineeName}`,
    req,
  });

  return created(attendance);
});
