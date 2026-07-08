// /api/roles/[id] — update / delete role
import { db } from "@/lib/db";
import { requireRole, ok, notFound, fail, audit } from "@/lib/auth/api";

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireRole("SUPER_ADMIN"); } catch { return fail("Forbidden", 403); }
  const { id } = await ctx.params;

  const existing = await db.role.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Role not found");

  const body = await req.json().catch(() => ({}));
  const { name, nameAr, description, permissions } = body;

  const updated = await db.role.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(nameAr !== undefined && { nameAr }),
      ...(description !== undefined && { description }),
      ...(permissions !== undefined && { permissions }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "USER",
    entityId: id,
    description: `Updated role: ${updated.name}`,
    req,
    metadata: { permissions },
  });

  return ok(updated);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireRole("SUPER_ADMIN"); } catch { return fail("Forbidden", 403); }
  const { id } = await ctx.params;

  const existing = await db.role.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Role not found");
  if (existing.isSystem) return fail("System roles cannot be deleted", 400);

  // Check if any users are assigned
  const userCount = await db.user.count({ where: { roleId: id, deletedAt: null } });
  if (userCount > 0) return fail(`Cannot delete role: ${userCount} user(s) are assigned`, 400);

  await db.role.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "USER",
    entityId: id,
    description: `Deleted role: ${existing.name}`,
    req,
  });

  return ok({ success: true });
}
