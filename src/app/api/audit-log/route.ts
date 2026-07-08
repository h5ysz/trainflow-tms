// /api/audit-log — list (Super Admin / Coordinator only)
import { db } from "@/lib/db";
import { requireRole, ok, fail } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";

export async function GET(req: Request) {
  let user;
  try {
    user = await requireRole("SUPER_ADMIN", "COORDINATOR");
  } catch {
    return fail("Forbidden", 403);
  }

  const params = parseListParams(req);
  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const entity = url.searchParams.get("entity");
  const userId = url.searchParams.get("userId");

  const where: Record<string, unknown> = {};
  if (action) where.action = action;
  if (entity) where.entity = entity;
  if (userId) where.userId = userId;
  if (params.search) {
    where.OR = [
      { description: { contains: params.search } },
      { entityId: { contains: params.search } },
    ];
  }

  const [rows, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.auditLog.count({ where }),
  ]);

  return ok(
    listResponse(
      rows.map((a) => ({
        id: a.id,
        userId: a.userId,
        userName: a.user?.fullName ?? null,
        userEmail: a.user?.email ?? null,
        userRole: a.user?.role ?? null,
        action: a.action,
        entity: a.entity,
        entityId: a.entityId,
        description: a.description,
        ipAddress: a.ipAddress,
        userAgent: a.userAgent,
        metadata: a.metadata ? JSON.parse(a.metadata) : null,
        createdAt: a.createdAt,
      })),
      total,
      params
    )
  );
}
