// /api/report-executions — list execution history
import { db } from "@/lib/db";
import { requireModuleAction, fail } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy } from "@/lib/api/query";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["createdAt", "startedAt", "completedAt", "status", "emailStatus"];

export async function GET(req: Request) {
  let user;
  try { user = await requireModuleAction("report-schedules", "view"); } catch { return fail("Forbidden", 403); }

  const q = parseListQuery(req);
  const where: Record<string, unknown> = {};

  if (q.filters.scheduleId) where.scheduleId = q.filters.scheduleId;
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.emailStatus) where.emailStatus = q.filters.emailStatus;
  if (q.filters.triggerType) where.triggerType = q.filters.triggerType;

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "createdAt");

  const [rows, total] = await Promise.all([
    db.reportExecution.findMany({
      where,
      include: {
        schedule: { select: { id: true, name: true, templateCode: true, scheduleType: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.reportExecution.count({ where }),
  ]);

  return list(
    rows.map((e) => ({
      ...e,
      filterSummary: e.filterSummary ? JSON.parse(e.filterSummary) : null,
      exportedFiles: e.exportedFiles ? JSON.parse(e.exportedFiles) : null,
      emailRecipients: e.emailRecipients ? JSON.parse(e.emailRecipients) : null,
    })),
    buildListMeta(total, q)
  );
}
