// /api/sessions/[id]/exam-sets — list + generate the session's exam question sets
import { db } from "@/lib/db";
import { withExamAction, audit, testTypeWhere, type TestType } from "@/lib/auth/api";
import { ok, created, fail, notFound } from "@/lib/api/response";
import {
  createDraftSet,
  toExamSetDto,
  countBankQuestions,
} from "@/lib/api/exam-sets";

const parseTestType = (v: unknown): TestType => (v === "FINAL_TEST" ? "FINAL_TEST" : "PRE_TEST");

export const GET = withExamAction("view", async ({ req, params, allowedTestTypes }) => {
  const sessionId = String(params.id ?? "");
  const session = await db.trainingSession.findUnique({ where: { id: sessionId } });
  if (!session || session.deletedAt) return notFound("Session not found");

  const requested = new URL(req.url).searchParams.get("testType") ?? undefined;
  const testTypeFilter = requested ? testTypeWhere(requested, allowedTestTypes) : { in: allowedTestTypes };
  if (testTypeFilter === null) return fail(`Forbidden — no access to ${requested} questions`, 403);

  const sets = await db.sessionExamSet.findMany({
    where: { sessionId, deletedAt: null, testType: testTypeFilter },
    orderBy: [{ createdAt: "desc" }],
  });

  const dto = await Promise.all(sets.map((s) => toExamSetDto(s)));
  const bank = {
    PRE_TEST: await countBankQuestions(session.courseId, "PRE_TEST"),
    FINAL_TEST: await countBankQuestions(session.courseId, "FINAL_TEST"),
  };

  return ok({ sets: dto, bank });
});

export const POST = withExamAction("edit", async ({ req, params, user, allowedTestTypes }) => {
  const sessionId = String(params.id ?? "");
  const session = await db.trainingSession.findUnique({ where: { id: sessionId } });
  if (!session || session.deletedAt) return notFound("Session not found");

  const body = await req.json().catch(() => ({}));
  const testType = parseTestType(body.testType);
  if (!allowedTestTypes.includes(testType)) return fail(`Forbidden — cannot generate ${testType} questions`, 403);

  const numQuestions = typeof body.numQuestions === "number" ? body.numQuestions : undefined;
  const set = await createDraftSet({
    sessionId: session.id,
    courseId: session.courseId,
    testType,
    numQuestions,
    userId: user.id,
  });
  if (!set) {
    return fail("No active questions in the Question Bank for this course and test type", 422, "NO_BANK_QUESTIONS");
  }

  await audit({
    user,
    action: "UPDATE",
    entity: "EXAM",
    entityId: set.id,
    description: `Generated draft exam question set v${set.version} (${set.numQuestions} ${testType} questions) for session ${session.refNumber}`,
    descriptionAr: `تم توليد مسودة أسئلة اختبار v${set.version} (${set.numQuestions} سؤال ${testType === "PRE_TEST" ? "قبلي" : "نهائي"}) للجلسة ${session.refNumber}`,
    req,
  });

  return created(await toExamSetDto(set));
});
