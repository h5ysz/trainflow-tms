// GCCLAB TMS — Report Execution Engine
// =====================================================================
// Orchestrates the full report execution pipeline:
//   1. Load schedule + template
//   2. Compute filters (e.g. "next week" for weekly, "last month" for monthly)
//   3. Run template query against the production DB
//   4. Export to Excel/PDF
//   5. Send email with attachments
//   6. Log execution with full status tracking
//   7. Update schedule's lastRunAt + nextRunAt
//   8. Handle retries on failure

import { db } from "@/lib/db";
import { getTemplate, type ReportFilter } from "./template-registry";
import { exportReport } from "./export-service";
import { sendReportEmail, buildEmailSubject, buildEmailBody, getNextRetryTime, type EmailAttachment } from "./email-service";
import { updateNextRun } from "./scheduler";
import { recordAudit } from "@/lib/auth/audit";

/**
 * Compute dynamic filters based on schedule type.
 * - WEEKLY: filter for the NEXT week (sessions scheduled next week)
 * - MONTHLY: filter for the PREVIOUS month (completed sessions last month)
 */
function computeDynamicFilters(
  scheduleType: string,
  staticFilters: Record<string, unknown>
): ReportFilter {
  const now = new Date();
  const filter: ReportFilter = { ...staticFilters } as ReportFilter;

  if (scheduleType === "WEEKLY") {
    // Next week: Monday to Sunday
    const today = new Date(now);
    const dayOfWeek = today.getDay(); // 0=Sun
    const daysUntilMonday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + daysUntilMonday);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);

    filter.dateFrom = monday.toISOString().slice(0, 10);
    filter.dateTo = sunday.toISOString().slice(0, 10);
  } else if (scheduleType === "MONTHLY") {
    // Previous month
    const firstOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const firstOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastOfLastMonth = new Date(firstOfThisMonth.getTime() - 1);

    filter.dateFrom = firstOfLastMonth.toISOString().slice(0, 10);
    filter.dateTo = lastOfLastMonth.toISOString().slice(0, 10);
  }

  return filter;
}

/**
 * Execute a report schedule — the main entry point.
 * Called by the scheduler tick (for scheduled runs) or by the API (for manual runs).
 */
