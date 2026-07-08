// /api/test-results — list + submit (EXAM-YYYY-000001 ref number, EXAM_SUBMIT audit)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { nextRefNumber } from "@/lib/api/ref-number";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["refNumber", "traineeName", "attemptedAt", "scorePercent", "passed"];

export const GET = withModuleAction("pre-test", "view", async ({ req }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.filters.sessionId) where.sessionId = q.filters.sessionId;
  if (q.filters.testType) where.testType = q.filters.testType;
  if (q.filters.traineeEmail) where.traineeEmail = q.filters.traineeEmail;
  if (q.filters.passed) where.passed = q.filters.passed === "true";

  if (q.search) {
    where.OR = [
      { traineeName: { contains: q.search } },
      { traineeEmail: { contains: q.search } },
      { refNumber: { contains: q.search } },
    ];
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "attemptedAt");

  const [rows, total] = await Promise.all([
    db.testResult.findMany({
      where,
      include: {
        session: {
          select: {
            id: true, refNumber: true, title: true,
            course: { select: { id: true, title: true, code: true, refNumber: true } },
          },
        },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.testResult.count({ where }),
  ]);

  return list(
    rows.map((r) => ({
      id: r.id,
      refNumber: r.refNumber,
      sessionId: r.sessionId,
      sessionRef: r.session?.refNumber ?? null,
      sessionCode: r.session?.refNumber ?? null,
      courseTitle: r.session?.course?.title ?? null,
      testType: r.testType,
      traineeName: r.traineeName,
      traineeEmail: r.traineeEmail,
      scorePercent: r.scorePercent,
      passed: r.passed,
      attemptedAt: r.attemptedAt,
      durationSec: r.durationSec,
    })),
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("pre-test", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { sessionId, testType, traineeName, traineeEmail, traineeIdNational, scorePercent, answers, durationSec, questionSet } = body;

  if (!sessionId || !traineeName || scorePercent === undefined) {
    return fail("sessionId, traineeName, scorePercent are required", 422, "VALIDATION_ERROR");
  }

  const session = await db.trainingSession.findFirst({
    where: { id: sessionId, deletedAt: null },
    include: { course: true },
  });
  if (!session) return fail("Session not found", 404);

  const passScore = session.course?.passScore ?? 70;
  const passed = scorePercent >= passScore;

  const refNumber = await nextRefNumber("EXAM");

  const result = await db.testResult.create({
    data: {
      refNumber,
      sessionId,
      testType: testType ?? "PRE_TEST",
      traineeName,
      traineeEmail: traineeEmail ?? null,
      traineeIdNational: traineeIdNational ?? null,
      scorePercent,
      passed,
      answers: answers ? JSON.stringify(answers) : null,
      durationSec: durationSec ?? null,
      questionSet: questionSet ? JSON.stringify(questionSet) : null,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  // Audit: EXAM_SUBMIT
  await audit({
    user,
    action: "EXAM_SUBMIT",
    entity: "EXAM",
    entityId: result.id,
    entityRef: result.refNumber,
    description: `Submitted ${testType ?? "PRE_TEST"} exam ${result.refNumber} for ${traineeName}: ${scorePercent}% (${passed ? "Passed" : "Failed"})`,
    descriptionAr: `تسليم اختبار ${testType ?? "قبلي"} ${result.refNumber} لـ ${traineeName}: ${scorePercent}% (${passed ? "ناجح" : "راسب"})`,
    req,
    metadata: { sessionId, scorePercent, passed, passScore },
  });

  return created({
    ...result,
    answers: result.answers ? JSON.parse(result.answers) : null,
    questionSet: result.questionSet ? JSON.parse(result.questionSet) : null,
    passed,
    passScore,
  });
});
