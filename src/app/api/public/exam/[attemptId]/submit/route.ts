// /api/public/exam/[attemptId]/submit — submit exam answers (public, no auth)
import { ok, fail } from "@/lib/auth/api";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";
import { gradeExamAttempt } from "@/lib/api/exam-engine";
import { syncPreTestStatus, syncFinalTestStatus } from "@/lib/api/enrollment-sync";

export async function POST(
  req: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  const rl = checkRateLimit(req, "public:exam:submit", { limit: 5, windowMs: 60_000 });
  if (!rl.ok) return fail("Too many requests.", 429, "RATE_LIMITED");

  const { attemptId } = await context.params;
  const attempt = await db.examAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.deletedAt) return fail("Exam attempt not found", 404);

  if (attempt.status === "GRADED") {
    return fail("This exam has already been graded", 400, "ALREADY_GRADED");
  }

  if (attempt.status === "ASSIGNED") {
    return fail("This exam has not been started yet", 400, "NOT_STARTED");
  }

  const body = await req.json().catch(() => ({}));
  const answers = Array.isArray(body.answers) ? body.answers : [];

  try {
    const result = await gradeExamAttempt({
      attemptId,
      answers: answers.map((a: { questionId: string; selectedAnswerIndices: number[] }) => ({
        questionId: a.questionId,
        selectedAnswerIndices: a.selectedAnswerIndices ?? [],
      })),
    });

    // Update the attempt with results
    const timedOut = body.timedOut === true;
    await db.examAttempt.update({
      where: { id: attemptId },
      data: {
        status: "GRADED",
        scorePercent: result.scorePercent,
        passed: result.passed,
        answers: JSON.stringify(result.answers),
        submittedAt: new Date(),
        timedOut,
      },
    });

    // Sync enrollment status
    if (attempt.testType === "PRE_TEST") {
      await syncPreTestStatus({
        sessionId: attempt.sessionId,
        traineeName: attempt.traineeName,
        traineeIdNational: attempt.traineeIdNational ?? undefined,
        attendanceId: attempt.attendanceId ?? undefined,
        status: "COMPLETED",
        userId: null,
      });
    } else {
      await syncFinalTestStatus({
        sessionId: attempt.sessionId,
        traineeName: attempt.traineeName,
        traineeIdNational: attempt.traineeIdNational ?? undefined,
        attendanceId: attempt.attendanceId ?? undefined,
        status: result.passed ? "PASSED" : "FAILED",
        userId: null,
      });
    }

    return ok({
      refNumber: attempt.refNumber,
      testType: attempt.testType,
      scorePercent: result.scorePercent,
      passed: result.passed,
      passScore: attempt.passScore ?? 70,
      totalPoints: result.totalPoints,
      earnedPoints: result.earnedPoints,
      timedOut,
    });
  } catch (e) {
    return fail((e as Error).message || "Failed to grade exam", 500, "GRADING_ERROR");
  }
}
