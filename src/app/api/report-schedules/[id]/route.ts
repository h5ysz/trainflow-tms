// /api/report-schedules/[id] — get / update / delete schedule
import { db } from "@/lib/db";
import { requireModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { buildCronExpression, getNextRunTime } from "@/lib/reports/scheduler";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireModuleAction("report-schedules", "view"); } catch { return fail("Forbidden", 403); }
  const { id } = await ctx.params;

  const schedule = await db.reportSchedule.findUnique({ where: { id } });
  if (!schedule || schedule.deletedAt) return notFound("Schedule not found");

  return ok({
    ...schedule,
    filters: schedule.filters ? JSON.parse(schedule.filters) : null,
    exportFormats: schedule.exportFormats ? JSON.parse(schedule.exportFormats) : [],
    recipients: schedule.recipients ? JSON.parse(schedule.recipients) : [],
    ccRecipients: schedule.ccRecipients ? JSON.parse(schedule.ccRecipients) : [],
    bccRecipients: schedule.bccRecipients ? JSON.parse(schedule.bccRecipients) : [],
  });
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireModuleAction("report-schedules", "edit"); } catch { return fail("Forbidden", 403); }
  const { id } = await ctx.params;

  const existing = await db.reportSchedule.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Schedule not found");

  const body = await req.json().catch(() => ({}));
  const {
    name, nameAr, description, templateCode,
    scheduleType, executionTime, dayOfWeek, dayOfMonth, customCron,
    filters, exportFormats, recipients, ccRecipients, bccRecipients,
    emailSubject, emailBody, isActive, maxRetries, retryDelayMin,
  } = body;

  // Recompute cron if schedule params changed
  let cronExpression = existing.cronExpression;
  let nextRunAt = existing.nextRunAt;
  if (scheduleType || executionTime || dayOfWeek || dayOfMonth || customCron) {
    cronExpression = buildCronExpression({
      scheduleType: scheduleType ?? existing.scheduleType,
      executionTime: executionTime ?? existing.executionTime ?? undefined,
      dayOfWeek: dayOfWeek ?? existing.dayOfWeek ?? undefined,
      dayOfMonth: dayOfMonth ?? existing.dayOfMonth ?? undefined,
      customCron: customCron ?? undefined,
    });
    nextRunAt = getNextRunTime(cronExpression);
  }

  const updated = await db.reportSchedule.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(nameAr !== undefined && { nameAr }),
      ...(description !== undefined && { description }),
      ...(templateCode !== undefined && { templateCode }),
      ...(scheduleType !== undefined && { scheduleType }),
      ...(executionTime !== undefined && { executionTime }),
      ...(dayOfWeek !== undefined && { dayOfWeek }),
      ...(dayOfMonth !== undefined && { dayOfMonth }),
      ...(cronExpression !== existing.cronExpression && { cronExpression, nextRunAt }),
      ...(filters !== undefined && { filters: filters ? JSON.stringify(filters) : null }),
      ...(exportFormats !== undefined && { exportFormats: JSON.stringify(exportFormats) }),
      ...(recipients !== undefined && { recipients: JSON.stringify(recipients) }),
      ...(ccRecipients !== undefined && { ccRecipients: ccRecipients ? JSON.stringify(ccRecipients) : null }),
      ...(bccRecipients !== undefined && { bccRecipients: bccRecipients ? JSON.stringify(bccRecipients) : null }),
      ...(emailSubject !== undefined && { emailSubject }),
      ...(emailBody !== undefined && { emailBody }),
      ...(isActive !== undefined && { isActive }),
      ...(maxRetries !== undefined && { maxRetries }),
      ...(retryDelayMin !== undefined && { retryDelayMin }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "SETTING",
    entityId: id,
    description: `Updated report schedule: ${updated.name}`,
    req,
  });

  return ok(updated);
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireModuleAction("report-schedules", "delete"); } catch { return fail("Forbidden", 403); }
  const { id } = await ctx.params;

  const existing = await db.reportSchedule.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Schedule not found");

  await db.reportSchedule.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "SETTING",
    entityId: id,
    description: `Deleted report schedule: ${existing.name}`,
    req,
  });

  return ok({ success: true });
}
