// /api/exam-sets/[id]/approve — approve a DRAFT: it becomes the set the session's exam uses
import { db } from "@/lib/db";
import { withExamAction, audit } from "@/lib/auth/api";
import { ok, notFound } from "@/lib/api/response";
import { toExamSetDto, approveSet } from "@/lib/api/exam-sets";

export const POST = withExamAction("edit", async ({ params, user, req }) => {
  const setId = String(params.id ?? "");
  const set = await db.sessionExamSet.findUnique({ where: { id: setId } });
  if (!set || set.deletedAt) return notFound("Exam question set not found");

  const updated = await approveSet({ setId, userId: user.id });

  await audit({
    user,
    action: "UPDATE",
    entity: "EXAM",
    entityId: setId,
    description: `Approved exam question set v${updated.version} (${updated.numQuestions} questions) — now used by the session's exam`,
    descriptionAr: `تم اعتماد أسئلة الاختبار v${updated.version} (${updated.numQuestions} سؤال) — أصبحت مستخدمة في اختبار الجلسة`,
    req,
  });

  return ok(await toExamSetDto(updated));
});
