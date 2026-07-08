// /api/notifications — list + create + mark-read
import { db } from "@/lib/db";
import { getCurrentUser, ok, created, fail } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);

  const params = parseListParams(req);
  const url = new URL(req.url);
  const filter = url.searchParams.get("filter"); // "unread"
  const category = url.searchParams.get("category");

  const where: Record<string, unknown> = {
    OR: [{ userId: user.id }, { userId: null }],
  };
  if (filter === "unread") where.isRead = false;
  if (category) where.category = category;

  const [rows, total] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.notification.count({ where }),
  ]);

  const unreadCount = await db.notification.count({
    where: {
      OR: [{ userId: user.id }, { userId: null }],
      isRead: false,
    },
  });

  return ok({ ...listResponse(rows, total, params), unreadCount });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);

  const body = await req.json().catch(() => ({}));
  const { title, message, type, category, link, userId: targetUserId } = body;

  if (!title || !message) return fail("title and message are required", 400);

  const notif = await db.notification.create({
    data: {
      userId: targetUserId ?? user.id,
      title,
      message,
      type: type ?? "INFO",
      category: category ?? "SYSTEM",
      link: link ?? null,
    },
  });

  return created(notif);
}

// PATCH: mark all as read
export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);

  await db.notification.updateMany({
    where: {
      OR: [{ userId: user.id }, { userId: null }],
      isRead: false,
    },
    data: { isRead: true },
  });

  return ok({ success: true });
}
