// /api/user-approvals — list pending users + approve/reject/suspend/activate
import { db } from "@/lib/db";
import { requireModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["createdAt", "updatedAt", "fullName", "email", "accountStatus"];

export async function GET(req: Request) {
  let user;
  try {
    user = await requireModuleAction("user-approvals", "view");
  } catch {
    return fail("Forbidden", 403);
  }

  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  // Filter by accountStatus (default: show PENDING_APPROVAL)
  if (q.filters.accountStatus) {
    where.accountStatus = q.filters.accountStatus;
  } else {
    where.accountStatus = { in: ["PENDING_APPROVAL", "SUSPENDED", "REJECTED"] };
  }

  if (q.search) {
    where.OR = [
      { fullName: { contains: q.search } },
      { email: { contains: q.search } },
      { phone: { contains: q.search } },
    ];
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "createdAt");

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        role: true,
        accountStatus: true,
        registrationData: true,
        createdAt: true,
        updatedAt: true,
        company: { select: { id: true, name: true, refNumber: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.user.count({ where }),
  ]);

  return list(
    rows.map((u) => ({
      ...u,
      registrationData: u.registrationData ? JSON.parse(u.registrationData) : null,
    })),
    buildListMeta(total, q)
  );
}
