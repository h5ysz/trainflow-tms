// /api/roles/[id]/users — list users assigned to a role + bulk assign/unassign
// =====================================================================
// GET    — list users currently assigned to this role (Super Admin / Coordinator)
// POST   — bulk-assign or bulk-unassign a list of userIds to/from this role
//          (Super Admin only)
//
// POST body:
//   userIds — string[] (required, non-empty)
//   action  — "assign" | "unassign" (default: "assign")
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, notFound, fail, audit } from "@/lib/auth/api";

export const GET = withErrorEnvelope(async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireRole("SUPER_ADMIN", "COORDINATOR");
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
});

export const POST = withErrorEnvelope(async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SUPER_ADMIN");
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
    // Only unassign users currently on this role
    await db.user.updateMany({
      where: { id: { in: userIds }, roleId: id, deletedAt: null },
      data: { roleId: null, updatedBy: user.id },
    });
  }

  await audit({
    user,
    action: "UPDATE",
    entity: "ROLE",
    entityId: id,
    entityRef: role.code,
    description: `${act === "assign" ? "Assigned" : "Unassigned"} ${userIds.length} user(s) ${act === "assign" ? "to" : "from"} role ${role.code}`,
    descriptionAr: `${act === "assign" ? "تم تعيين" : "تم إلغاء تعيين"} ${userIds.length} مستخدم ${act === "assign" ? "إلى" : "من"} دور ${role.code}`,
    req,
    metadata: { roleId: id, roleCode: role.code, action: act, userIds },
  });

  return ok({ success: true, action: act, count: userIds.length });
});