export async function executeReportSchedule(opts: {
  scheduleId: string;
  triggerType: "SCHEDULED" | "MANUAL";
  triggeredBy?: string;
}): Promise<{ executionId: string; status: string; rowCount: number; emailSent: boolean }> {
  const { scheduleId, triggerType, triggeredBy } = opts;
  const startTime = Date.now();

  // Load schedule
  const schedule = await db.reportSchedule.findUnique({
    where: { id: scheduleId },
  });
  if (!schedule || schedule.deletedAt) {
    throw new Error(`Schedule ${scheduleId} not found`);
  }
  if (!schedule.isActive) {
    throw new Error(`Schedule ${scheduleId} is not active`);
  }

  // Create execution record
  const execution = await db.reportExecution.create({
    data: {
      scheduleId,
      status: "RUNNING",
      triggerType,
      triggeredBy: triggeredBy ?? null,
      templateCode: schedule.templateCode,
      attemptNumber: 1,
      maxRetries: schedule.maxRetries,
      startedAt: new Date(),
    },
  });

  try {
    // ── Step 1: Load template ──
    const template = getTemplate(schedule.templateCode);
    if (!template) {
      throw new Error(`Template ${schedule.templateCode} not found`);
    }

    // ── Step 2: Compute filters ──
    const staticFilters: Record<string, unknown> = schedule.filters
      ? JSON.parse(schedule.filters)
      : {};
    const effectiveFilter = computeDynamicFilters(schedule.scheduleType, staticFilters);

    await db.reportExecution.update({
      where: { id: execution.id },
      data: {
        status: "GENERATING",
        filterSummary: JSON.stringify(effectiveFilter),
      },
    });

    // ── Step 3: Run query ──
    const data = await template.query(effectiveFilter);

    await db.reportExecution.update({
      where: { id: execution.id },
      data: {
        rowCount: data.length,
      },
    });

    // ── Step 4: Export to requested formats ──
    const formats: string[] = JSON.parse(schedule.exportFormats);
    const attachments: EmailAttachment[] = [];
    const exportedFiles: Array<{ format: string; filename: string; sizeBytes: number }> = [];

    // Build filter info for report header
    const filterInfo: Record<string, string> = {};
    if (effectiveFilter.dateFrom) filterInfo["From"] = effectiveFilter.dateFrom;
    if (effectiveFilter.dateTo) filterInfo["To"] = effectiveFilter.dateTo;
    if (effectiveFilter.companyId) filterInfo["Company"] = effectiveFilter.companyId;
    if (effectiveFilter.city) filterInfo["City"] = effectiveFilter.city;
    if (effectiveFilter.region) filterInfo["Region"] = effectiveFilter.region;

    for (const format of formats) {
      if (format !== "xlsx" && format !== "pdf") continue;
      const result = await exportReport(template, format as "xlsx" | "pdf", data, filterInfo);
      attachments.push({
        filename: result.filename,
        content: result.buffer,
        mimeType: result.mimeType,
      });
      exportedFiles.push({
        format,
        filename: result.filename,
        sizeBytes: result.buffer.length,
      });
    }

    await db.reportExecution.update({
      where: { id: execution.id },
      data: {
        status: "SENDING",
        exportedFiles: JSON.stringify(exportedFiles),
      },
    });

    // ── Step 5: Send email ──
    const recipients: string[] = JSON.parse(schedule.recipients);
    const ccRecipients: string[] = schedule.ccRecipients ? JSON.parse(schedule.ccRecipients) : [];
    const bccRecipients: string[] = schedule.bccRecipients ? JSON.parse(schedule.bccRecipients) : [];

    const emailSubject = schedule.emailSubject || buildEmailSubject(schedule.name);
    const emailBody = schedule.emailBody || buildEmailBody({
      scheduleName: schedule.name,
      templateName: template.name,
      rowCount: data.length,
      filters: filterInfo,
      attachments: attachments.map((a) => a.filename),
    });

    const emailResult = await sendReportEmail({
      to: recipients,
      cc: ccRecipients,
      bcc: bccRecipients,
      subject: emailSubject,
      body: emailBody,
      attachments,
    });

    const durationMs = Date.now() - startTime;
    const completedAt = new Date();

    // ── Step 6: Update execution record ──
    await db.reportExecution.update({
      where: { id: execution.id },
      data: {
        status: emailResult.success ? "SENT" : "FAILED",
        emailStatus: emailResult.success ? "SENT" : "FAILED",
        emailSentAt: emailResult.success ? emailResult.sentAt : null,
        emailError: emailResult.error ?? null,
        emailRecipients: JSON.stringify(recipients),
        completedAt,
        durationMs,
        ...(emailResult.success ? {} : {
          nextRetryAt: getNextRetryTime(schedule.retryDelayMin),
        }),
      },
    });

    // ── Step 7: Update schedule tracking ──
    await db.reportSchedule.update({
      where: { id: scheduleId },
      data: {
        lastRunAt: completedAt,
        lastExecutionId: execution.id,
      },
    });

    // ── Step 8: Compute next run (for scheduled runs) ──
    if (triggerType === "SCHEDULED") {
      await updateNextRun(scheduleId, schedule.cronExpression);
    }

    // ── Audit ──
    await recordAudit({
      userId: triggeredBy ?? null,
      action: "CREATE",
      entity: "SETTING",
      entityId: execution.id,
      description: `Report execution: ${schedule.name} — ${data.length} rows, email ${emailResult.success ? "sent" : "failed"} (${triggerType})`,
      metadata: {
        scheduleId,
        templateCode: schedule.templateCode,
        rowCount: data.length,
        emailSuccess: emailResult.success,
        triggerType,
        durationMs,
      },
    });

    return {
      executionId: execution.id,
      status: emailResult.success ? "SENT" : "FAILED",
      rowCount: data.length,
      emailSent: emailResult.success,
    };
  } catch (e: any) {
    // ── Handle failure ──
    const durationMs = Date.now() - startTime;
    const errorMessage = e.message ?? "Unknown error";
    const errorStack = e.stack ?? null;

    await db.reportExecution.update({
      where: { id: execution.id },
      data: {
        status: "FAILED",
        errorMessage,
        errorStack,
        completedAt: new Date(),
        durationMs,
        nextRetryAt: getNextRetryTime(schedule.retryDelayMin),
      },
    });

    // For scheduled runs, still update next run so it doesn't keep retrying every tick
    if (triggerType === "SCHEDULED") {
      await updateNextRun(scheduleId, schedule.cronExpression);
    }

    throw e;
  }
}

