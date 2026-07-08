// /api/report-schedules — list + create report schedules
import { db } from "@/lib/db";
import { requireRole, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { buildCronExpression, getNextRunTime } from "@/lib/reports/scheduler";

const ALLOWED_SORT_FIELDS = ["name", "createdAt", "updatedAt", "nextRunAt", "lastRunAt", "scheduleType"];

export async function GET(req: Request) {
  let user;
  try {
    user = await requireRole("SUPER_ADMIN", "COORDINATOR");
  } catch {
    return fail("Forbidden", 403);
  }

  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);
  if (q.filters.scheduleType) where.scheduleType = q.filters.scheduleType;
  if (q.filters.isActive) where.isActive = q.filters.isActive === "true";
  if (q.filters.templateCode) where.templateCode = q.filters.templateCode;

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "nextRunAt");

  const [rows, total] = await Promise.all([
    db.reportSchedule.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.reportSchedule.count({ where }),
  ]);

  return list(rows.map((s) => ({
    ...s,
    filters: s.filters ? JSON.parse(s.filters) : null,
    exportFormats: s.exportFormats ? JSON.parse(s.exportFormats) : [],
    recipients: s.recipients ? JSON.parse(s.recipients) : [],
    ccRecipients: s.ccRecipients ? JSON.parse(s.ccRecipients) : [],
    bccRecipients: s.bccRecipients ? JSON.parse(s.bccRecipients) : [],
  })), buildListMeta(total, q));
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireRole("SUPER_ADMIN", "COORDINATOR");
  } catch {
    return fail("Forbidden", 403);
  }

  const body = await req.json().catch(() => ({}));
  const {
    name, nameAr, description, templateCode,
    scheduleType, executionTime, dayOfWeek, dayOfMonth, customCron,
    filters, exportFormats, recipients, ccRecipients, bccRecipients,
    emailSubject, emailBody, maxRetries, retryDelayMin,
  } = body;

  if (!name || !templateCode || !scheduleType || !recipients) {
    return fail("name, templateCode, scheduleType, recipients are required", 422, "VALIDATION_ERROR");
  }

  // Build cron expression
  const cronExpression = buildCronExpression({
    scheduleType,
    executionTime,
    dayOfWeek,
    dayOfMonth,
    customCron,
  });

  const nextRunAt = getNextRunTime(cronExpression);

  const schedule = await db.reportSchedule.create({
    data: {
      name,
      nameAr: nameAr ?? null,
      description: description ?? null,
      templateCode,
      scheduleType,
      cronExpression,
      executionTime: executionTime ?? "09:00",
      dayOfWeek: dayOfWeek ?? null,
      dayOfMonth: dayOfMonth ?? null,
      filters: filters ? JSON.stringify(filters) : null,
      exportFormats: exportFormats ? JSON.stringify(exportFormats) : '["xlsx"]',
      recipients: JSON.stringify(recipients),
      ccRecipients: ccRecipients ? JSON.stringify(ccRecipients) : null,
      bccRecipients: bccRecipients ? JSON.stringify(bccRecipients) : null,
      emailSubject: emailSubject ?? null,
      emailBody: emailBody ?? null,
      maxRetries: maxRetries ?? 3,
      retryDelayMin: retryDelayMin ?? 10,
      nextRunAt,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "SETTING",
    entityId: schedule.id,
    description: `Created report schedule: ${name} (${scheduleType}, cron: ${cronExpression})`,
    req,
  });

  return created(schedule);
}
