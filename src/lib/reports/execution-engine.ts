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
import { sendReportEmail, buildEmailSubject, buildEmailBody, getNextRetryTime, type EmailAttachment, type EmailDeliveryStatus } from "./email-service";
import { persistExecutionFiles, pruneScheduleFiles } from "./file-store";
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
  /** Null for scheduled runs, which have no acting user. */
  triggeredBy?: string | null;
}): Promise<{ executionId: string; status: string; emailStatus: EmailDeliveryStatus; rowCount: number; emailSent: boolean }> {
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

    // Persist the generated files. Until now the buffers were built, measured, and
    // then dropped on the floor: `exportedFiles` recorded only names and sizes, there
    // was no storage column and no download route, so a "successful" scheduled report
    // produced nothing anyone could actually obtain.
    const storedFiles = await persistExecutionFiles(execution.id, attachments);

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
    // The email status is recorded verbatim. Mapping it to the execution status keeps
    // "we generated and stored the report" distinct from "we delivered it": a simulated
    // send (SMTP unconfigured) is COMPLETED, never SENT.
    const emailStatus = emailResult.status;
    const executionStatus =
      emailStatus === "SENT" ? "SENT"
      : emailStatus === "FAILED" ? "FAILED"
      : "COMPLETED"; // SIMULATED | SKIPPED — the files exist and are downloadable

    await db.reportExecution.update({
      where: { id: execution.id },
      data: {
        status: executionStatus,
        emailStatus,
        emailSentAt: emailStatus === "SENT" ? emailResult.sentAt : null,
        emailError: emailResult.error ?? null,
        emailRecipients: JSON.stringify(recipients),
        completedAt,
        durationMs,
        // Only a genuine delivery failure is worth retrying. Retrying a simulation
        // forever accomplishes nothing.
        ...(emailStatus === "FAILED" ? { nextRetryAt: getNextRetryTime(schedule.retryDelayMin) } : {}),
      },
    });

    // Keep only the most recent files per schedule. This is the layer that actually
    // bounds database growth — "Run now" generates far faster than any TTL expires.
    if (storedFiles.length > 0) await pruneScheduleFiles(scheduleId);

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
      await updateNextRun(scheduleId, schedule.cronExpression, schedule.timezone);
    }

    // ── Audit ──
    await recordAudit({
      userId: triggeredBy ?? null,
      action: "CREATE",
      entity: "SETTING",
      entityId: execution.id,
      description: `Report execution: ${schedule.name} — ${data.length} rows, email ${emailStatus.toLowerCase()} (${triggerType})`,
      metadata: {
        scheduleId,
        templateCode: schedule.templateCode,
        rowCount: data.length,
        emailStatus,
        filesStored: storedFiles.length,
        triggerType,
        durationMs,
      },
    });

    return {
      executionId: execution.id,
      status: executionStatus,
      emailStatus,
      rowCount: data.length,
      emailSent: emailStatus === "SENT",
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
      await updateNextRun(scheduleId, schedule.cronExpression, schedule.timezone);
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

  // A retry re-runs the pipeline, and `executeReportSchedule` always creates its own
  // execution row. The old code ALSO wrote the outcome back onto this row, so every
  // retry appeared twice in the execution history — once as the original and once as
  // the new attempt, both claiming the same result.
  //
  // Instead the original is marked RETRYING for the duration and then SUPERSEDED,
  // pointing at the attempt that replaced it. The new row is the record of truth.
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
    const result = await executeReportSchedule({
      scheduleId: execution.scheduleId,
      triggerType: "SCHEDULED",
      triggeredBy: null,
    });

    await db.reportExecution.update({
      where: { id: executionId },
      data: {
        status: "SUPERSEDED",
        completedAt: new Date(),
        nextRetryAt: null,
        errorMessage: `Superseded by execution ${result.executionId} (${result.status})`,
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
  const retryCandidates = await db.reportExecution.findMany({
    where: {
      status: "FAILED",
      nextRetryAt: { lte: now },
    },
    take: 20,
  });
  // Respect each execution's own maxRetries rather than a hardcoded 3, which silently
  // stopped retrying schedules configured to allow more.
  const failedExecutions = retryCandidates
    .filter((e) => e.attemptNumber < e.maxRetries)
    .slice(0, 5);

  for (const exec of failedExecutions) {
    try {
      await retryExecution(exec.id);
    } catch (e) {
      console.error(`[Scheduler] Retry failed for execution ${exec.id}:`, e);
    }
  }

  // ── 3. Prune expired report files ──
  // Stored report blobs live in the database, so something has to remove them.
  try {
    const { pruneExpiredFiles } = await import("./file-store");
    await pruneExpiredFiles();
  } catch (e) {
    console.error("[Scheduler] Failed to prune expired report files:", e);
  }

  if (dueSchedules.length > 0 || failedExecutions.length > 0) {
    console.log(
      `[Scheduler] Tick complete: ${dueSchedules.length} schedule(s) executed, ${failedExecutions.length} retry(ies) attempted`
    );
  }
}
