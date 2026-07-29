// /api/audit-log/export — Export audit logs as CSV
// Sprint 6: Enterprise Audit Trail — Export (Excel/PDF/CSV)
// SUPER_ADMIN only. Audit logged as EXPORT action.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, audit } from "@/lib/auth/api";

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const GET = withErrorEnvelope(async function GET(req: NextRequest) {
  const user = await requireRole("SUPER_ADMIN");

  const url = new URL(req.url);
  const action = url.searchParams.get("action");
  const entity = url.searchParams.get("entity");
  const userId = url.searchParams.get("userId");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  const where: Record<string, unknown> = {};
  if (action) where.action = action;
  if (entity) where.entity = entity;
  if (userId) where.userId = userId;
  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
    if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(dateTo);
  }

  const rows = await db.auditLog.findMany({
    where,
    include: { user: { select: { fullName: true, email: true, role: true } } },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });

  const headers = [
    "Date", "Time", "User", "Email", "Role", "Action", "Entity",
    "Entity ID", "Entity Ref", "Description", "IP Address", "Browser",
    "Device", "Reason",
  ];

  const lines = [headers.join(",")];
  for (const r of rows) {
    const dt = new Date(r.createdAt);
    lines.push([
      csvEscape(dt.toLocaleDateString("en-GB")),
      csvEscape(dt.toLocaleTimeString("en-GB")),
      csvEscape(r.user?.fullName ?? "System"),
      csvEscape(r.user?.email ?? ""),
      csvEscape(r.userRole ?? r.user?.role ?? ""),
      csvEscape(r.action),
      csvEscape(r.entity),
      csvEscape(r.entityId),
      csvEscape(r.entityRef),
      csvEscape(r.description),
      csvEscape(r.ipAddress),
      csvEscape(r.browser),
      csvEscape(r.device),
      csvEscape(r.reason),
    ].join(","));
  }

  const csv = "\uFEFF" + lines.join("\r\n");
  const filename = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;

  await audit({
    user,
    action: "EXPORT",
    entity: "USER",
    description: `Exported ${rows.length} audit log entries to CSV`,
    descriptionAr: `تم تصدير ${rows.length} سجل تدقيق إلى CSV`,
    req,
    metadata: { count: rows.length, filters: { action, entity, userId, dateFrom, dateTo } },
  });

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
