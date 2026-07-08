// /api/courses — list + create
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, auditLog } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";

export const GET = withModuleAction("courses", "view", async ({ req }) => {
  const params = parseListParams(req);
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { title: { contains: params.search } },
      { titleAr: { contains: params.search } },
      { code: { contains: params.search } },
      { category: { contains: params.search } },
    ];
  }
  if (params.status) where.status = params.status;

  const [rows, total] = await Promise.all([
    db.course.findMany({
      where,
      include: {
        _count: { select: { requests: true, sessions: true, certificates: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.course.count({ where }),
  ]);

  return ok(
    listResponse(
      rows.map((c) => ({
        ...c,
        requestsCount: c._count.requests,
        sessionsCount: c._count.sessions,
        certificatesCount: c._count.certificates,
      })),
      total,
      params
    )
  );
});

export const POST = withModuleAction("courses", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    code, title, titleAr, description, category, durationHours,
    language, validityMonths, passScore, maxTrainees,
    hasPreTest, hasFinalTest, hasEvaluation, status,
  } = body;

  if (!code || !title) return fail("Course code and title are required", 400);

  const dup = await db.course.findUnique({ where: { code } });
  if (dup) return fail("Course code already exists", 400);

  const course = await db.course.create({
    data: {
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
    },
  });

  await auditLog({
    userId: user.id,
    action: "CREATE",
    entity: "COURSE",
    entityId: course.id,
    description: `Created course: ${course.title} (${course.code})`,
    req,
  });

  return created(course);
});
