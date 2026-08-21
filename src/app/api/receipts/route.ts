// /api/receipts — list receipts
import { db } from "@/lib/db";
import { withModuleAction, companyScope } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["refNumber", "receiptDate", "amount", "createdAt"];

export const GET = withModuleAction("receipts", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);
  if (q.filters.companyId) where.companyId = q.filters.companyId;
  if (q.filters.invoiceId) where.invoiceId = q.filters.invoiceId;
  const scope = companyScope(user);
  if (scope) Object.assign(where, scope);
  if (q.search) {
    where.OR = [
      { refNumber: { contains: q.search } },
      { company: { name: { contains: q.search } } },
    ];
  }
  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);
  const [rows, total] = await Promise.all([
    db.receipt.findMany({
      where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: {
        company: { select: { id: true, name: true, refNumber: true } },
        invoice: { select: { id: true, refNumber: true } },
        payment: { select: { id: true, refNumber: true, method: true } },
      },
    }),
    db.receipt.count({ where }),
  ]);
  return list(rows, buildListMeta(total, q));
});
