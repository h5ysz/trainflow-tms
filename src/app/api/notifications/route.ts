// /api/notifications — list + create + mark-read
import { db } from "@/lib/db";
import { getCurrentUser, ok, created, fail } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy } from "@/lib/api/query";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["createdAt", "isRead", "type", "category"];

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);

  const q = parseListQuery(req);
  const where: Record<string, unknown> = {
    OR: [{ userId: user.id }, { userId: null }],
  };
  if (q.filters.filter === "unread" || q.filters.unread === "true") where.isRead = false;
  if (q.filters.category) where.category = q.filters.category;
  if (q.filters.type) where.type = q.filters.type;

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "createdAt");

  const [rows, total] = await Promise.all([
    db.notification.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.notification.count({ where }),
  ]);

  const unreadCount = await db.notification.count({
    where: {
      OR: [{ userId: user.id }, { userId: null }],
      isRead: false,
    },
  });

  return list(rows, { ...buildListMeta(total, q), unreadCount } as any);
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);

  const body = await req.json().catch(() => ({}));
  const { title, titleAr, message, messageAr, type, category, link, userId: targetUserId } = body;

  if (!title || !message) return fail("title and message are required", 422, "VALIDATION_ERROR");

  const notif = await db.notification.create({
    data: {
      userId: targetUserId ?? user.id,
      title,
      titleAr: titleAr ?? null,
      message,
      messageAr: messageAr ?? null,
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
    data: { isRead: true, readAt: new Date() },
  });

  return ok({ success: true });
}
