// /api/users/[id] — get / update / delete (Super Admin only)
import { db } from "@/lib/db";
import { requireRole, ok, notFound, fail, auditLog } from "@/lib/auth/api";
import { hashPassword } from "@/lib/auth/jwt";
import type { UserRole } from "@/lib/auth/permissions";

const VALID_ROLES: UserRole[] = ["SUPER_ADMIN", "COORDINATOR", "TRAINER", "CONTRACTOR"];

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireRole("SUPER_ADMIN");
  } catch {
    return fail("Forbidden — Super Admin only", 403);
  }
  const { id } = await ctx.params;
  const target = await db.user.findUnique({
    where: { id },
    include: { company: true, trainer: true },
  });
  if (!target) return notFound("User not found");
  return ok({
    id: target.id,
    email: target.email,
    fullName: target.fullName,
    role: target.role,
    isActive: target.isActive,
    language: target.language,
    avatarUrl: target.avatarUrl,
    companyId: target.companyId,
    companyName: target.company?.name ?? null,
    trainerId: target.trainerId,
    trainerName: target.trainer?.fullName ?? null,
    lastLoginAt: target.lastLoginAt,
    createdAt: target.createdAt,
  });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireRole("SUPER_ADMIN");
  } catch {
    return fail("Forbidden — Super Admin only", 403);
  }
  const { id } = await ctx.params;
  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return notFound("User not found");

  const body = await req.json().catch(() => ({}));
  const { email, fullName, role, language, isActive, companyId, trainerId, password, avatarUrl } = body;

  if (email && email !== existing.email) {
    const dup = await db.user.findUnique({ where: { email } });
    if (dup) return fail("Email already exists", 400);
  }
  if (role && !VALID_ROLES.includes(role)) return fail(`Invalid role: ${role}`, 400);

  const updated = await db.user.update({
    where: { id },
    data: {
      ...(email !== undefined && { email }),
      ...(fullName !== undefined && { fullName }),
      ...(role !== undefined && { role }),
      ...(language !== undefined && { language }),
      ...(isActive !== undefined && { isActive }),
      ...(companyId !== undefined && { companyId }),
      ...(trainerId !== undefined && { trainerId }),
      ...(avatarUrl !== undefined && { avatarUrl }),
      ...(password && { passwordHash: await hashPassword(password) }),
    },
  });

  await auditLog({
    userId: user.id,
    action: "UPDATE",
    entity: "USER",
    entityId: id,
    description: `Updated user ${updated.email} (${updated.role})`,
    req,
  });

  return ok({
    id: updated.id,
    email: updated.email,
    fullName: updated.fullName,
    role: updated.role,
    isActive: updated.isActive,
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireRole("SUPER_ADMIN");
  } catch {
    return fail("Forbidden — Super Admin only", 403);
  }
  const { id } = await ctx.params;
  if (id === user.id) return fail("Cannot delete your own account", 400);

  const existing = await db.user.findUnique({ where: { id } });
  if (!existing) return notFound("User not found");

  await db.user.delete({ where: { id } });
  await auditLog({
    userId: user.id,
    action: "DELETE",
    entity: "USER",
    entityId: id,
    description: `Deleted user ${existing.email}`,
    req,
  });

  return ok({ success: true });
}
