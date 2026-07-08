// TrainFlow TMS — Session Enrollment Sync Service
// =====================================================================
// Central service that keeps SessionEnrollment status fields in sync
// with downstream modules (Attendance, ExamAttempt, CourseEvaluation, Certificate).
//
// Every downstream operation calls these sync functions to update the
// corresponding status field on the SessionEnrollment record.
//
// This makes SessionEnrollment the single source of truth for trainee progress.

import { db } from "@/lib/db";

/**
 * Find a SessionEnrollment by (sessionId, traineeId) or by attendanceId.
 */
export async function findEnrollment(opts: {
  sessionId?: string;
  traineeId?: string;
  traineeName?: string;
  traineeIdNational?: string;
  attendanceId?: string;
}): Promise<{ id: string; sessionId: string; traineeId: string } | null> {
  // Try by attendanceId first (fastest)
  if (opts.attendanceId) {
    const attendance = await db.attendance.findUnique({
      where: { id: opts.attendanceId },
      select: { sessionId: true, traineeName: true, traineeIdNational: true },
    });
    if (attendance) {
      // Find enrollment by session + trainee name match
      const enrollments = await db.sessionEnrollment.findMany({
        where: { sessionId: attendance.sessionId, deletedAt: null },
        include: { trainee: { select: { fullName: true, nationalId: true } } },
      });
      const match = enrollments.find(
        (e) =>
          e.trainee.fullName === attendance.traineeName ||
          (attendance.traineeIdNational && e.trainee.nationalId === attendance.traineeIdNational)
      );
      if (match) return { id: match.id, sessionId: match.sessionId, traineeId: match.traineeId };
    }
  }

  // Try by sessionId + traineeId
  if (opts.sessionId && opts.traineeId) {
    const enrollment = await db.sessionEnrollment.findFirst({
      where: { sessionId: opts.sessionId, traineeId: opts.traineeId, deletedAt: null },
    });
    if (enrollment) return { id: enrollment.id, sessionId: enrollment.sessionId, traineeId: enrollment.traineeId };
  }

  // Try by sessionId + traineeName/traineeIdNational
  if (opts.sessionId && (opts.traineeName || opts.traineeIdNational)) {
    const enrollments = await db.sessionEnrollment.findMany({
      where: { sessionId: opts.sessionId, deletedAt: null },
      include: { trainee: { select: { fullName: true, nationalId: true } } },
    });
    const match = enrollments.find(
      (e) =>
        (opts.traineeName && e.trainee.fullName === opts.traineeName) ||
        (opts.traineeIdNational && e.trainee.nationalId === opts.traineeIdNational)
    );
    if (match) return { id: match.id, sessionId: match.sessionId, traineeId: match.traineeId };
  }

  return null;
}

// ─── Attendance sync ──────────────────────────────────────────────────

/**
 * Sync attendance status after QR check-in.
 * Sets: attendanceStatus = PRESENT | LATE | ABSENT
 *       enrollmentStatus = CHECKED_IN
 *       attendanceId = link to the attendance record
 */
export async function syncAttendanceCheckedIn(opts: {
  sessionId: string;
  traineeName?: string;
  traineeIdNational?: string;
  attendanceId: string;
  attendanceStatus: "PRESENT" | "LATE" | "ABSENT";
  userId: string;
}): Promise<void> {
  const enrollment = await findEnrollment({
    sessionId: opts.sessionId,
    traineeName: opts.traineeName,
    traineeIdNational: opts.traineeIdNational,
  });

  if (!enrollment) return; // No enrollment found — skip sync (backward compatible)

  await db.sessionEnrollment.update({
    where: { id: enrollment.id },
    data: {
      attendanceStatus: opts.attendanceStatus,
      enrollmentStatus: "CHECKED_IN",
      attendanceId: opts.attendanceId,
      updatedBy: opts.userId,
    },
  });
}

// ─── Pre-Test sync ────────────────────────────────────────────────────

/**
 * Sync pre-test status when an exam attempt is assigned/started/completed.
 */
export async function syncPreTestStatus(opts: {
  sessionId: string;
  traineeName?: string;
  traineeIdNational?: string;
  attendanceId?: string;
  status: "NOT_REQUIRED" | "PENDING" | "IN_PROGRESS" | "COMPLETED";
  userId: string;
}): Promise<void> {
  const enrollment = await findEnrollment({
    sessionId: opts.sessionId,
    traineeName: opts.traineeName,
    traineeIdNational: opts.traineeIdNational,
    attendanceId: opts.attendanceId,
  });

  if (!enrollment) return;

  // Only advance forward (don't regress from COMPLETED to PENDING)
  if (opts.status === "PENDING") {
    const current = await db.sessionEnrollment.findUnique({
      where: { id: enrollment.id },
      select: { preTestStatus: true },
    });
    if (current?.preTestStatus === "COMPLETED") return;
  }

  // If trainee has checked in, move enrollmentStatus to TRAINING when pre-test starts
  let enrollmentStatusUpdate: string | undefined;
  if (opts.status === "IN_PROGRESS") {
    enrollmentStatusUpdate = "TRAINING";
  }

  await db.sessionEnrollment.update({
    where: { id: enrollment.id },
    data: {
      preTestStatus: opts.status,
      ...(enrollmentStatusUpdate && { enrollmentStatus: enrollmentStatusUpdate }),
      updatedBy: opts.userId,
    },
  });
}

