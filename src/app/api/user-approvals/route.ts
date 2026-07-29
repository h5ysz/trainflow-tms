// /api/user-approvals — list pending users + approve/reject/suspend/activate
import { db } from "@/lib/db";
import { withErrorEnvelope, requireModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { parseJsonColumn } from "@/lib/api/json-column";

const ALLOWED_SORT_FIELDS = ["createdAt", "updatedAt", "fullName", "email", "accountStatus"];

export const GET = withErrorEnvelope(async function GET(req: Request) {
  const user = await requireModuleAction("user-approvals", "view");

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
        // Needed so the approval dialog can preselect an already-assigned role.
        roleId: true,
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
      registrationData: parseJsonColumn(u.registrationData, null, "user.registrationData"),
    })),
    buildListMeta(total, q)
  );
});
