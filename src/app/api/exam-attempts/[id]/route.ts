// /api/exam-attempts/[id] — get exam attempt details
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound } from "@/lib/auth/api";
import { resolveExamVersion } from "@/lib/api/exam-engine";

export const GET = withModuleAction("pre-test", "view", async ({ params }) => {
  const id = params.id as string;
  const attempt = await db.examAttempt.findUnique({
    where: { id },
    include: {
      session: {
        select: {
          id: true, refNumber: true, title: true,
          course: { select: { id: true, title: true, code: true, refNumber: true } },
        },
      },
    },
  });
  if (!attempt || attempt.deletedAt) return notFound("Exam attempt not found");

  return ok({
    ...attempt,
    questionSet: attempt.questionSet ? JSON.parse(attempt.questionSet) : [],
    answers: attempt.answers ? JSON.parse(attempt.answers) : null,
  });
});
