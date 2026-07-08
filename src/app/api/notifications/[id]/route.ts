// /api/notifications/[id] — mark-read / delete
import { db } from "@/lib/db";
import { getCurrentUser, ok, notFound, fail } from "@/lib/auth/api";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);
  const { id } = await ctx.params;

  const existing = await db.notification.findUnique({ where: { id } });
  if (!existing) return notFound("Notification not found");

  const body = await req.json().catch(() => ({}));
  const updated = await db.notification.update({
    where: { id },
    data: { ...(body.isRead !== undefined && { isRead: body.isRead }) },
  });

  return ok(updated);
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);
  const { id } = await ctx.params;

  const existing = await db.notification.findUnique({ where: { id } });
  if (!existing) return notFound("Notification not found");

  await db.notification.delete({ where: { id } });
  return ok({ success: true });
}
