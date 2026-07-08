// /api/test-results — list + submit
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, auditLog } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";

export const GET = withModuleAction("pre-test", "view", async ({ req }) => {
  const params = parseListParams(req);
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const testType = url.searchParams.get("testType");
  const traineeEmail = url.searchParams.get("traineeEmail");

  const where: Record<string, unknown> = {};
  if (sessionId) where.sessionId = sessionId;
  if (testType) where.testType = testType;
  if (traineeEmail) where.traineeEmail = traineeEmail;

  const [rows, total] = await Promise.all([
    db.testResult.findMany({
      where,
      include: {
        session: {
          select: { id: true, sessionCode: true, title: true, course: { select: { id: true, title: true, code: true } } },
        },
      },
      orderBy: { attemptedAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.testResult.count({ where }),
  ]);

  return ok(
    listResponse(
      rows.map((r) => ({
        id: r.id,
        sessionId: r.sessionId,
        sessionCode: r.session?.sessionCode ?? null,
        courseTitle: r.session?.course?.title ?? null,
        testType: r.testType,
        traineeName: r.traineeName,
        traineeEmail: r.traineeEmail,
        scorePercent: r.scorePercent,
        passed: r.passed,
        attemptedAt: r.attemptedAt,
        durationSec: r.durationSec,
      })),
      total,
      params
    )
  );
});

export const POST = withModuleAction("pre-test", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { sessionId, testType, traineeName, traineeEmail, scorePercent, answers, durationSec } = body;

  if (!sessionId || !traineeName || scorePercent === undefined) {
    return fail("sessionId, traineeName, scorePercent are required", 400);
  }

  const session = await db.trainingSession.findUnique({
    where: { id: sessionId },
    include: { course: true },
  });
  if (!session) return fail("Session not found", 404);

  const passScore = session.course?.passScore ?? 70;
  const passed = scorePercent >= passScore;

  const result = await db.testResult.create({
    data: {
      sessionId,
      testType: testType ?? "PRE_TEST",
      traineeName,
      traineeEmail: traineeEmail ?? null,
      scorePercent,
      passed,
      answers: answers ? JSON.stringify(answers) : null,
      durationSec: durationSec ?? null,
    },
  });

  await auditLog({
    userId: user.id,
    action: "CREATE",
    entity: "SESSION",
    entityId: sessionId,
    description: `Submitted ${testType ?? "PRE_TEST"} for ${traineeName}: ${scorePercent}% (${passed ? "Passed" : "Failed"})`,
    req,
  });

  return created({
    ...result,
    answers: result.answers ? JSON.parse(result.answers) : null,
    passed,
    passScore,
  });
});
