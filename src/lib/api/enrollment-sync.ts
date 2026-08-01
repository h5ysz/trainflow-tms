// GCCLAB TMS — Session Enrollment Sync Service
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
 * Normalize a name for fuzzy matching: trim, lowercase, collapse internal
 * whitespace. The public check-in form lets trainees type their name freely,
 * so exact equality misses trailing spaces / double spaces / missing middle
 * names. This normaliser is the same one used by check-in-service.ts.
 */
function nameKey(name: string | null | undefined): string {
  if (!name) return "";
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

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
      // Find enrollment by session + normalised name match OR nationalId match
      const enrollments = await db.sessionEnrollment.findMany({
        where: { sessionId: attendance.sessionId, deletedAt: null },
        include: { trainee: { select: { fullName: true, nationalId: true } } },
      });
      const attNameKey = nameKey(attendance.traineeName);
      const match = enrollments.find(
        (e) =>
          nameKey(e.trainee.fullName) === attNameKey ||
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
    const optNameKey = nameKey(opts.traineeName);
    const match = enrollments.find(
      (e) =>
        (optNameKey && nameKey(e.trainee.fullName) === optNameKey) ||
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
  // Null for anonymous public check-in — the audit columns are all nullable.
  userId: string | null;
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
  // Null for anonymous public check-in — the audit columns are all nullable.
  userId: string | null;
}): Promise<void> {
  const enrollment = await findEnrollment({
    sessionId: opts.sessionId,
    traineeName: opts.traineeName,
    traineeIdNational: opts.traineeIdNational,
    attendanceId: opts.attendanceId,
  });

  if (!enrollment) return;

  // ── Regression guard ──────────────────────────────────────────────────
  // Don't regress from a terminal/progressed state. Ordinal: NOT_REQUIRED < PENDING < IN_PROGRESS < COMPLETED.
  // This prevents a later sync call (e.g. from a catch block setting NOT_REQUIRED)
  // from overwriting a COMPLETED status.
  const PRE_TEST_ORDINAL: Record<string, number> = {
    NOT_REQUIRED: 0,
    PENDING: 1,
    IN_PROGRESS: 2,
    COMPLETED: 3,
  };
  const current = await db.sessionEnrollment.findUnique({
    where: { id: enrollment.id },
    select: { preTestStatus: true },
  });
  if (current && (PRE_TEST_ORDINAL[opts.status] ?? 0) < (PRE_TEST_ORDINAL[current.preTestStatus] ?? 0)) {
    return; // Don't regress
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
  // Null for anonymous public check-in — the audit columns are all nullable.
  userId: string | null;
}): Promise<void> {
  const enrollment = await findEnrollment({
    sessionId: opts.sessionId,
    traineeName: opts.traineeName,
    traineeIdNational: opts.traineeIdNational,
    attendanceId: opts.attendanceId,
  });

  if (!enrollment) return;

  // ── Regression guard ──────────────────────────────────────────────────
  // Don't regress from a terminal state. Ordinal: NOT_REQUIRED < PENDING < IN_PROGRESS < PASSED/FAILED.
  // PASSED and FAILED are both terminal (ordinal 3) — neither regresses the other.
  const FINAL_TEST_ORDINAL: Record<string, number> = {
    NOT_REQUIRED: 0,
    PENDING: 1,
    IN_PROGRESS: 2,
    PASSED: 3,
    FAILED: 3,
  };
  const current = await db.sessionEnrollment.findUnique({
    where: { id: enrollment.id },
    select: { finalTestStatus: true },
  });
  if (current && (FINAL_TEST_ORDINAL[opts.status] ?? 0) < (FINAL_TEST_ORDINAL[current.finalTestStatus] ?? 0)) {
    return; // Don't regress
  }

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
  // Null for anonymous public check-in — the audit columns are all nullable.
  userId: string | null;
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
  // Null for anonymous public check-in — the audit columns are all nullable.
  userId: string | null;
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
  // Null for anonymous public check-in — the audit columns are all nullable.
  userId: string | null;
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