// ─── Final Test sync ──────────────────────────────────────────────────

/**
 * Sync final test status when an exam attempt is assigned/started/graded.
 */
export async function syncFinalTestStatus(opts: {
  sessionId: string;
  traineeName?: string;
  traineeIdNational?: string;
  attendanceId?: string;
  status: "NOT_REQUIRED" | "PENDING" | "IN_PROGRESS" | "PASSED" | "FAILED";
  userId: string;
}): Promise<void> {
  const enrollment = await findEnrollment({
    sessionId: opts.sessionId,
    traineeName: opts.traineeName,
    traineeIdNational: opts.traineeIdNational,
    attendanceId: opts.attendanceId,
  });

  if (!enrollment) return;

  await db.sessionEnrollment.update({
    where: { id: enrollment.id },
    data: {
      finalTestStatus: opts.status,
      updatedBy: opts.userId,
    },
  });
}

// ─── Evaluation sync ──────────────────────────────────────────────────

/**
 * Sync evaluation status when a course evaluation is submitted.
 */
export async function syncEvaluationStatus(opts: {
  sessionId: string;
  traineeName?: string;
  traineeIdNational?: string;
  attendanceId?: string;
  status: "NOT_REQUIRED" | "PENDING" | "COMPLETED";
  userId: string;
}): Promise<void> {
  const enrollment = await findEnrollment({
    sessionId: opts.sessionId,
    traineeName: opts.traineeName,
    traineeIdNational: opts.traineeIdNational,
    attendanceId: opts.attendanceId,
  });

  if (!enrollment) return;

  await db.sessionEnrollment.update({
    where: { id: enrollment.id },
    data: {
      evaluationStatus: opts.status,
      updatedBy: opts.userId,
    },
  });
}

// ─── Certificate sync ─────────────────────────────────────────────────

/**
 * Sync certificate status.
 * Also checks if all conditions are met → ELIGIBLE.
 * When certificate is generated → GENERATED.
 * When certificate PDF is issued → ISSUED.
 */
export async function syncCertificateStatus(opts: {
  sessionId: string;
  traineeName?: string;
  traineeIdNational?: string;
  attendanceId?: string;
  status: "NOT_ELIGIBLE" | "ELIGIBLE" | "GENERATED" | "ISSUED";
  userId: string;
}): Promise<void> {
  const enrollment = await findEnrollment({
    sessionId: opts.sessionId,
    traineeName: opts.traineeName,
    traineeIdNational: opts.traineeIdNational,
    attendanceId: opts.attendanceId,
  });

  if (!enrollment) return;

  // If certificate is generated/issued, also mark enrollment as COMPLETED
  let enrollmentStatusUpdate: string | undefined;
  let completedDateUpdate: Date | undefined;
  if (opts.status === "GENERATED" || opts.status === "ISSUED") {
    enrollmentStatusUpdate = "COMPLETED";
    completedDateUpdate = new Date();
  }

  await db.sessionEnrollment.update({
    where: { id: enrollment.id },
    data: {
      certificateStatus: opts.status,
      ...(enrollmentStatusUpdate && { enrollmentStatus: enrollmentStatusUpdate }),
      ...(completedDateUpdate && { completedDate: completedDateUpdate }),
      updatedBy: opts.userId,
    },
  });
}

/**
 * Recalculate and sync the certificate eligibility based on all pipeline statuses.
 * Called after each downstream operation to check if all conditions are met.
 */
export async function recalcCertificateEligibility(opts: {
  sessionId: string;
  traineeName?: string;
  traineeIdNational?: string;
  attendanceId?: string;
  userId: string;
}): Promise<void> {
  const enrollment = await findEnrollment({
    sessionId: opts.sessionId,
    traineeName: opts.traineeName,
    traineeIdNational: opts.traineeIdNational,
    attendanceId: opts.attendanceId,
  });

  if (!enrollment) return;

  const current = await db.sessionEnrollment.findUnique({
    where: { id: enrollment.id },
  });
  if (!current) return;

  // Check eligibility: attendance PRESENT + final test PASSED + evaluation COMPLETED
  const attendanceOk = current.attendanceStatus === "PRESENT" || current.attendanceStatus === "LATE";
  const finalTestOk = current.finalTestStatus === "PASSED";
  const evaluationOk = current.evaluationStatus === "COMPLETED" || current.evaluationStatus === "NOT_REQUIRED";

  const newCertStatus = attendanceOk && finalTestOk && evaluationOk ? "ELIGIBLE" : "NOT_ELIGIBLE";

  // Only update if status changed (and don't downgrade from GENERATED/ISSUED)
  if (
    newCertStatus !== current.certificateStatus &&
    current.certificateStatus !== "GENERATED" &&
    current.certificateStatus !== "ISSUED"
  ) {
    await db.sessionEnrollment.update({
      where: { id: enrollment.id },
      data: {
        certificateStatus: newCertStatus,
        updatedBy: opts.userId,
      },
    });
  }
}
