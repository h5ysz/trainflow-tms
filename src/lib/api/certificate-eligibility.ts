// GCCLAB TMS — Certificate Eligibility Service
// =====================================================================
// A certificate can only be generated when ALL of the following are true:
//   1. Attendance is completed (trainee checked in, status = PRESENT)
//   2. Final Test was passed (ExamAttempt FINAL_TEST with passed=true)
//   3. Course Evaluation was submitted (CourseEvaluation exists for this trainee+session)
//
// This module checks all 3 conditions and returns a detailed eligibility report.

import { db } from "@/lib/db";

export interface CertificateEligibility {
  eligible: boolean;
  attendanceCompleted: boolean;
  finalTestPassed: boolean;
  evaluationCompleted: boolean;
  attendanceId?: string;
  finalTestScore?: number;
  evaluationId?: string;
  reasons: string[];
}

/**
 * Check if a trainee is eligible for a certificate.
 * Identified by (sessionId + traineeName) or by attendanceId.
 */
export async function checkCertificateEligibility(opts: {
  sessionId: string;
  traineeName: string;
  traineeEmail?: string;
  traineeIdNational?: string;
}): Promise<CertificateEligibility> {
  const { sessionId, traineeName, traineeEmail, traineeIdNational } = opts;

  const reasons: string[] = [];

  // 1. Check attendance — must be PRESENT
  const attendance = await db.attendance.findFirst({
    where: {
      sessionId,
      traineeName: { equals: traineeName },
      deletedAt: null,
      ...(traineeIdNational ? { traineeIdNational } : {}),
    },
  });

  const attendanceCompleted = !!attendance && attendance.status === "PRESENT" && !!attendance.checkInAt;
  if (!attendance) {
    reasons.push("No attendance record found for this trainee");
  } else if (attendance.status !== "PRESENT") {
    reasons.push(`Attendance status is ${attendance.status}, must be PRESENT`);
  } else if (!attendance.checkInAt) {
    reasons.push("Trainee has not checked in");
  }

  // 2. Check final test — must have a passed ExamAttempt
  const finalTestAttempt = await db.examAttempt.findFirst({
    where: {
      sessionId,
      testType: "FINAL_TEST",
      traineeName: { equals: traineeName },
      status: "GRADED",
      passed: true,
      deletedAt: null,
      ...(traineeIdNational ? { traineeIdNational } : {}),
    },
    orderBy: { submittedAt: "desc" },
  });

  const finalTestPassed = !!finalTestAttempt;
  if (!finalTestPassed) {
    reasons.push("Final test not passed (or not yet taken)");
  }

  // 3. Check course evaluation — must exist
  const evaluation = await db.courseEvaluation.findFirst({
    where: {
      sessionId,
      traineeName: { equals: traineeName },
      deletedAt: null,
      ...(traineeIdNational ? { traineeIdNational } : {}),
    },
  });

  const evaluationCompleted = !!evaluation;
  if (!evaluationCompleted) {
    reasons.push("Course evaluation not submitted");
  }

  const eligible = attendanceCompleted && finalTestPassed && evaluationCompleted;

  return {
    eligible,
    attendanceCompleted,
    finalTestPassed,
    evaluationCompleted,
    attendanceId: attendance?.id,
    finalTestScore: finalTestAttempt?.scorePercent ?? undefined,
    evaluationId: evaluation?.id,
    reasons: eligible ? [] : reasons,
  };
}

/**
 * Update the attendance record's progress tracking fields
 * after a pipeline step is completed (pre-test, final test, evaluation).
 */
export async function updateAttendanceProgress(opts: {
  attendanceId: string;
  step: "pre_test" | "final_test" | "evaluation";
  passed?: boolean;
  userId: string;
}): Promise<void> {
  const { attendanceId, step, passed, userId } = opts;
  const now = new Date();

  const updates: Record<string, unknown> = { updatedBy: userId };

  if (step === "pre_test") {
    updates.preTestCompletedAt = now;
  } else if (step === "final_test") {
    updates.finalTestCompletedAt = now;
    updates.finalTestPassed = passed ?? false;
  } else if (step === "evaluation") {
    updates.evaluationCompletedAt = now;
  }

  // Check if all conditions are met for certificate eligibility
  const attendance = await db.attendance.findUnique({ where: { id: attendanceId } });
  if (attendance) {
    const eligibility = await checkCertificateEligibility({
      sessionId: attendance.sessionId,
      traineeName: attendance.traineeName,
      traineeIdNational: attendance.traineeIdNational ?? undefined,
    });
    if (eligibility.eligible) {
      updates.certificateEligible = true;
    }
  }

  await db.attendance.update({
    where: { id: attendanceId },
    data: updates,
  });
}
