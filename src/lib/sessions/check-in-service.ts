// QR attendance check-in.
//
// Extracted from the old `/api/sessions/[id]/check-in` route, which required a logged-in
// user — impossible for the trainee actually holding the phone — and was addressed by
// session id even though the QR only carries a token. This service is keyed on the
// token and accepts a null actor.
import { db } from "@/lib/db";
import { createExamAttempt } from "@/lib/api/exam-engine";
import { recordAudit } from "@/lib/auth/audit";
import { syncAttendanceCheckedIn, syncPreTestStatus } from "@/lib/api/enrollment-sync";

export type CheckInSource = "PUBLIC_QR" | "STAFF";

export type CheckInErrorCode =
  | "INVALID_QR"
  | "QR_NOT_YET_ACTIVE"
  | "QR_EXPIRED"
  | "DUPLICATE_CHECK_IN"
  | "CAPACITY_REACHED";

export class CheckInError extends Error {
  readonly code: CheckInErrorCode;
  readonly details?: Record<string, unknown>;
  constructor(code: CheckInErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "CheckInError";
    this.code = code;
    this.details = details;
  }
}

export interface CheckInInput {
  qrCodeToken: string;
  traineeName: string;
  traineeIdNational?: string;
  traineeEmail?: string;
  traineePhone?: string;
  company?: string;
  companyId?: string;
  deviceFingerprint?: string;
}

export interface CheckInContext {
  actorUserId: string | null;
  source: CheckInSource;
  ipAddress: string | null;
  userAgent: string | null;
  req?: Request;
}

export type WindowState = "OPEN" | "NOT_YET" | "CLOSED";

/** Locate a session by its QR token. `qrCodeToken` is @unique, so this is an index hit. */
export async function findSessionByQrToken(token: string) {
  if (!token) return null;
  const session = await db.trainingSession.findUnique({
    where: { qrCodeToken: token },
    include: { course: true },
  });
  if (!session || session.deletedAt) return null;
  return session;
}

export function qrWindow(session: { qrActiveFrom: Date | null; qrActiveTo: Date | null; startDate: Date; endDate: Date }) {
  return {
    from: session.qrActiveFrom ?? session.startDate,
    to: session.qrActiveTo ?? session.endDate,
  };
}

export function windowState(
  session: { qrActiveFrom: Date | null; qrActiveTo: Date | null; startDate: Date; endDate: Date },
  now: Date = new Date()
): WindowState {
  const { from, to } = qrWindow(session);
  if (now < from) return "NOT_YET";
  if (now > to) return "CLOSED";
  return "OPEN";
}

/** Normalised name key. SQLite string comparison is case- and whitespace-sensitive. */
function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

async function logFailure(
  sessionId: string,
  input: CheckInInput,
  ctx: CheckInContext,
  reason: string
): Promise<void> {
  await db.checkInAttempt.create({
    data: {
      sessionId,
      qrToken: input.qrCodeToken,
      traineeName: input.traineeName,
      traineeEmail: input.traineeEmail ?? null,
      traineeIdNational: input.traineeIdNational ?? null,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
      success: false,
      failureReason: reason,
    },
  });
}

/**
 * How many failed attempts this IP has made recently. The in-memory rate limiter resets
 * on every process restart (which on Render's free plan is often), so persistent abuse
 * is tracked in the database instead.
 */
export async function recentFailureCount(ipAddress: string | null, withinMs = 10 * 60_000): Promise<number> {
  if (!ipAddress) return 0;
  return db.checkInAttempt.count({
    where: {
      ipAddress,
      success: false,
      attendedAt: { gte: new Date(Date.now() - withinMs) },
    },
  });
}

export interface CheckInResult {
  attendanceId: string;
  checkInAt: Date | null;
  status: string;
  preTestAssigned: boolean;
  session: {
    refNumber: string;
    title: string;
    courseTitle: string | null;
  };
}

