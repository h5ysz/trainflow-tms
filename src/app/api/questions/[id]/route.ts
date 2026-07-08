// /api/questions/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, audit } from "@/lib/auth/api";

function parseQuestion(q: any) {
  return {
    ...q,
    options: q.options ? JSON.parse(q.options) : [],
    correctAnswers: q.correctAnswers ? JSON.parse(q.correctAnswers) : [],
  };
}

export const GET = withModuleAction("pre-test", "view", async ({ params }) => {
  const id = params.id as string;
  const q = await db.question.findUnique({ where: { id }, include: { course: true } });
  if (!q || q.deletedAt) return notFound("Question not found");
  return ok(parseQuestion(q));
});

export const PUT = withModuleAction("pre-test", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.question.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Question not found");

  const { type, testType, text, textAr, options, correctAnswers, points, order, isActive, category, difficulty, tags } = body;

  const updated = await db.question.update({
    where: { id },
    data: {
      ...(type !== undefined && { type }),
      ...(testType !== undefined && { testType }),
      ...(text !== undefined && { text }),
      ...(textAr !== undefined && { textAr }),
      ...(options !== undefined && { options: JSON.stringify(options) }),
      ...(correctAnswers !== undefined && { correctAnswers: JSON.stringify(correctAnswers) }),
      ...(points !== undefined && { points }),
      ...(order !== undefined && { order }),
      ...(isActive !== undefined && { isActive }),
      ...(category !== undefined && { category }),
      ...(difficulty !== undefined && { difficulty }),
      ...(tags !== undefined && { tags: JSON.stringify(tags) }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "COURSE",
    entityId: existing.courseId ?? id,
    description: `Updated question ${id}`,
    descriptionAr: `تم تحديث سؤال ${id}`,
    req,
  });

  return ok(parseQuestion(updated));
});

export const DELETE = withModuleAction("pre-test", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.question.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Question not found");

  await db.question.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "COURSE",
    entityId: existing.courseId ?? id,
    description: `Deleted question ${id}`,
    descriptionAr: `تم حذف سؤال ${id}`,
    req,
  });

  return ok({ success: true });
});
