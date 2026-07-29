// /api/questions/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withExamAction, ok, notFound, fail, audit, type TestType } from "@/lib/auth/api";
import { parseJsonColumn } from "@/lib/api/json-column";

function parseQuestion(q: any) {
  return {
    ...q,
    options: parseJsonColumn(q.options, [] as string[], "question.options"),
    correctAnswers: parseJsonColumn(q.correctAnswers, [] as number[], "question.correctAnswers"),
  };
}

export const GET = withExamAction("view", async ({ params, allowedTestTypes }) => {
  const id = params.id as string;
  const q = await db.question.findUnique({ where: { id }, include: { course: true } });
  if (!q || q.deletedAt) return notFound("Question not found");
  if (!allowedTestTypes.includes(q.testType as TestType)) {
    return fail(`Forbidden — no access to ${q.testType} questions`, 403);
  }
  return ok(parseQuestion(q));
});

export const PUT = withExamAction("edit", async ({ req, params, user, allowedTestTypes }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.question.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Question not found");

  const { type, testType, text, textAr, options, correctAnswers, points, order, isActive, category, difficulty, tags } = body;

  // Both the current type and any requested new type must be within reach, so a
  // final-test-only role can't reach across and edit a pre-test question (or move
  // a question it does own into the module it doesn't).
  if (!allowedTestTypes.includes(existing.testType as TestType)) {
    return fail(`Forbidden — no access to ${existing.testType} questions`, 403);
  }
  if (testType !== undefined && !allowedTestTypes.includes(testType as TestType)) {
    return fail(`Forbidden — cannot move a question to ${testType}`, 403);
  }

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

export const DELETE = withExamAction("delete", async ({ params, user, req, allowedTestTypes }) => {
  const id = params.id as string;
  const existing = await db.question.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Question not found");
  if (!allowedTestTypes.includes(existing.testType as TestType)) {
    return fail(`Forbidden — no access to ${existing.testType} questions`, 403);
  }

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
