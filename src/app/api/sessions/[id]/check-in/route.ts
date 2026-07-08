// /api/sessions/[id]/check-in — QR attendance with time window + device tracking
// POST: trainee scans QR → validates token + time window → creates attendance + auto-assigns pre-test
import { db } from "@/lib/db";
import { getCurrentUser, ok, created, fail, audit } from "@/lib/auth/api";
import { createExamAttempt } from "@/lib/api/exam-engine";
import { recordAudit } from "@/lib/auth/audit";

interface CheckInBody {
  qrCodeToken: string;
  traineeName: string;
  traineeIdNational?: string;
  traineeEmail?: string;
  traineePhone?: string;
  company?: string;
  companyId?: string;
  deviceFingerprint?: string;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);

  const { id: sessionId } = await ctx.params;
  const body: CheckInBody = await req.json().catch(() => ({} as CheckInBody));

  if (!body.qrCodeToken || !body.traineeName) {
    return fail("qrCodeToken and traineeName are required", 422, "VALIDATION_ERROR");
  }

  // 1. Validate session + QR token
  const session = await db.trainingSession.findFirst({
    where: { id: sessionId, deletedAt: null },
    include: { course: true },
  });
  if (!session) return fail("Session not found", 404);

  if (session.qrCodeToken !== body.qrCodeToken) {
    // Log failed attempt
    await db.checkInAttempt.create({
      data: {
        sessionId,
        qrToken: body.qrCodeToken,
        traineeName: body.traineeName,
        traineeEmail: body.traineeEmail ?? null,
        traineeIdNational: body.traineeIdNational ?? null,
        ipAddress: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
        success: false,
        failureReason: "Invalid QR token",
      },
    });
    return fail("Invalid QR code", 400, "INVALID_QR");
  }

  // 2. Check QR time window — QR must be active
  const now = new Date();
  const qrActiveFrom = session.qrActiveFrom ?? session.startDate;
  const qrActiveTo = session.qrActiveTo ?? session.endDate;

  if (now < qrActiveFrom) {
    return fail(
      `QR code is not active yet (active from ${qrActiveFrom.toISOString()})`,
      400,
      "QR_NOT_YET_ACTIVE",
      { qrActiveFrom, qrActiveTo, now }
    );
  }
  if (now > qrActiveTo) {
    return fail(
      `QR code has expired (was active until ${qrActiveTo.toISOString()})`,
      400,
      "QR_EXPIRED",
      { qrActiveFrom, qrActiveTo, now }
    );
  }

  // 3. Prevent duplicate attendance — one per trainee per session
  const existing = await db.attendance.findFirst({
    where: {
      sessionId,
      traineeName: { equals: body.traineeName },
      deletedAt: null,
      ...(body.traineeIdNational ? { traineeIdNational: body.traineeIdNational } : {}),
    },
  });
  if (existing) {
    // Log failed attempt
    await db.checkInAttempt.create({
      data: {
        sessionId,
        qrToken: body.qrCodeToken,
        traineeName: body.traineeName,
        traineeEmail: body.traineeEmail ?? null,
        traineeIdNational: body.traineeIdNational ?? null,
        ipAddress: req.headers.get("x-forwarded-for") ?? null,
        userAgent: req.headers.get("user-agent") ?? null,
        success: false,
        failureReason: "Already checked in",
      },
    });
    return fail("Trainee already checked in for this session", 400, "DUPLICATE_CHECK_IN", {
      attendanceId: existing.id,
      checkInAt: existing.checkInAt,
    });
  }

  // 4. Check capacity
  if (session.actualTrainees >= session.capacity) {
    return fail(
      `Session is at full capacity (${session.capacity})`,
      400,
      "CAPACITY_REACHED"
    );
  }

  // 5. Record device info
  const userAgent = req.headers.get("user-agent") ?? null;
  const ipAddress = req.headers.get("x-forwarded-for") ?? null;
  const deviceInfo = JSON.stringify({
    userAgent,
    ipAddress,
    platform: body.deviceFingerprint ? "mobile" : "web",
    deviceFingerprint: body.deviceFingerprint ?? null,
    timestamp: now.toISOString(),
  });

  // 5a. MULTI-COMPANY: Look up the trainee to get their ORIGINAL company.
  // The trainee may be from a DIFFERENT company than the session's owning company.
  // This is the key multi-company change — we do NOT restrict check-in to the request's company.
  let traineeCompanyId = body.companyId ?? null;
  let traineeCompanyName = body.company ?? null;

  if (body.traineeIdNational) {
    // Try to find the trainee by national ID — their original company is preserved
    const trainee = await db.trainee.findFirst({
      where: { nationalId: body.traineeIdNational, deletedAt: null },
      include: { company: { select: { id: true, name: true } } },
    });
    if (trainee) {
      traineeCompanyId = trainee.companyId;
      traineeCompanyName = trainee.company?.name ?? null;
    }
  }

  // 6. Create attendance record — using the TRAINEE's company (NOT the session's company)
  const attendance = await db.attendance.create({
    data: {
      sessionId,
      traineeName: body.traineeName,
      traineeIdNational: body.traineeIdNational ?? null,
      traineeEmail: body.traineeEmail ?? null,
      traineePhone: body.traineePhone ?? null,
      company: traineeCompanyName,
      companyId: traineeCompanyId,
      checkInAt: now,
      status: "PRESENT",
      checkInMethod: "QR",
      deviceInfo,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  // Log successful check-in attempt
  await db.checkInAttempt.create({
    data: {
      sessionId,
      qrToken: body.qrCodeToken,
      traineeName: body.traineeName,
      traineeEmail: body.traineeEmail ?? null,
      traineeIdNational: body.traineeIdNational ?? null,
      ipAddress,
      userAgent,
      success: true,
    },
  });

  // Bump actualTrainees
  await db.trainingSession.update({
    where: { id: sessionId },
    data: { actualTrainees: { increment: 1 }, updatedBy: user.id },
  });

  // 7. Auto-assign Pre-Test if course has pre-test enabled
  let preTestAttempt = null;
  if (session.course?.hasPreTest) {
    try {
      const examAttempt = await createExamAttempt({
        sessionId,
        attendanceId: attendance.id,
        testType: "PRE_TEST",
        traineeName: body.traineeName,
        traineeEmail: body.traineeEmail,
        traineeIdNational: body.traineeIdNational,
        createdBy: user.id,
      });

      // Mark pre-test as assigned on the attendance record
      await db.attendance.update({
        where: { id: attendance.id },
        data: { preTestAssignedAt: now },
      });

      preTestAttempt = {
        attemptId: examAttempt.attemptId,
        refNumber: examAttempt.refNumber,
      };

      await recordAudit({
        userId: user.id,
        action: "CREATE",
        entity: "EXAM",
        entityId: examAttempt.attemptId,
        entityRef: examAttempt.refNumber,
        description: `Auto-assigned Pre-Test ${examAttempt.refNumber} to ${body.traineeName} after QR check-in`,
        descriptionAr: `تعيين اختبار قبلي ${examAttempt.refNumber} تلقائياً لـ ${body.traineeName} بعد تسجيل الحضور`,
        req,
        metadata: { sessionId, attendanceId: attendance.id, testType: "PRE_TEST" },
      });
    } catch (e) {
      // If no questions in bank, log but don't fail the check-in
      console.error("[Pre-Test auto-assign error]", e);
    }
  }

  await audit({
    user,
    action: "CREATE",
    entity: "ATTENDANCE",
    entityId: attendance.id,
    entityRef: session.refNumber,
    description: `QR check-in: ${body.traineeName} for session ${session.refNumber}`,
    descriptionAr: `تسجيل حضور بـ QR: ${body.traineeName} للجلسة ${session.refNumber}`,
    req,
    metadata: {
      sessionId,
      checkInMethod: "QR",
      deviceInfo: { userAgent, ipAddress, deviceFingerprint: body.deviceFingerprint },
      preTestAssigned: !!preTestAttempt,
    },
  });

  return created({
    attendance,
    preTestAttempt,
    session: {
      refNumber: session.refNumber,
      title: session.title,
      courseTitle: session.course?.title ?? null,
    },
  });
}
