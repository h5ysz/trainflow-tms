// /api/roles/[id] — update / delete role
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, notFound, fail, audit } from "@/lib/auth/api";
import { ALL_MODULES, ACTIONS, type UserRole } from "@/lib/auth/permissions";

const ASSIGNABLE_BASE_TYPES: UserRole[] = ["COORDINATOR", "TRAINER", "CONTRACTOR", "VIEWER"];

function validatePermissions(perms: unknown): string[] | null {
  if (!Array.isArray(perms)) return null;
  const valid = new Set<string>(["*"]);
  for (const m of ALL_MODULES) {
    valid.add(`${m}.*`);
    for (const a of ACTIONS) valid.add(`${m}.${a}`);
  }
  return perms.every((p) => typeof p === "string" && valid.has(p)) ? (perms as string[]) : null;
}

export const PUT = withErrorEnvelope(async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SUPER_ADMIN");
  const { id } = await ctx.params;

  const existing = await db.role.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Role not found");

  const body = await req.json().catch(() => ({}));
  const { name, nameAr, description, permissions, baseType } = body;

  let validPermissions: string[] | undefined;
  if (permissions !== undefined) {
    const validated = validatePermissions(permissions);
    if (validated === null) return fail("Invalid permission string(s)", 422, "VALIDATION_ERROR");
    validPermissions = validated;
  }

  if (baseType !== undefined && !existing.isSystem && !ASSIGNABLE_BASE_TYPES.includes(baseType)) {
    return fail(`baseType must be one of: ${ASSIGNABLE_BASE_TYPES.join(", ")}`, 422, "VALIDATION_ERROR");
  }

  const updated = await db.role.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(nameAr !== undefined && { nameAr }),
      ...(description !== undefined && { description }),
      ...(validPermissions !== undefined && { permissions: validPermissions }),
      ...(baseType !== undefined && !existing.isSystem && { baseType }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "ROLE",
    entityId: id,
    description: `Updated role: ${updated.name}`,
    req,
    metadata: { permissions: validPermissions },
  });

  return ok(updated);
});

export const DELETE = withErrorEnvelope(async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SUPER_ADMIN");
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
    entity: "ROLE",
    entityId: id,
    description: `Deleted role: ${existing.name}`,
    req,
  });

  return ok({ success: true });
});
