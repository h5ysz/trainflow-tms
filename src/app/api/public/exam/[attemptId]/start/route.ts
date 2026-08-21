// /api/public/exam/[attemptId]/start — start an exam attempt (public, no auth)
import { ok, fail } from "@/lib/auth/api";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";
import { resolveExamVersion, examDeadlineFrom } from "@/lib/api/exam-engine";

export async function POST(
  req: Request,
  context: { params: Promise<{ attemptId: string }> }
) {
  const rl = checkRateLimit(req, "public:exam:start", { limit: 10, windowMs: 60_000 });
  if (!rl.ok) return fail("Too many requests.", 429, "RATE_LIMITED");

  const { attemptId } = await context.params;
  const attempt = await db.examAttempt.findUnique({ where: { id: attemptId } });
  if (!attempt || attempt.deletedAt) return fail("Exam attempt not found", 404);

  if (attempt.status === "GRADED") {
    return fail("This exam has already been completed", 400, "ALREADY_COMPLETED");
  }

  // If ASSIGNED, transition to IN_PROGRESS
  let currentAttempt = attempt;
  if (attempt.status === "ASSIGNED") {
    const deadline = examDeadlineFrom(new Date());
    currentAttempt = await db.examAttempt.update({
      where: { id: attemptId },
      data: { status: "IN_PROGRESS", startedAt: new Date(), deadline },
    });
  }

  // Resolve the exam version (questions with shuffled options)
  const version = await resolveExamVersion(attemptId);
  if (!version) return fail("Failed to load exam questions", 500, "EXAM_ERROR");

  return ok({
    attemptId,
    refNumber: currentAttempt.refNumber,
    testType: currentAttempt.testType,
    passScore: currentAttempt.passScore ?? 70,
    deadline: currentAttempt.status === "IN_PROGRESS" ? currentAttempt.deadline : null,
    questions: version.questions.map((q) => ({
      id: q.id,
      order: q.order,
      text: q.text,
      textAr: q.textAr,
      imageUrl: q.imageUrl,
      type: q.type,
      points: q.points,
      options: q.options,
      optionsAr: q.optionsAr,
    })),
  });
}
