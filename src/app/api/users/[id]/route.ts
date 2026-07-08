// /api/users/[id] — get / update / soft-delete (Super Admin only)
import { db } from "@/lib/db";
import { requireRole, ok, notFound, fail, audit } from "@/lib/auth/api";
import { hashPassword } from "@/lib/auth/jwt";
import { recordStatusChange } from "@/lib/auth/audit";
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
  if (!target || target.deletedAt) return notFound("User not found");
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
  if (!existing || existing.deletedAt) return notFound("User not found");

  const body = await req.json().catch(() => ({}));
  const { email, fullName, role, language, isActive, companyId, trainerId, password, avatarUrl } = body;

  if (email && email !== existing.email) {
    const dup = await db.user.findFirst({ where: { email, deletedAt: null } });
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
      updatedBy: user.id,
    },
  });

  // Status change audit (active/inactive)
  if (isActive !== undefined && isActive !== existing.isActive) {
    await recordStatusChange({
      user,
      entity: "USER",
      entityId: id,
      fromStatus: existing.isActive ? "ACTIVE" : "INACTIVE",
      toStatus: isActive ? "ACTIVE" : "INACTIVE",
      req,
    });
  }

  await audit({
    user,
    action: "UPDATE",
    entity: "USER",
    entityId: id,
    description: `Updated user ${updated.email} (${updated.role})`,
    descriptionAr: `تم تحديث مستخدم ${updated.email} (${updated.role})`,
    req,
    metadata: { before: { ...existing, passwordHash: "[redacted]" }, after: { ...updated, passwordHash: "[redacted]" } },
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
  if (!existing || existing.deletedAt) return notFound("User not found");

  await db.user.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "USER",
    entityId: id,
    description: `Deleted user ${existing.email}`,
    descriptionAr: `تم حذف مستخدم ${existing.email}`,
    req,
  });

  return ok({ success: true });
}
