// /api/report-schedules — list + create report schedules
import { db } from "@/lib/db";
import { withErrorEnvelope, requireModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { buildCronExpression, getNextRunTime, getScheduleSettings } from "@/lib/reports/scheduler";
import { parseJsonColumn } from "@/lib/api/json-column";

const ALLOWED_SORT_FIELDS = ["name", "createdAt", "updatedAt", "nextRunAt", "lastRunAt", "scheduleType"];

export const GET = withErrorEnvelope(async function GET(req: Request) {
  const user = await requireModuleAction("report-schedules", "view");

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
    filters: parseJsonColumn(s.filters, null, "reportSchedule.filters"),
    exportFormats: parseJsonColumn(s.exportFormats, [] as string[], "reportSchedule.exportFormats"),
    recipients: parseJsonColumn(s.recipients, [] as string[], "reportSchedule.recipients"),
    ccRecipients: parseJsonColumn(s.ccRecipients, [] as string[], "reportSchedule.ccRecipients"),
    bccRecipients: parseJsonColumn(s.bccRecipients, [] as string[], "reportSchedule.bccRecipients"),
  })), buildListMeta(total, q));
});

export const POST = withErrorEnvelope(async function POST(req: Request) {
  const user = await requireModuleAction("report-schedules", "create");

  const body = await req.json().catch(() => ({}));
  const {
    name, nameAr, description, templateCode,
    scheduleType, executionTime, dayOfWeek, dayOfMonth, customCron,
    filters, exportFormats, recipients, ccRecipients, bccRecipients,
    emailSubject, emailBody, maxRetries, retryDelayMin,
  } = body;

  if (!name || !templateCode || !scheduleType) {
    return fail("name, templateCode, scheduleType are required", 422, "VALIDATION_ERROR");
  }

  // BUG FIX: recipients is optional — schedule can be preview-only (no email)
  // But if provided, validate email format
  if (recipients && Array.isArray(recipients)) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const invalidEmails = recipients.filter((e: string) => !emailRegex.test(e));
    if (invalidEmails.length > 0) {
      return fail(`Invalid email format: ${invalidEmails.join(", ")}`, 422, "INVALID_EMAIL");
    }
  }

  // Read timing defaults from Settings (configurable by Super Admin)
  const settings = await getScheduleSettings();

  // Use provided values or fall back to Settings
  const effectiveTime = executionTime ?? (scheduleType === "WEEKLY" ? settings.weekly.executionTime : scheduleType === "MONTHLY" ? settings.monthly.executionTime : "09:00");
  const effectiveDayOfWeek = dayOfWeek ?? (scheduleType === "WEEKLY" ? settings.weekly.dayOfWeek : undefined);
  const effectiveDayOfMonth = dayOfMonth ?? (scheduleType === "MONTHLY" ? settings.monthly.dayOfMonth : undefined);
  // Timezone comes from Settings (schedule.timezone); the body has no field for it.
  const effectiveTimezone = settings.timezone;

  // Build cron expression from effective values
  const cronExpression = buildCronExpression({
    scheduleType,
    executionTime: effectiveTime,
    dayOfWeek: effectiveDayOfWeek,
    dayOfMonth: effectiveDayOfMonth,
    customCron,
  });

  const nextRunAt = getNextRunTime(cronExpression, new Date(), effectiveTimezone);

  const schedule = await db.reportSchedule.create({
    data: {
      name,
      nameAr: nameAr ?? null,
      description: description ?? null,
      templateCode,
      scheduleType,
      cronExpression,
      executionTime: effectiveTime,
      timezone: effectiveTimezone,
      dayOfWeek: effectiveDayOfWeek ?? null,
      dayOfMonth: effectiveDayOfMonth ?? null,
      filters: filters ? JSON.stringify(filters) : null,
      exportFormats: exportFormats ? JSON.stringify(exportFormats) : '["xlsx"]',
      recipients: JSON.stringify(recipients ?? []),
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
});
