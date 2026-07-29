// Storage for generated report files.
//
// The execution engine used to build xlsx/pdf buffers, record their sizes, and let them
// be garbage collected. There was no storage column and no download endpoint, so the
// scheduled-reporting feature produced nothing a human could retrieve — while the UI
// claimed reports were "generated and stored".
//
// Files live in the database rather than on disk on purpose: the deployment target has
// no persistent volume, so a file written to the filesystem would vanish on the next
// redeploy while its database row survived — a worse failure than not storing it at all.
import { createHash } from "crypto";
import { db } from "@/lib/db";
import type { EmailAttachment } from "./email-service";

/** Skip persisting anything larger than this (bytes). Overridable via Settings. */
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
/** How long a stored file remains downloadable. */
const DEFAULT_RETENTION_DAYS = 30;
/** How many executions' worth of files to keep per schedule. */
const DEFAULT_MAX_FILES_PER_SCHEDULE = 10;

async function numericSetting(key: string, fallback: number): Promise<number> {
  const row = await db.setting.findUnique({ where: { key } });
  const parsed = row ? parseInt(row.value, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export interface StoredFile {
  id: string;
  format: string;
  filename: string;
  sizeBytes: number;
}

/**
 * Persist the generated files for an execution.
 *
 * Oversized files are skipped rather than stored — they are still emailed as
 * attachments; only the retrievable copy is dropped.
 */
export async function persistExecutionFiles(
  executionId: string,
  attachments: EmailAttachment[]
): Promise<StoredFile[]> {
  if (attachments.length === 0) return [];

  const maxBytes = await numericSetting("reports.maxFileBytes", DEFAULT_MAX_FILE_BYTES);
  const retentionDays = await numericSetting("reports.fileRetentionDays", DEFAULT_RETENTION_DAYS);
  const expiresAt = new Date(Date.now() + retentionDays * 24 * 60 * 60 * 1000);

  const stored: StoredFile[] = [];

  // A loop rather than createMany: there are one or two rows, and createMany's
  // behaviour with Bytes columns varies by connector.
  for (const attachment of attachments) {
    if (attachment.content.length > maxBytes) {
      console.warn(
        `[report-files] ${attachment.filename} is ${attachment.content.length} bytes, over the ${maxBytes} limit — not stored.`
      );
      continue;
    }

    const format = attachment.filename.split(".").pop()?.toLowerCase() ?? "bin";
    const row = await db.reportExecutionFile.create({
      data: {
        executionId,
        format,
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.content.length,
        content: new Uint8Array(attachment.content),
        checksum: createHash("sha256").update(attachment.content).digest("hex"),
        expiresAt,
      },
      select: { id: true, format: true, filename: true, sizeBytes: true },
    });
    stored.push(row);
  }

  return stored;
}

/**
 * Drop the oldest files for a schedule, keeping the N most recent executions' worth.
 *
 * This is the retention layer that actually bounds growth: the "Run now" button can
 * generate files far faster than any time-based expiry removes them.
 */
export async function pruneScheduleFiles(scheduleId: string): Promise<number> {
  const keep = await numericSetting("reports.maxFilesPerSchedule", DEFAULT_MAX_FILES_PER_SCHEDULE);

  const files = await db.reportExecutionFile.findMany({
    where: { execution: { scheduleId } },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });

  if (files.length <= keep) return 0;

  const doomed = files.slice(keep).map((f) => f.id);
  const { count } = await db.reportExecutionFile.deleteMany({ where: { id: { in: doomed } } });
  return count;
}

/** Remove files past their retention date. Called from the scheduler tick. */
export async function pruneExpiredFiles(): Promise<number> {
  const { count } = await db.reportExecutionFile.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  if (count > 0) console.log(`[report-files] Pruned ${count} expired file(s).`);
  return count;
}
