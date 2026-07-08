// /api/login-history — list login attempts
import { db } from "@/lib/db";
import { requireRole, fail } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy } from "@/lib/api/query";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["attemptedAt", "email", "success"];

export async function GET(req: Request) {
  let user;
  try {
    user = await requireRole("SUPER_ADMIN", "COORDINATOR");
  } catch {
    return fail("Forbidden", 403);
  }

  const q = parseListQuery(req);
  const where: Record<string, unknown> = {};

  if (q.filters.userId) where.userId = q.filters.userId;
  if (q.filters.email) where.email = { contains: q.filters.email };
  if (q.filters.success) where.success = q.filters.success === "true";

  if (q.search) {
    where.OR = [{ email: { contains: q.search } }];
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "attemptedAt");

  const [rows, total] = await Promise.all([
    db.loginHistory.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.loginHistory.count({ where }),
  ]);

  return list(rows, buildListMeta(total, q));
}
