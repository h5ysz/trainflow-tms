// /api/users/[id]/reset-password — admin resets user password
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, notFound, fail, audit } from "@/lib/auth/api";
import { hashPassword } from "@/lib/auth/jwt";

export const POST = withErrorEnvelope(async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let admin;
  try {
    admin = await requireRole("SUPER_ADMIN", "COORDINATOR");
  } catch {
    return fail("Forbidden", 403);
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const { newPassword, forceChange } = body as { newPassword?: string; forceChange?: boolean };

  if (!newPassword || newPassword.length < 8) {
    return fail("Password must be at least 8 characters", 422, "WEAK_PASSWORD");
  }

  const target = await db.user.findUnique({ where: { id } });
  if (!target || target.deletedAt) return notFound("User not found");

  const ROLE_RANK: Record<string, number> = { SUPER_ADMIN: 4, ADMIN: 3, COORDINATOR: 2, TRAINER: 1, TRAINEE: 0, CONTRACTOR: 0 };
  if (ROLE_RANK[target.role] > ROLE_RANK[admin.role]) {
    return fail("Cannot reset a higher-privileged user", 403, "FORBIDDEN");
  }

  const passwordHash = await hashPassword(newPassword);

  await db.user.update({
    where: { id },
    data: {
      passwordHash,
      forcePasswordChange: forceChange ?? true,
      failedLoginAttempts: 0,
      lockedUntil: null,
      // Invalidate any sessions issued before the password was reset.
      tokenVersion: { increment: 1 },
      updatedBy: admin.id,
    },
  });

  await audit({
    user: admin,
    action: "UPDATE",
    entity: "USER",
    entityId: id,
    description: `Reset password for ${target.email}${forceChange ? " (force change on next login)" : ""}`,
    req,
  });

  return ok({ success: true });
});
