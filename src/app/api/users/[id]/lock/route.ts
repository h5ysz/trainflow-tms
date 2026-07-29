// /api/users/[id]/lock — lock/unlock user account
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, notFound, fail, audit } from "@/lib/auth/api";

export const POST = withErrorEnvelope(async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let admin;
  try {
    admin = await requireRole("SUPER_ADMIN", "COORDINATOR");
  } catch {
    return fail("Forbidden", 403);
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const { lock } = body as { lock: boolean };

  const target = await db.user.findUnique({ where: { id } });
  if (!target || target.deletedAt) return notFound("User not found");

  if (lock) {
    await db.user.update({
      where: { id },
      data: {
        accountStatus: "SUSPENDED",
        isActive: false,
        // Kill outstanding sessions immediately on lock.
        tokenVersion: { increment: 1 },
        updatedBy: admin.id,
      },
    });
    await audit({
      user: admin,
      action: "UPDATE",
      entity: "USER",
      entityId: id,
      description: `Locked account: ${target.email}`,
      req,
    });
  } else {
    await db.user.update({
      where: { id },
      data: {
        accountStatus: "ACTIVE",
        isActive: true,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedBy: admin.id,
      },
    });
    await audit({
      user: admin,
      action: "UPDATE",
      entity: "USER",
      entityId: id,
      description: `Unlocked account: ${target.email}`,
      req,
    });
  }

  return ok({ success: true, locked: lock });
});
