// /api/questions — list + create
// Query params: courseId, testType (PRE_TEST | FINAL_TEST)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, auditLog } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";

export const GET = withModuleAction("pre-test", "view", async ({ req }) => {
  const params = parseListParams(req);
  const url = new URL(req.url);
  const courseId = url.searchParams.get("courseId");
  const testType = url.searchParams.get("testType");

  const where: Record<string, unknown> = {};
  if (courseId) where.courseId = courseId;
  if (testType) where.testType = testType;
  if (params.search) {
    where.OR = [
      { text: { contains: params.search } },
      { textAr: { contains: params.search } },
    ];
  }

  const [rows, total] = await Promise.all([
    db.question.findMany({
      where,
      include: { course: { select: { id: true, title: true, code: true } } },
      orderBy: [{ order: "asc" }, { createdAt: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.question.count({ where }),
  ]);

  return ok(
    listResponse(
      rows.map((q) => ({
        ...q,
        options: q.options ? JSON.parse(q.options) : [],
        correctAnswers: q.correctAnswers ? JSON.parse(q.correctAnswers) : [],
        courseCode: q.course?.code ?? null,
        courseTitle: q.course?.title ?? null,
      })),
      total,
      params
    )
  );
});

export const POST = withModuleAction("pre-test", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    courseId, type, testType, text, textAr, options, correctAnswers,
    points, order, isActive,
  } = body;

  if (!courseId || !text) return fail("courseId and text are required", 400);
  if (!Array.isArray(options) || options.length < 2) {
    return fail("At least 2 options required", 400);
  }
  if (!Array.isArray(correctAnswers) || correctAnswers.length === 0) {
    return fail("At least 1 correct answer required", 400);
  }

  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course) return fail("Course not found", 404);

  const question = await db.question.create({
    data: {
      courseId,
      type: type ?? "SINGLE_CHOICE",
      testType: testType ?? "PRE_TEST",
      text,
      textAr: textAr ?? null,
      options: JSON.stringify(options),
      correctAnswers: JSON.stringify(correctAnswers),
      points: points ?? 1,
      order: order ?? 1,
      isActive: isActive ?? true,
    },
  });

  await auditLog({
    userId: user.id,
    action: "CREATE",
    entity: "COURSE",
    entityId: courseId,
    description: `Created ${testType ?? "PRE_TEST"} question for ${course.title}`,
    req,
  });

  return created({
    ...question,
    options: JSON.parse(question.options),
    correctAnswers: JSON.parse(question.correctAnswers),
  });
});
