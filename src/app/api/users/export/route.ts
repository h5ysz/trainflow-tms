// /api/users/export — CSV export of all users (Super Admin only)
// =====================================================================
// Returns a CSV file (UTF-8 with BOM for Excel compatibility) containing
// every user in the system. Audit-logged as an EXPORT action.
//
// Query params (all optional):
//   search             — filter by fullName or email (contains)
//   filters.role       — exact role match (e.g. CONTRACTOR)
//   filters.isActive   — "true" | "false"
//
// Response: text/csv with Content-Disposition: attachment
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, audit } from "@/lib/auth/api";
import { whereWithSoftDelete } from "@/lib/api/query";

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export const GET = withErrorEnvelope(async function GET(req: Request) {
  const user = await requireRole("SUPER_ADMIN");

  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const roleFilter = url.searchParams.get("filters.role") || "";
  const isActiveFilter = url.searchParams.get("filters.isActive");

  const where: Record<string, unknown> = whereWithSoftDelete({}, false);
  if (search) {
    where.OR = [
      { fullName: { contains: search } },
      { email: { contains: search } },
    ];
  }
  if (roleFilter) where.role = roleFilter;
  if (isActiveFilter !== null && isActiveFilter !== undefined && isActiveFilter !== "") {
    where.isActive = isActiveFilter === "true";
  }

  const rows = await db.user.findMany({
    where,
    include: {
      company: { select: { name: true, refNumber: true } },
      trainer: { select: { fullName: true, refNumber: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 5000, // safety cap
  });

  const headers = [
    "ID", "Email", "Full Name", "Role", "Role ID", "Active", "Account Status",
    "Language", "Company", "Company Ref", "Trainer", "Trainer Ref",
    "Last Login At", "Created At",
  ];

  const lines = [headers.join(",")];
  for (const u of rows) {
    lines.push([
      csvEscape(u.id),
      csvEscape(u.email),
      csvEscape(u.fullName),
      csvEscape(u.role),
      csvEscape(u.roleId ?? ""),
      csvEscape(u.isActive ? "Yes" : "No"),
      csvEscape(u.accountStatus),
      csvEscape(u.language ?? ""),
      csvEscape(u.company?.name ?? ""),
      csvEscape(u.company?.refNumber ?? ""),
      csvEscape(u.trainer?.fullName ?? ""),
      csvEscape(u.trainer?.refNumber ?? ""),
      csvEscape(u.lastLoginAt ? u.lastLoginAt.toISOString() : ""),
      csvEscape(u.createdAt.toISOString()),
    ].join(","));
  }

  const csv = "\uFEFF" + lines.join("\r\n"); // BOM + CRLF for Excel
  const filename = `gcclab-users-${new Date().toISOString().slice(0, 10)}.csv`;

  await audit({
    user,
    action: "EXPORT",
    entity: "USER",
    description: `Exported ${rows.length} users to CSV`,
    descriptionAr: `تم تصدير ${rows.length} مستخدم إلى CSV`,
    req,
    metadata: { count: rows.length, filters: { search, role: roleFilter, isActive: isActiveFilter } },
  });

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
