// /api/attendance — list + create (manual + QR check-in, with attempt logging)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["traineeName", "createdAt", "updatedAt", "status", "checkInAt"];

export const GET = withModuleAction("attendance", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { traineeName: { contains: q.search } },
      { traineeEmail: { contains: q.search } },
      { company: { contains: q.search } },
    ];
  }
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.sessionId) where.sessionId = q.filters.sessionId;

  // Coordinator and Trainer have equivalent operational permissions — no trainer scoping

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.attendance.findMany({
      where,
      include: {
        session: {
          select: {
            id: true, refNumber: true, title: true,
            course: { select: { id: true, title: true } },
          },
        },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.attendance.count({ where }),
  ]);

  return list(
    rows.map((a) => ({
      id: a.id,
      sessionId: a.sessionId,
      sessionRef: a.session?.refNumber ?? null,
      sessionCode: a.session?.refNumber ?? null,
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
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("attendance", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    sessionId, qrCodeToken, traineeName, traineeIdNational, traineeEmail,
    traineePhone, company, companyId, status, checkInMethod, notes,
  } = body;

  if (!sessionId) return fail("sessionId is required", 422, "VALIDATION_ERROR");

  // Validate session + QR token (if provided)
  let session;
  if (qrCodeToken) {
    session = await db.trainingSession.findFirst({
      where: { qrCodeToken, deletedAt: null },
    });
    if (!session || session.id !== sessionId) {
      // Log failed attempt
      await db.checkInAttempt.create({
        data: {
          sessionId,
          qrToken: qrCodeToken ?? null,
          traineeName: traineeName ?? null,
          traineeEmail: traineeEmail ?? null,
          traineeIdNational: traineeIdNational ?? null,
          ipAddress: req.headers.get("x-forwarded-for") ?? null,
          userAgent: req.headers.get("user-agent") ?? null,
          success: false,
          failureReason: "Invalid QR token",
        },
      });
      return fail("Invalid QR code", 400);
    }
  } else {
    session = await db.trainingSession.findFirst({ where: { id: sessionId, deletedAt: null } });
    if (!session) return fail("Session not found", 404);
  }

  if (!traineeName) return fail("traineeName is required", 422, "VALIDATION_ERROR");

  // Prevent duplicate check-ins
  const existing = await db.attendance.findFirst({
    where: {
      sessionId,
      traineeName: { equals: traineeName },
      deletedAt: null,
      ...(traineeIdNational ? { traineeIdNational } : {}),
    },
  });
  if (existing) {
    await db.checkInAttempt.create({
      data: {
        sessionId,
        qrToken: qrCodeToken ?? null,
        traineeName,
        traineeEmail: traineeEmail ?? null,
        traineeIdNational: traineeIdNational ?? null,
        ipAddress: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
        success: false,
        failureReason: "Already checked in",
      },
    });
    return fail("Trainee already checked in for this session", 400);
  }

  const method = checkInMethod ?? (qrCodeToken ? "QR" : "MANUAL");

  // One transaction: the attendance row, its audit trail entry and the session's
  // occupancy counter have to move together. As three separate writes, a failure
  // between them left the row created and `actualTrainees` stale — which then skews
  // every capacity check made against that session.
  const ipAddress = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;

  let attendance;
  try {
    attendance = await db.$transaction(async (tx) => {
      const created = await tx.attendance.create({
        data: {
          sessionId,
          traineeName,
          traineeIdNational: traineeIdNational ?? null,
          traineeEmail: traineeEmail ?? null,
          traineePhone: traineePhone ?? null,
          company: company ?? null,
          companyId: companyId ?? null,
          checkInAt: new Date(),
          status: status ?? "PRESENT",
          checkInMethod: method,
          notes: notes ?? null,
          createdBy: user.id,
          updatedBy: user.id,
        },
      });

      // Log successful attempt
      await tx.checkInAttempt.create({
        data: {
          sessionId,
          qrToken: qrCodeToken ?? null,
          traineeName,
          traineeEmail: traineeEmail ?? null,
          traineeIdNational: traineeIdNational ?? null,
          ipAddress,
          userAgent,
          success: true,
        },
      });

      // Bump actualTrainees on the session — with capacity guard.
      // Use a conditional updateMany so we atomically refuse over-capacity
      // check-ins (same pattern as check-in-service.ts). Without this, a
      // trainer manually checking in the 21st trainee into a 20-capacity
      // session would succeed.
      const claimed = await tx.trainingSession.updateMany({
        where: { id: sessionId, actualTrainees: { lt: session.capacity } },
        data: { actualTrainees: { increment: 1 }, updatedBy: user.id },
      });
      if (claimed.count === 0) {
        // Capacity reached — roll back the transaction by throwing.
        throw new Error("CAPACITY_REACHED");
      }

      return created;
    });
  } catch (e) {
    if ((e as Error).message === "CAPACITY_REACHED") {
      return fail(`Session ${session.refNumber} is at full capacity (${session.capacity})`, 422, "CAPACITY_REACHED");
    }
    throw e;
  }

  await audit({
    user,
    action: "CREATE",
    entity: "ATTENDANCE",
    entityId: attendance.id,
    entityRef: session.refNumber,
    description: `Checked in ${traineeName} for session ${session.refNumber} (${method})`,
    descriptionAr: `تسجيل حضور ${traineeName} لجلسة ${session.refNumber} (${method === "QR" ? "QR" : "يدوي"})`,
    req,
    metadata: { method, sessionId },
  });

  return created(attendance);
});
