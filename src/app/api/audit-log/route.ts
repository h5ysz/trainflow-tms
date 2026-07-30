// /api/audit-log — list audit logs (Super Admin / Coordinator only)
// Sprint 6: Enhanced with extended fields (browser, device, oldValue, newValue, reason)
// + additional filters (dateFrom, dateTo, ipAddress)
import { db } from "@/lib/db";
import { withErrorEnvelope, requireModuleAction, ok, fail } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { parseJsonColumn } from "@/lib/api/json-column";

const ALLOWED_SORT_FIELDS = ["createdAt", "action", "entity"];

export const GET = withErrorEnvelope(async function GET(req: Request) {
  const user = await requireModuleAction("audit-log", "view");

  const q = parseListQuery(req);
  const url = new URL(req.url);
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const ipAddress = url.searchParams.get("ipAddress");

  const where: Record<string, unknown> = {};

  if (q.filters.action) where.action = q.filters.action;
  if (q.filters.entity) where.entity = q.filters.entity;
  if (q.filters.userId) where.userId = q.filters.userId;
  if (ipAddress) where.ipAddress = { contains: ipAddress };
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
    if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(dateTo);
  }
  if (q.search) {
    where.OR = [
      { description: { contains: q.search } },
      { entityId: { contains: q.search } },
      { entityRef: { contains: q.search } },
      { user: { fullName: { contains: q.search } } },
      { user: { email: { contains: q.search } } },
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
      userRole: a.userRole ?? a.user?.role ?? null,
      action: a.action,
      entity: a.entity,
      entityId: a.entityId,
      entityRef: a.entityRef,
      description: a.description,
      descriptionAr: a.descriptionAr,
      ipAddress: a.ipAddress,
      userAgent: a.userAgent,
      browser: a.browser,
      device: a.device,
      oldValue: parseJsonColumn(a.oldValue, null, "auditLog.oldValue"),
      newValue: parseJsonColumn(a.newValue, null, "auditLog.newValue"),
      reason: a.reason,
      metadata: parseJsonColumn(a.metadata, null, "auditLog.metadata"),
      createdAt: a.createdAt,
    })),
    buildListMeta(total, q)
  );
});
