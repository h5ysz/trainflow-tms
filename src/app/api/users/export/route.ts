// /api/users/export — export users as CSV (Super Admin only)
// Sprint 6: User Management export requirement.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireRole, fail } from "@/lib/auth/api";

function csvEscape(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  let user;
  try {
    user = await requireRole("SUPER_ADMIN");
  } catch {
    return fail("Forbidden — Super Admin only", 403);
  }

  const url = new URL(req.url);
  const search = url.searchParams.get("search") || "";
  const roleFilter = url.searchParams.get("filters.role") || "";
  const isActiveFilter = url.searchParams.get("filters.isActive");

  const where: Record<string, unknown> = { deletedAt: null };
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
    take: 5000,
  });

  const headers = [
    "ID", "Email", "Full Name", "Role", "Active", "Account Status",
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
      csvEscape(u.isActive ? "Yes" : "No"),
      csvEscape(u.accountStatus),
      csvEscape(u.language),
      csvEscape(u.company?.name ?? ""),
      csvEscape(u.company?.refNumber ?? ""),
      csvEscape(u.trainer?.fullName ?? ""),
      csvEscape(u.trainer?.refNumber ?? ""),
      csvEscape(u.lastLoginAt ? u.lastLoginAt.toISOString() : ""),
      csvEscape(u.createdAt.toISOString()),
    ].join(","));
  }

  const csv = "\uFEFF" + lines.join("\r\n");
  const filename = `gcclab-users-${new Date().toISOString().slice(0, 10)}.csv`;

  await db.auditLog.create({
    data: {
      userId: user.id,
      action: "EXPORT",
      entity: "USER",
      description: `Exported ${rows.length} users to CSV`,
      descriptionAr: `تم تصدير ${rows.length} مستخدم إلى CSV`,
      ipAddress: req.headers.get("x-forwarded-for") || "unknown",
      userAgent: req.headers.get("user-agent") || "unknown",
      metadata: JSON.stringify({ count: rows.length, filters: { search, role: roleFilter, isActive: isActiveFilter } }),
    },
  });

  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