/**
 * Retry a failed execution.
 * Called by the scheduler when an execution's nextRetryAt has passed.
 */
export async function retryExecution(executionId: string): Promise<void> {
  const execution = await db.reportExecution.findUnique({
    where: { id: executionId },
    include: { schedule: true },
  });
  if (!execution) return;
  if (execution.status !== "FAILED" && execution.status !== "RETRYING") return;
  if (execution.attemptNumber >= execution.maxRetries) {
    // Max retries reached — mark as permanently failed
    await db.reportExecution.update({
      where: { id: executionId },
      data: { status: "FAILED", nextRetryAt: null },
    });
    return;
  }

  // BUG FIX: Don't create a new execution — update the existing one and re-run
  await db.reportExecution.update({
    where: { id: executionId },
    data: {
      status: "RETRYING",
      attemptNumber: { increment: 1 },
      nextRetryAt: null,
      errorMessage: null,
      errorStack: null,
    },
  });

  try {
    // Re-run the schedule pipeline (will create a NEW execution for the retry)
    const result = await executeReportSchedule({
      scheduleId: execution.scheduleId,
      triggerType: "SCHEDULED",
      triggeredBy: null,
    });

    // Link this retry to the original execution
    await db.reportExecution.update({
      where: { id: executionId },
      data: {
        status: result.status === "SENT" ? "SENT" : "FAILED",
        emailStatus: result.emailSent ? "SENT" : "FAILED",
        completedAt: new Date(),
        ...(result.emailSent ? {} : { nextRetryAt: getNextRetryTime(execution.schedule.retryDelayMin) }),
      },
    });
  } catch {
    // Will be caught by the next retry cycle
    await db.reportExecution.update({
      where: { id: executionId },
      data: {
        status: "FAILED",
        nextRetryAt: getNextRetryTime(execution.schedule.retryDelayMin),
      },
    });
  }
}

/**
 * Scheduler tick — called periodically to find and execute due schedules.
 * Also handles retries for failed executions.
 *
 * Before checking for due schedules, this function syncs all WEEKLY and
 * MONTHLY schedules with the current Settings values, so that Super Admin
 * configuration changes (time, day, timezone, enabled/disabled) take
 * effect immediately without code changes.
 */
export async function schedulerTick(): Promise<void> {
  // ── 0. Sync schedules from Settings (configurable timing) ──
  const { syncScheduleFromSettings } = await import("./scheduler");
  const allActiveSchedules = await db.reportSchedule.findMany({
    where: { deletedAt: null, scheduleType: { in: ["WEEKLY", "MONTHLY"] } },
    select: { id: true },
  });
  for (const s of allActiveSchedules) {
    try {
      await syncScheduleFromSettings(s.id);
    } catch (e) {
      console.error(`[Scheduler] Failed to sync schedule ${s.id} from settings:`, e);
    }
  }

  // ── 1. Execute due schedules ──
  const { getDueSchedules } = await import("./scheduler");
  const dueSchedules = await getDueSchedules();

  for (const schedule of dueSchedules) {
    try {
      await executeReportSchedule({
        scheduleId: schedule.id,
        triggerType: "SCHEDULED",
      });
    } catch (e) {
      console.error(`[Scheduler] Failed to execute schedule ${schedule.name}:`, e);
    }
  }

  // ── 2. Retry failed executions ──
  const now = new Date();
  const failedExecutions = await db.reportExecution.findMany({
    where: {
      status: "FAILED",
      nextRetryAt: { lte: now },
      attemptNumber: { lt: 3 },
    },
    take: 5,
  });

  for (const exec of failedExecutions) {
    try {
      await retryExecution(exec.id);
    } catch (e) {
      console.error(`[Scheduler] Retry failed for execution ${exec.id}:`, e);
    }
  }

  if (dueSchedules.length > 0 || failedExecutions.length > 0) {
    console.log(
      `[Scheduler] Tick complete: ${dueSchedules.length} schedule(s) executed, ${failedExecutions.length} retry(ies) attempted`
    );
  }
}
