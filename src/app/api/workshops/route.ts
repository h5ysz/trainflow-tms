// /api/workshops — list + create (WSH-000001 ref number, soft delete, audit)
import { db } from "@/lib/db";
import { withModuleAction, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { nextRefNumber } from "@/lib/api/ref-number";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["code", "title", "createdAt", "updatedAt", "status", "category", "durationDays"];

export const GET = withModuleAction("workshops", "view", async ({ req }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { title: { contains: q.search } },
      { code: { contains: q.search } },
      { category: { contains: q.search } },
      { refNumber: { contains: q.search } },
    ];
  }
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.category) where.category = q.filters.category;

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.workshop.findMany({
      where,
      include: {
        _count: { select: { authorizations: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.workshop.count({ where }),
  ]);

  return list(
    rows.map((w) => ({ ...w, authorizedTrainersCount: w._count.authorizations })),
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("workshops", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    code, title, description, category, durationDays, durationText, durationHours, status, isActive,
  } = body;

  if (!code || !title) return fail("Workshop code and title are required", 422, "VALIDATION_ERROR");

  const dup = await db.workshop.findFirst({ where: { code, deletedAt: null } });
  if (dup) return fail("Workshop code already exists", 400);

  const refNumber = await nextRefNumber("WORKSHOP");

  const workshop = await db.workshop.create({
    data: {
      refNumber,
      code,
      title,
      description: description ?? null,
      category: category ?? null,
      durationDays: durationDays ?? 1,
      durationText: durationText ?? null,
      durationHours: durationHours ?? 8,
      status: status ?? "ACTIVE",
      isActive: isActive ?? true,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "WORKSHOP",
    entityId: workshop.id,
    entityRef: workshop.refNumber,
    description: `Created workshop: ${workshop.title} (${workshop.code})`,
    descriptionAr: `تم إنشاء ورشة: ${workshop.title} (${workshop.code})`,
    req,
  });

  return created(workshop);
});
