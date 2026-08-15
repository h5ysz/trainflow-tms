// /api/exam-attempts/[id] — get exam attempt details
import { db } from "@/lib/db";
import { withExamAction, isExamResultsOnly, ok, notFound, fail, type TestType } from "@/lib/auth/api";
import { resolveExamVersion } from "@/lib/api/exam-engine";
import { parseJsonColumn } from "@/lib/api/json-column";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";

export const GET = withExamAction("view", async ({ params, user, allowedTestTypes }) => {
  const id = params.id as string;
  const attempt = await db.examAttempt.findUnique({
    where: { id },
    include: {
      session: {
        select: {
          id: true, refNumber: true, title: true, trainerId: true,
          course: { select: { id: true, title: true, code: true, refNumber: true } },
        },
      },
    },
  });
  if (!attempt || attempt.deletedAt) return notFound("Exam attempt not found");
  // A trainer may only open attempts from their own sessions.
  if (trainerDeniedSession(user, attempt.session?.trainerId)) {
    return fail("Forbidden — you can only access attempts from your own sessions", 403);
  }
  if (!allowedTestTypes.includes(attempt.testType as TestType)) {
    return fail(`Forbidden — no access to ${attempt.testType} attempts`, 403);
  }

  const resultsOnly = isExamResultsOnly(user);
  return ok({
    ...attempt,
    // A results-only caller (coordinator) may see the score but never the
    // question content itself.
    questionSet: resultsOnly ? [] : parseJsonColumn(attempt.questionSet, [], "examAttempt.questionSet"),
    answers: resultsOnly ? null : parseJsonColumn(attempt.answers, null, "examAttempt.answers"),
  });
});
