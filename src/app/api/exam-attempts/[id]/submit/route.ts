// /api/exam-attempts/[id]/submit — submit answers, grade the exam, record results
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { gradeExamAttempt } from "@/lib/api/exam-engine";
import { recordAudit } from "@/lib/auth/audit";
import { updateAttendanceProgress } from "@/lib/api/certificate-eligibility";
import { nextRefNumber } from "@/lib/api/ref-number";

export const POST = withModuleAction("pre-test", "view", async ({ req, params, user }) => {
  const id = params.id as string;
  const attempt = await db.examAttempt.findUnique({ where: { id } });
  if (!attempt || attempt.deletedAt) return notFound("Exam attempt not found");

  // Must be IN_PROGRESS to submit
  if (attempt.status !== "IN_PROGRESS") {
    return fail(
      `Cannot submit exam: current status is ${attempt.status}. Must be IN_PROGRESS.`,
      400,
      "INVALID_STATUS"
    );
  }

  const body = await req.json().catch(() => ({}));
  const { answers } = body as { answers: Array<{ questionId: string; selectedAnswerIndices: number[] }> };

  if (!Array.isArray(answers)) {
    return fail("answers array is required", 422, "VALIDATION_ERROR");
  }

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
