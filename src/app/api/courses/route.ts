// /api/courses — list + create (UUID, CRS-000001 ref number, soft delete, audit)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { nextRefNumber } from "@/lib/api/ref-number";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["code", "title", "createdAt", "updatedAt", "status", "category", "durationHours"];

export const GET = withModuleAction("courses", "view", async ({ req }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { title: { contains: q.search } },
      { titleAr: { contains: q.search } },
      { code: { contains: q.search } },
      { category: { contains: q.search } },
      { refNumber: { contains: q.search } },
    ];
  }
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.category) where.category = q.filters.category;
  if (q.filters.language) where.language = q.filters.language;

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.course.findMany({
      where,
      include: {
        _count: { select: { requests: true, sessions: true, certificates: true, questions: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.course.count({ where }),
  ]);

  return list(
    rows.map((c) => ({
      ...c,
      requestsCount: c._count.requests,
      sessionsCount: c._count.sessions,
      certificatesCount: c._count.certificates,
      questionsCount: c._count.questions,
    })),
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("courses", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    code, title, titleAr, description, category, durationHours,
    language, validityMonths, passScore, maxTrainees,
    hasPreTest, hasFinalTest, hasEvaluation, status,
    aiExamEnabled, aiExamConfig,
  } = body;

  if (!code || !title) return fail("Course code and title are required", 422, "VALIDATION_ERROR");

  const dup = await db.course.findFirst({ where: { code, deletedAt: null } });
  if (dup) return fail("Course code already exists", 400);

  const refNumber = await nextRefNumber("COURSE");

  const course = await db.course.create({
    data: {
      refNumber,
      code,
      title,
      titleAr: titleAr ?? null,
      description: description ?? null,
      category: category ?? null,
      durationHours: durationHours ?? 8,
      language: language ?? "en",
      validityMonths: validityMonths ?? 12,
      passScore: passScore ?? 70,
      maxTrainees: maxTrainees ?? 20,
      hasPreTest: hasPreTest ?? true,
      hasFinalTest: hasFinalTest ?? true,
      hasEvaluation: hasEvaluation ?? true,
      status: status ?? "ACTIVE",
      aiExamEnabled: aiExamEnabled ?? false,
      aiExamConfig: aiExamConfig ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "COURSE",
    entityId: course.id,
    entityRef: course.refNumber,
    description: `Created course: ${course.title} (${course.code})`,
    descriptionAr: `تم إنشاء دورة: ${course.title} (${course.code})`,
    req,
  });

  return created(course);
});
