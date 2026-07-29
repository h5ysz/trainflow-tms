// /api/report-executions — list execution history
import { db } from "@/lib/db";
import { withErrorEnvelope, requireModuleAction, fail } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { parseJsonColumn } from "@/lib/api/json-column";

const ALLOWED_SORT_FIELDS = ["createdAt", "startedAt", "completedAt", "status", "emailStatus"];

export const GET = withErrorEnvelope(async function GET(req: Request) {
  const user = await requireModuleAction("report-schedules", "view");

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
        // The explicit select is what keeps the `content` blob out of the list payload
        // — Prisma has no column-level lazy loading, so omitting it would pull every
        // stored report file into memory on every page render.
        files: { select: { id: true, format: true, filename: true, sizeBytes: true } },
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
      filterSummary: parseJsonColumn(e.filterSummary, null, "reportExecution.filterSummary"),
      exportedFiles: parseJsonColumn(e.exportedFiles, null, "reportExecution.exportedFiles"),
      emailRecipients: parseJsonColumn(e.emailRecipients, null, "reportExecution.emailRecipients"),
    })),
    buildListMeta(total, q)
  );
});
