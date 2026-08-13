// /api/sessions/[id]/manual-attendance — trainer marks an enrolled trainee PRESENT
// without scanning a QR code. Mirrors the QR check-in pipeline (attendance row +
// enrollment sync + pre-test auto-assign) so a manual check-in is indistinguishable
// from a QR one downstream, except for checkInMethod = "MANUAL".
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";
import { createExamAttempt } from "@/lib/api/exam-engine";
import { syncAttendanceCheckedIn, syncPreTestStatus } from "@/lib/api/enrollment-sync";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";

export const POST = withModuleAction("attendance", "create", async ({ req, params, user }) => {
  const id = params.id as string;

  const session = await db.trainingSession.findFirst({
    where: { id, deletedAt: null },
    include: { course: true },
  });
  if (!session) return fail("Session not found", 404);
  if (trainerDeniedSession(user, session.trainerId)) {
    return fail("Forbidden — you can only mark attendance for your own sessions", 403);
  }

  const body = await req.json().catch(() => ({}));
  const { traineeId, traineeName } = body as { traineeId?: string; traineeName?: string };
  if (!traineeId && !traineeName) {
    return fail("traineeId or traineeName is required", 422, "VALIDATION_ERROR");
  }

  // Find the enrollment so we resolve the trainee's identity + original company.
  const enrollment = await db.sessionEnrollment.findFirst({
    where: {
      sessionId: id,
      deletedAt: null,
      ...(traineeId ? { traineeId } : {}),
    },
    include: { trainee: true },
  });
  const trainee = traineeId
    ? await db.trainee.findFirst({
        where: { id: traineeId, deletedAt: null },
        include: { company: { select: { id: true, name: true } } },
      })
    : null;

  const resolvedName = enrollment?.trainee?.fullName ?? trainee?.fullName ?? traineeName ?? null;
  const resolvedNationalId = enrollment?.trainee?.nationalId ?? trainee?.nationalId ?? null;
  if (!resolvedName) return fail("Trainee not found", 404);

  const now = new Date();

  // Prevent duplicate attendance — one per trainee per session.
  const existing = await db.attendance.findFirst({
    where: {
      sessionId: id,
      traineeName: { equals: resolvedName },
      deletedAt: null,
      ...(resolvedNationalId ? { traineeIdNational: resolvedNationalId } : {}),
    },
  });
  if (existing) {
    return fail("Trainee already checked in for this session", 400, "DUPLICATE_CHECK_IN", {
      attendanceId: existing.id,
      checkInAt: existing.checkInAt,
    });
  }

  // Capacity guard.
  if (session.actualTrainees >= session.capacity) {
    return fail(`Session is at full capacity (${session.capacity})`, 400, "CAPACITY_REACHED");
  }

  const ipAddress = req.headers.get("x-forwarded-for") ?? null;
  const userAgent = req.headers.get("user-agent") ?? null;
  const traineeCompanyId = trainee?.company?.id ?? null;
  const traineeCompanyName = trainee?.company?.name ?? null;
  const nationalIdOrUndefined = resolvedNationalId ?? undefined;
  const companyIdOrUndefined = traineeCompanyId ?? undefined;
  const companyNameOrUndefined = traineeCompanyName ?? undefined;

  const attendance = await db.$transaction(async (tx) => {
    const created = await tx.attendance.create({
      data: {
        sessionId: id,
        traineeName: resolvedName,
        traineeIdNational: resolvedNationalId,
        company: traineeCompanyName,
        companyId: traineeCompanyId,
        checkInAt: now,
        status: "PRESENT",
        checkInMethod: "MANUAL",
        createdBy: user.id,
        updatedBy: user.id,
      },
    });

    await tx.checkInAttempt.create({
      data: {
        sessionId: id,
        traineeName: resolvedName,
        traineeEmail: null,
        traineeIdNational: resolvedNationalId,
        ipAddress,
        userAgent,
        success: true,
      },
    });

    await tx.trainingSession.update({
      where: { id },
      data: { actualTrainees: { increment: 1 }, updatedBy: user.id },
    });

    return created;
  });

  // ── Sync SessionEnrollment: attendance checked in ──
  await syncAttendanceCheckedIn({
    sessionId: id,
    traineeName: resolvedName,
    traineeIdNational: nationalIdOrUndefined,
    attendanceId: attendance.id,
    attendanceStatus: "PRESENT",
    userId: user.id,
  });

  // ── Auto-assign Pre-Test if the course has one (mirrors QR check-in) ──
  let preTestAttempt: { attemptId: string; refNumber: string } | null = null;
  if (session.course?.hasPreTest) {
    try {
      const examAttempt = await createExamAttempt({
        sessionId: id,
        attendanceId: attendance.id,
        testType: "PRE_TEST",
        traineeName: resolvedName,
        traineeEmail: undefined,
        traineeIdNational: nationalIdOrUndefined,
        companyId: companyIdOrUndefined,
        createdBy: user.id,
      });

      await db.attendance.update({
        where: { id: attendance.id },
        data: { preTestAssignedAt: now },
      });

      await syncPreTestStatus({
        sessionId: id,
        traineeName: resolvedName,
        traineeIdNational: nationalIdOrUndefined,
        attendanceId: attendance.id,
        status: "PENDING",
        userId: user.id,
      });

      preTestAttempt = { attemptId: examAttempt.attemptId, refNumber: examAttempt.refNumber };

      await recordAudit({
        userId: user.id,
        action: "CREATE",
        entity: "EXAM",
        entityId: examAttempt.attemptId,
        entityRef: examAttempt.refNumber,
        description: `Auto-assigned Pre-Test ${examAttempt.refNumber} to ${resolvedName} after manual check-in`,
        descriptionAr: `تعيين اختبار قبلي ${examAttempt.refNumber} تلقائياً لـ ${resolvedName} بعد التحضير اليدوي`,
        req,
        metadata: { sessionId: id, attendanceId: attendance.id, testType: "PRE_TEST" },
      });
    } catch (e) {
      console.error("[Pre-Test auto-assign error]", e);
      await syncPreTestStatus({
        sessionId: id,
        traineeName: resolvedName,
        traineeIdNational: nationalIdOrUndefined,
        attendanceId: attendance.id,
        status: "NOT_REQUIRED",
        userId: user.id,
      });
    }
  } else {
    await syncPreTestStatus({
      sessionId: id,
      traineeName: resolvedName,
      traineeIdNational: nationalIdOrUndefined,
      attendanceId: attendance.id,
      status: "NOT_REQUIRED",
      userId: user.id,
    });
  }

  await audit({
    user,
    action: "CREATE",
    entity: "ATTENDANCE",
    entityId: attendance.id,
    entityRef: session.refNumber,
    description: `Manual check-in: ${resolvedName} for session ${session.refNumber}`,
    descriptionAr: `تحضير يدوي: ${resolvedName} للجلسة ${session.refNumber}`,
    req,
    metadata: {
      sessionId: id,
      checkInMethod: "MANUAL",
      preTestAssigned: !!preTestAttempt,
    },
  });

  return created({
    attendance,
    preTestAttempt,
    session: { refNumber: session.refNumber, title: session.title },
  });
});
