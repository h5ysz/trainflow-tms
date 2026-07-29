// /api/audit-log — list (Super Admin / Coordinator only)
import { db } from "@/lib/db";
import { withErrorEnvelope, requireModuleAction, ok, fail } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { parseJsonColumn } from "@/lib/api/json-column";

const ALLOWED_SORT_FIELDS = ["createdAt", "action", "entity"];

export const GET = withErrorEnvelope(async function GET(req: Request) {
  const user = await requireModuleAction("audit-log", "view");

  const q = parseListQuery(req);
  const where: Record<string, unknown> = {};

  if (q.filters.action) where.action = q.filters.action;
  if (q.filters.entity) where.entity = q.filters.entity;
  if (q.filters.userId) where.userId = q.filters.userId;
  if (q.search) {
    where.OR = [
      { description: { contains: q.search } },
      { entityId: { contains: q.search } },
      { entityRef: { contains: q.search } },
    ];
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "createdAt");

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.auditLog.count({ where }),
  ]);

  return list(
    rows.map((a) => ({
      id: a.id,
      userId: a.userId,
      userName: a.user?.fullName ?? null,
      userEmail: a.user?.email ?? null,
      userRole: a.user?.role ?? null,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      entityRef: a.entityRef,
      description: a.description,
      descriptionAr: a.descriptionAr,
      ipAddress: a.ipAddress,
      userAgent: a.userAgent,
      metadata: parseJsonColumn(a.metadata, null, "auditLog.metadata"),
      createdAt: a.createdAt,
    })),
    buildListMeta(total, q)
  );
});
