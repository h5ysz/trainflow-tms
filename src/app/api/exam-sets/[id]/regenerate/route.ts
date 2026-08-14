// /api/exam-sets/[id]/regenerate — draw a new random sample into a DRAFT set
import { db } from "@/lib/db";
import { withExamAction, audit } from "@/lib/auth/api";
import { ok, notFound } from "@/lib/api/response";
import { toExamSetDto, regenerateDraftSet } from "@/lib/api/exam-sets";

export const POST = withExamAction("edit", async ({ params, user, req }) => {
  const setId = String(params.id ?? "");
  const set = await db.sessionExamSet.findUnique({ where: { id: setId }, include: { session: true } });
  if (!set || set.deletedAt) return notFound("Exam question set not found");
  if (!set.session) return notFound("Session not found");

  const body = await req.json().catch(() => ({}));
  const numQuestions = typeof body.numQuestions === "number" ? body.numQuestions : undefined;

  const updated = await regenerateDraftSet({ setId, courseId: set.session.courseId, numQuestions, userId: user.id });

  await audit({
    user,
    action: "UPDATE",
    entity: "EXAM",
    entityId: setId,
    description: `Regenerated draft exam question set v${updated.version} (${updated.numQuestions} questions)`,
    descriptionAr: `تمت إعادة توليد مسودة أسئلة الاختبار v${updated.version} (${updated.numQuestions} سؤال)`,
    req,
  });

  return ok(await toExamSetDto(updated));
});
