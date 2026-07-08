// /api/questions — list + create (question bank, soft delete, audit)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["text", "createdAt", "updatedAt", "order", "difficulty", "category"];

export const GET = withModuleAction("pre-test", "view", async ({ req }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { text: { contains: q.search } },
      { textAr: { contains: q.search } },
      { category: { contains: q.search } },
    ];
  }
  if (q.filters.courseId) where.courseId = q.filters.courseId;
  if (q.filters.testType) where.testType = q.filters.testType;
  if (q.filters.category) where.category = q.filters.category;
  if (q.filters.difficulty) where.difficulty = q.filters.difficulty;
  if (q.filters.source) where.source = q.filters.source;
  if (q.filters.isActive) where.isActive = q.filters.isActive === "true";

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "order");

  const [rows, total] = await Promise.all([
    db.question.findMany({
      where,
      include: { course: { select: { id: true, title: true, code: true, refNumber: true } } },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.question.count({ where }),
  ]);

  return list(
    rows.map((question) => ({
      ...question,
      options: question.options ? JSON.parse(question.options) : [],
      correctAnswers: question.correctAnswers ? JSON.parse(question.correctAnswers) : [],
      courseCode: question.course?.code ?? null,
      courseTitle: question.course?.title ?? null,
      courseRef: question.course?.refNumber ?? null,
    })),
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("pre-test", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    courseId, type, testType, text, textAr, options, correctAnswers,
    points, order, isActive, category, difficulty, tags,
    source, aiModel, aiPrompt,
  } = body;

  if (!text) return fail("text is required", 422, "VALIDATION_ERROR");
  if (!Array.isArray(options) || options.length < 2) {
    return fail("At least 2 options required", 422, "VALIDATION_ERROR");
  }
  if (!Array.isArray(correctAnswers) || correctAnswers.length === 0) {
    return fail("At least 1 correct answer required", 422, "VALIDATION_ERROR");
  }

  if (courseId) {
    const course = await db.course.findFirst({ where: { id: courseId, deletedAt: null } });
    if (!course) return fail("Course not found", 404);
  }

  const question = await db.question.create({
    data: {
      courseId: courseId ?? null,
      type: type ?? "SINGLE_CHOICE",
      testType: testType ?? "PRE_TEST",
      text,
      textAr: textAr ?? null,
      options: JSON.stringify(options),
      correctAnswers: JSON.stringify(correctAnswers),
      points: points ?? 1,
      order: order ?? 1,
      isActive: isActive ?? true,
      category: category ?? null,
      difficulty: difficulty ?? "MEDIUM",
      tags: tags ? JSON.stringify(tags) : null,
      source: source ?? "MANUAL",
      aiModel: aiModel ?? null,
      aiPrompt: aiPrompt ?? null,
      aiGeneratedAt: source === "AI_GENERATED" ? new Date() : null,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "COURSE",
    entityId: courseId ?? null,
    description: `Created ${testType ?? "PRE_TEST"} question`,
    descriptionAr: `تم إنشاء سؤال ${testType ?? "قبلي"}`,
    req,
  });

  return created({
    ...question,
    options: JSON.parse(question.options),
    correctAnswers: JSON.parse(question.correctAnswers),
  });
});
