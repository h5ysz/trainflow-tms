// /api/exam-sets/[id] — view one set, or discard a DRAFT set
import { db } from "@/lib/db";
import { withExamAction, audit } from "@/lib/auth/api";
import { ok, notFound } from "@/lib/api/response";
import { toExamSetDto, discardSet } from "@/lib/api/exam-sets";

export const GET = withExamAction("view", async ({ params }) => {
  const setId = String(params.id ?? "");
  const set = await db.sessionExamSet.findUnique({ where: { id: setId } });
  if (!set || set.deletedAt) return notFound("Exam question set not found");
  return ok(await toExamSetDto(set));
});

export const DELETE = withExamAction("edit", async ({ params, user, req }) => {
  const setId = String(params.id ?? "");
  await discardSet({ setId, userId: user.id });

  await audit({
    user,
    action: "DELETE",
    entity: "EXAM",
    entityId: setId,
    description: `Discarded draft exam question set`,
    descriptionAr: `تم حذف مسودة أسئلة الاختبار`,
    req,
  });

  return ok({ id: setId, discarded: true });
});
