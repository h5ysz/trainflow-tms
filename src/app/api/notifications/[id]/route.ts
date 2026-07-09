// /api/notifications/[id] — mark-read / delete (own notifications only)
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound } from "@/lib/auth/api";
import { parseBody } from "@/lib/api/validate";
import { notificationPatchSchema } from "@/lib/api/schemas";

export const PATCH = withModuleAction("notifications", "view", async ({ req, params, user }) => {
  const id = params.id as string;

  // Scope to the caller's own notifications — prevents touching others' records.
  // Scope to notifications the caller can see: their own, or broadcast (userId null).
  const existing = await db.notification.findFirst({
    where: { id, OR: [{ userId: user.id }, { userId: null }] },
  });
  if (!existing) return notFound("Notification not found");

  const parsed = await parseBody(req, notificationPatchSchema);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;

  const updated = await db.notification.update({
    where: { id },
    data: {
      ...(body.isRead !== undefined && { isRead: body.isRead, readAt: body.isRead ? new Date() : null }),
    },
  });

  return ok(updated);
});

export const DELETE = withModuleAction("notifications", "view", async ({ params, user }) => {
  const id = params.id as string;

  // Scope to notifications the caller can see: their own, or broadcast (userId null).
  const existing = await db.notification.findFirst({
    where: { id, OR: [{ userId: user.id }, { userId: null }] },
  });
  if (!existing) return notFound("Notification not found");

  await db.notification.delete({ where: { id } });
  return ok({ success: true });
});
