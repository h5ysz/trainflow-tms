// /api/roles/[id]/users — list users assigned to a role + bulk-assign users to a role
import { db } from "@/lib/db";
import { requireRole, ok, notFound, fail, audit } from "@/lib/auth/api";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireRole("SUPER_ADMIN", "COORDINATOR"); } catch { return fail("Forbidden", 403); }
  void user;
  const { id } = await ctx.params;

  const role = await db.role.findUnique({ where: { id } });
  if (!role || role.deletedAt) return notFound("Role not found");

  const users = await db.user.findMany({
    where: { roleId: id, deletedAt: null },
    select: {
      id: true,
      email: true,
      fullName: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      createdAt: true,
    },
    orderBy: { fullName: "asc" },
  });

  return ok(users);
}

// Bulk-assign a list of userIds to this role (replaces their roleId)
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireRole("SUPER_ADMIN"); } catch { return fail("Forbidden", 403); }
  const { id } = await ctx.params;

  const role = await db.role.findUnique({ where: { id } });
  if (!role || role.deletedAt) return notFound("Role not found");

  const body = await req.json().catch(() => ({}));
  const { userIds, action } = body as { userIds?: string[]; action?: "assign" | "unassign" };

  if (!Array.isArray(userIds) || userIds.length === 0) {
    return fail("userIds (non-empty array) is required", 422, "VALIDATION_ERROR");
  }
  const act = action ?? "assign";

  if (act === "assign") {
    await db.user.updateMany({
      where: { id: { in: userIds }, deletedAt: null },
      data: { roleId: id, updatedBy: user.id },
    });
  } else {
    // Only unassign if currently on this role
    await db.user.updateMany({
      where: { id: { in: userIds }, roleId: id, deletedAt: null },
      data: { roleId: null, updatedBy: user.id },
    });
  }

  await audit({
    user,
    action: "UPDATE",
    entity: "USER",
    entityId: id,
    description: `${act === "assign" ? "Assigned" : "Unassigned"} ${userIds.length} user(s) ${act === "assign" ? "to" : "from"} role ${role.code}`,
    descriptionAr: `${act === "assign" ? "تم تعيين" : "تم إلغاء تعيين"} ${userIds.length} مستخدم ${act === "assign" ? "إلى" : "من"} دور ${role.code}`,
    req,
    metadata: { roleId: id, roleCode: role.code, action: act, userIds },
  });

  return ok({ success: true, action: act, count: userIds.length });
}
