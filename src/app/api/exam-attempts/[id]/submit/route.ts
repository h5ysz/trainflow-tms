// /api/exam-attempts/[id]/submit — submit answers, grade the exam, record results
import { db } from "@/lib/db";
import { withExamAction, ok, notFound, fail, audit, type TestType } from "@/lib/auth/api";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";
import { parseBody } from "@/lib/api/validate";
import { examSubmitSchema } from "@/lib/api/schemas";
import { gradeExamAttempt } from "@/lib/api/exam-engine";
import { recordAudit } from "@/lib/auth/audit";
import { updateAttendanceProgress } from "@/lib/api/certificate-eligibility";
import { nextRefNumber } from "@/lib/api/ref-number";
import {
  syncPreTestStatus,
  syncFinalTestStatus,
  recalcCertificateEligibility,
} from "@/lib/api/enrollment-sync";

export const POST = withExamAction("create", async ({ req, params, user, allowedTestTypes }) => {
  const id = params.id as string;
  const attempt = await db.examAttempt.findUnique({ where: { id } });
  if (!attempt || attempt.deletedAt) return notFound("Exam attempt not found");

  // A trainer may only run exams for their own sessions.
  if (user.role === "TRAINER") {
    const session = await db.trainingSession.findUnique({
      where: { id: attempt.sessionId },
      select: { trainerId: true },
    });
    if (trainerDeniedSession(user, session?.trainerId)) {
      return fail("Forbidden — you can only run exams for your own sessions", 403);
    }
  }

  // The guard admits anyone holding `create` on pre-test OR final-test; this narrows
  // it to the module the attempt actually belongs to.
  if (!allowedTestTypes.includes(attempt.testType as TestType)) {
    return fail(`Forbidden — cannot submit a ${attempt.testType === "FINAL_TEST" ? "final" : "pre"} test`, 403);
  }

  // Must be IN_PROGRESS to submit
  if (attempt.status !== "IN_PROGRESS") {
    return fail(
      `Cannot submit exam: current status is ${attempt.status}. Must be IN_PROGRESS.`,
      400,
      "INVALID_STATUS"
    );
  }

  const parsed = await parseBody(req, examSubmitSchema);
  if ("error" in parsed) return parsed.error;
  const { answers } = parsed.data;

  // Grade the exam
  const grading = await gradeExamAttempt({ attemptId: id, answers });

  const now = new Date();
  const durationSec = attempt.startedAt
    ? Math.round((now.getTime() - attempt.startedAt.getTime()) / 1000)
    : null;

  // Update the exam attempt
  const updated = await db.examAttempt.update({
    where: { id },
    data: {
      status: "GRADED",
      scorePercent: grading.scorePercent,
      passed: grading.passed,
      submittedAt: now,
      durationSec,
      answers: JSON.stringify(grading.answers),
      updatedBy: user.id,
    },
  });

  // Also create a TestResult record for backwards compatibility + reporting
  const testResultRef = await nextRefNumber("EXAM");
  await db.testResult.create({
    data: {
      refNumber: testResultRef,
      sessionId: attempt.sessionId,
      testType: attempt.testType,
      traineeName: attempt.traineeName,
      traineeEmail: attempt.traineeEmail ?? null,
      traineeIdNational: attempt.traineeIdNational ?? null,
      companyId: attempt.companyId ?? null, // trainee's original company — preserved
      scorePercent: grading.scorePercent,
      passed: grading.passed,
      answers: JSON.stringify(grading.answers),
      attemptedAt: now,
      durationSec,
      questionSet: attempt.questionSet,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  // Update attendance progress tracking
  if (attempt.attendanceId) {
    await updateAttendanceProgress({
      attendanceId: attempt.attendanceId,
      step: attempt.testType === "PRE_TEST" ? "pre_test" : "final_test",
      passed: grading.passed,
      userId: user.id,
    });
  }

  // ── Sync SessionEnrollment: exam completed/graded ──
  if (attempt.testType === "PRE_TEST") {
    await syncPreTestStatus({
      sessionId: attempt.sessionId,
      traineeName: attempt.traineeName,
      traineeIdNational: attempt.traineeIdNational ?? undefined,
      attendanceId: attempt.attendanceId ?? undefined,
      status: "COMPLETED",
      userId: user.id,
    });
  } else {
    await syncFinalTestStatus({
      sessionId: attempt.sessionId,
      traineeName: attempt.traineeName,
      traineeIdNational: attempt.traineeIdNational ?? undefined,
      attendanceId: attempt.attendanceId ?? undefined,
      status: grading.passed ? "PASSED" : "FAILED",
      userId: user.id,
    });
  }

  // ── Recalculate certificate eligibility on SessionEnrollment ──
  await recalcCertificateEligibility({
    sessionId: attempt.sessionId,
    traineeName: attempt.traineeName,
    traineeIdNational: attempt.traineeIdNational ?? undefined,
    attendanceId: attempt.attendanceId ?? undefined,
    userId: user.id,
  });

  // Audit: EXAM_SUBMIT
  await recordAudit({
    userId: user.id,
    action: "EXAM_SUBMIT",
    entity: "EXAM",
    entityId: id,
    entityRef: attempt.refNumber,
    description: `Submitted ${attempt.testType} exam ${attempt.refNumber}: ${grading.scorePercent}% (${grading.passed ? "Passed" : "Failed"})`,
    descriptionAr: `تسليم اختبار ${attempt.testType === "PRE_TEST" ? "قبلي" : "نهائي"} ${attempt.refNumber}: ${grading.scorePercent}% (${grading.passed ? "ناجح" : "راسب"})`,
    req,
    metadata: {
      sessionId: attempt.sessionId,
      scorePercent: grading.scorePercent,
      passed: grading.passed,
      passScore: attempt.passScore,
      durationSec,
      totalPoints: grading.totalPoints,
      earnedPoints: grading.earnedPoints,
    },
  });

  return ok({
    attemptId: id,
    refNumber: attempt.refNumber,
    testType: attempt.testType,
    status: "GRADED",
    scorePercent: grading.scorePercent,
    passed: grading.passed,
    passScore: attempt.passScore,
    durationSec,
    totalPoints: grading.totalPoints,
    earnedPoints: grading.earnedPoints,
    answers: grading.answers,
  });
});