export async function performCheckIn(input: CheckInInput, ctx: CheckInContext): Promise<CheckInResult> {
  const now = new Date();

  // 1. Resolve the session from the token itself.
  const session = await findSessionByQrToken(input.qrCodeToken);
  if (!session) {
    throw new CheckInError("INVALID_QR", "This QR code is not valid.");
  }

  // 2. QR activity window — the primary abuse control. A code that has been
  //    photographed still stops working once the session's window closes.
  const { from, to } = qrWindow(session);
  const state = windowState(session, now);
  if (state === "NOT_YET") {
    await logFailure(session.id, input, ctx, "QR not yet active");
    throw new CheckInError("QR_NOT_YET_ACTIVE", "Check-in has not opened for this session yet.", {
      qrActiveFrom: from,
      qrActiveTo: to,
    });
  }
  if (state === "CLOSED") {
    await logFailure(session.id, input, ctx, "QR expired");
    throw new CheckInError("QR_EXPIRED", "Check-in for this session has closed.", {
      qrActiveFrom: from,
      qrActiveTo: to,
    });
  }

  // 3. Duplicate check. National ID is authoritative; otherwise compare normalised
  //    names, because `traineeName: { equals: … }` let "ahmed ali" and "Ahmed Ali "
  //    both through as distinct people.
  const nationalId = input.traineeIdNational?.trim();
  let existing: { id: string; checkInAt: Date | null } | null = null;
  if (nationalId) {
    existing = await db.attendance.findFirst({
      where: { sessionId: session.id, traineeIdNational: nationalId, deletedAt: null },
    });
  } else {
    const sameSession = await db.attendance.findMany({
      where: { sessionId: session.id, deletedAt: null },
      select: { id: true, traineeName: true, checkInAt: true },
    });
    const key = nameKey(input.traineeName);
    existing = sameSession.find((a) => nameKey(a.traineeName) === key) ?? null;
  }

  if (existing) {
    await logFailure(session.id, input, ctx, "Already checked in");
    throw new CheckInError("DUPLICATE_CHECK_IN", "You are already checked in for this session.", {
      checkInAt: existing.checkInAt,
    });
  }

  // 4. Device info
  const deviceInfo = JSON.stringify({
    userAgent: ctx.userAgent,
    ipAddress: ctx.ipAddress,
    platform: input.deviceFingerprint ? "mobile" : "web",
    deviceFingerprint: input.deviceFingerprint ?? null,
    source: ctx.source,
    timestamp: now.toISOString(),
  });

  // 5. Multi-company: a trainee keeps their OWN company, which may differ from the
  //    company that requested the session.
  let traineeCompanyId = input.companyId ?? null;
  let traineeCompanyName = input.company ?? null;
  if (nationalId) {
    const trainee = await db.trainee.findFirst({
      where: { nationalId, deletedAt: null },
      include: { company: { select: { id: true, name: true } } },
    });
    if (trainee) {
      traineeCompanyId = trainee.companyId;
      traineeCompanyName = trainee.company?.name ?? null;
    }
  }

  // 6. Claim a seat and create the attendance row atomically.
  //
  //    Capacity used to be a read followed by an unconditional increment, so two
  //    simultaneous scans of the last seat both passed. The conditional updateMany
  //    makes the seat claim itself the check: if it updates zero rows, the session
  //    was full.
  const attendance = await db.$transaction(async (tx) => {
    const claimed = await tx.trainingSession.updateMany({
      where: { id: session.id, actualTrainees: { lt: session.capacity } },
      data: { actualTrainees: { increment: 1 }, updatedBy: ctx.actorUserId },
    });
    if (claimed.count === 0) {
      throw new CheckInError("CAPACITY_REACHED", `This session is full (${session.capacity} places).`);
    }

    const created = await tx.attendance.create({
      data: {
        sessionId: session.id,
        traineeName: input.traineeName.trim(),
        traineeIdNational: nationalId ?? null,
        traineeEmail: input.traineeEmail ?? null,
        traineePhone: input.traineePhone ?? null,
        company: traineeCompanyName,
        companyId: traineeCompanyId,
        checkInAt: now,
        status: "PRESENT",
        checkInMethod: "QR",
        deviceInfo,
        createdBy: ctx.actorUserId,
        updatedBy: ctx.actorUserId,
      },
    });

    await tx.checkInAttempt.create({
      data: {
        sessionId: session.id,
        qrToken: input.qrCodeToken,
        traineeName: input.traineeName,
        traineeEmail: input.traineeEmail ?? null,
        traineeIdNational: nationalId ?? null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        success: true,
      },
    });

    return created;
  });

  // ── Post-check-in side effects ────────────────────────────────────────────
  // Deliberately outside the transaction: assigning a pre-test calls nextRefNumber,
  // which writes through the global client and would deadlock SQLite's single writer
  // while the transaction above still holds it.
  await syncAttendanceCheckedIn({
    sessionId: session.id,
    traineeName: input.traineeName,
    traineeIdNational: nationalId,
    attendanceId: attendance.id,
    attendanceStatus: "PRESENT",
    userId: ctx.actorUserId,
  });

  let preTestAssigned = false;
  if (session.course?.hasPreTest) {
    try {
      const examAttempt = await createExamAttempt({
        sessionId: session.id,
        attendanceId: attendance.id,
        testType: "PRE_TEST",
        traineeName: input.traineeName,
        traineeEmail: input.traineeEmail,
        traineeIdNational: nationalId,
        companyId: traineeCompanyId ?? undefined,
        createdBy: ctx.actorUserId,
      });

      await db.attendance.update({
        where: { id: attendance.id },
        data: { preTestAssignedAt: now },
      });

      await syncPreTestStatus({
        sessionId: session.id,
        traineeName: input.traineeName,
        traineeIdNational: nationalId,
        attendanceId: attendance.id,
        status: "PENDING",
        userId: ctx.actorUserId,
      });

      preTestAssigned = true;

      await recordAudit({
        userId: ctx.actorUserId,
        action: "CREATE",
        entity: "EXAM",
        entityId: examAttempt.attemptId,
        entityRef: examAttempt.refNumber,
        description: `Auto-assigned Pre-Test ${examAttempt.refNumber} to ${input.traineeName} after QR check-in`,
        descriptionAr: `تعيين اختبار قبلي ${examAttempt.refNumber} تلقائياً لـ ${input.traineeName} بعد تسجيل الحضور`,
        req: ctx.req,
        metadata: { sessionId: session.id, attendanceId: attendance.id, testType: "PRE_TEST" },
      });
    } catch (e) {
      // An empty question bank must not cost the trainee their attendance.
      console.error("[Pre-Test auto-assign error]", e);
      await syncPreTestStatus({
        sessionId: session.id,
        traineeName: input.traineeName,
        traineeIdNational: nationalId,
        attendanceId: attendance.id,
        status: "NOT_REQUIRED",
        userId: ctx.actorUserId,
      });
    }
  } else {
    await syncPreTestStatus({
      sessionId: session.id,
      traineeName: input.traineeName,
      traineeIdNational: nationalId,
      attendanceId: attendance.id,
      status: "NOT_REQUIRED",
      userId: ctx.actorUserId,
    });
  }

  await recordAudit({
    userId: ctx.actorUserId,
    action: "CREATE",
    entity: "ATTENDANCE",
    entityId: attendance.id,
    entityRef: session.refNumber,
    description: `QR check-in (${ctx.source}): ${input.traineeName} for session ${session.refNumber}`,
    descriptionAr: `تسجيل حضور بـ QR: ${input.traineeName} للجلسة ${session.refNumber}`,
    req: ctx.req,
    metadata: {
      sessionId: session.id,
      checkInMethod: "QR",
      source: ctx.source,
      preTestAssigned,
    },
  });

  return {
    attendanceId: attendance.id,
    checkInAt: attendance.checkInAt,
    status: attendance.status,
    preTestAssigned,
    session: {
      refNumber: session.refNumber,
      title: session.title,
      courseTitle: session.course?.title ?? null,
    },
  };
}
