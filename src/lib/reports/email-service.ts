// GCCLAB TMS — Email Delivery Service
// =====================================================================
// Sends emails with file attachments (Excel/PDF report files) via SMTP.
// SMTP configuration lives in the Settings table (category EMAIL); the password is
// encrypted at rest, or supplied through the SMTP_PASSWORD environment variable.
//
// The most important property of this module is that it NEVER reports success for an
// email it did not send. It previously returned `{ success: true }` both when SMTP was
// unconfigured *and* when it was configured (the nodemailer call was commented out), so
// the execution engine wrote `status: "SENT"` and the UI told compliance officers that
// weekly reports had reached their clients. Nothing had ever been sent.

import nodemailer, { type Transporter } from "nodemailer";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/settings/crypto";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  mimeType: string;
}

/**
 * SENT      — the SMTP server accepted the message.
 * FAILED    — a send was attempted and rejected.
 * SIMULATED — SMTP is not configured; the message was logged, not sent.
 * SKIPPED   — there was nothing to send (no recipients).
 */
export type EmailDeliveryStatus = "SENT" | "FAILED" | "SIMULATED" | "SKIPPED";

export interface EmailResult {
  status: EmailDeliveryStatus;
  /** True only for SENT. Never true for a simulated send. */
  success: boolean;
  messageId?: string;
  error?: string;
  sentAt: Date;
}

export interface SmtpSettings {
  host: string;
  port: number;
  user: string;
  password: string;
  from: string;
  replyTo: string;
  secure: boolean;
  rejectUnauthorized: boolean;
  maxAttachmentBytes: number;
  enabled: boolean;
}

const DEFAULT_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

/**
 * Read SMTP settings from the database, layered under the environment.
 *
 * SMTP_PASSWORD takes precedence over the stored value, so the secret never has to
 * touch a database file that is committed to git.
 */
export async function getSmtpSettings(): Promise<SmtpSettings> {
  const settings = await db.setting.findMany({ where: { category: "EMAIL" } });
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;

  const host = map["email.smtpHost"]?.trim() || "";
  const port = parseInt(map["email.smtpPort"] || "587", 10);
  const user = map["email.smtpUser"]?.trim() || "";
  const from = map["email.smtpFrom"]?.trim() || "";

  const envPassword = process.env.SMTP_PASSWORD?.trim();
  const storedPassword = map["email.smtpPassword"];
  // A decryption failure throws rather than silently degrading to "unconfigured" —
  // that would put us straight back to reporting success for mail nobody sent.
  const password = envPassword || (storedPassword ? decryptSecret(storedPassword) : "");

  // Implicit TLS on 465; STARTTLS on everything else.
  const secure = map["email.smtpSecure"] === "true" || port === 465;

  return {
    host,
    port,
    user,
    password,
    from,
    replyTo: map["email.replyTo"]?.trim() || "",
    secure,
    // Only ever disabled by an explicit opt-out.
    rejectUnauthorized: map["email.smtpRejectUnauthorized"] !== "false",
    maxAttachmentBytes: parseInt(
      map["email.maxAttachmentBytes"] || String(DEFAULT_MAX_ATTACHMENT_BYTES),
      10
    ),
    // A host and a From address are the minimum, and a username is useless without a
    // password. The old predicate checked only host and user, so it declared SMTP
    // "enabled" for configurations that could not possibly authenticate.
    enabled: Boolean(host && from && (user ? password : true)) && map["email.enabled"] !== "false",
  };
}

// Cached transporter, keyed on the settings that define it. Rebuilt when they change.
let cachedTransport: { key: string; transporter: Transporter } | null = null;

function transporterFor(smtp: SmtpSettings): Transporter {
  const key = [smtp.host, smtp.port, smtp.user, smtp.secure, smtp.rejectUnauthorized].join("|");
  if (cachedTransport?.key === key) return cachedTransport.transporter;

  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    // Ports 587/25 must upgrade rather than send credentials in the clear.
    ...(smtp.secure ? {} : { requireTLS: true }),
    ...(smtp.user ? { auth: { user: smtp.user, pass: smtp.password } } : {}),
    tls: { rejectUnauthorized: smtp.rejectUnauthorized },
  });

  cachedTransport = { key, transporter };
  return transporter;
}

/** Verify the SMTP connection and credentials without sending anything. */
export async function verifySmtp(): Promise<{ ok: boolean; error?: string }> {
  const smtp = await getSmtpSettings();
  if (!smtp.enabled) return { ok: false, error: "SMTP is not configured" };
  try {
    await transporterFor(smtp).verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "SMTP verification failed" };
  }
}

/**
 * Send an email with attachments. Returns the delivery result for status tracking.
 */
export async function sendReportEmail(opts: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  attachments: EmailAttachment[];
  /** Links offered in place of attachments that are too large to send. */
  downloadLinks?: string[];
}): Promise<EmailResult> {
  const sentAt = new Date();
  const recipients = opts.to.filter((a) => a.trim());

  if (recipients.length === 0) {
    return { status: "SKIPPED", success: false, error: "No recipients configured", sentAt };
  }

  const smtp = await getSmtpSettings();

  if (!smtp.enabled) {
    console.log("[Email Service] SMTP not configured — send SIMULATED, nothing was delivered:");
    console.log(`  To: ${recipients.join(", ")}`);
    console.log(`  CC: ${opts.cc?.join(", ") ?? "—"}`);
    console.log(`  Subject: ${opts.subject}`);
    console.log(
      `  Attachments: ${
        opts.attachments.map((a) => `${a.filename} (${a.content.length} bytes)`).join(", ") || "none"
      }`
    );
    return {
      status: "SIMULATED",
      success: false, // the entire point: a simulation is not a delivery
      messageId: `simulated-${Date.now()}`,
      sentAt,
    };
  }

  // Oversized attachments make many servers reject the whole message, turning a large
  // report into a total silent failure. Send the mail with download links instead.
  const totalBytes = opts.attachments.reduce((sum, a) => sum + a.content.length, 0);
  const tooLarge = totalBytes > smtp.maxAttachmentBytes;

  let body = opts.body;
  if (tooLarge) {
    body += `\n\nThe report files (${Math.round(totalBytes / 1024)} KB) exceeded the maximum attachment size and were not attached.`;
    if (opts.downloadLinks?.length) {
      body += `\nDownload them here:\n${opts.downloadLinks.map((l) => `  • ${l}`).join("\n")}`;
    }
  }

  try {
    const info = await transporterFor(smtp).sendMail({
      from: smtp.from,
      to: recipients,
      cc: opts.cc?.filter((a) => a.trim()),
      bcc: opts.bcc?.filter((a) => a.trim()),
      ...(smtp.replyTo ? { replyTo: smtp.replyTo } : {}),
      subject: opts.subject,
      text: body,
      attachments: tooLarge
        ? []
        : opts.attachments.map((a) => ({
            filename: a.filename,
            content: a.content,
            contentType: a.mimeType,
          })),
    });

    return { status: "SENT", success: true, messageId: info.messageId, sentAt };
  } catch (e) {
    return {
      status: "FAILED",
      success: false,
      error: e instanceof Error ? e.message : "Unknown email error",
      sentAt,
    };
  }
}

/** Send a short test message, used by the Settings page to prove SMTP works. */
export async function sendTestEmail(to: string): Promise<EmailResult> {
  return sendReportEmail({
    to: [to],
    subject: "GCCLAB TMS — SMTP test",
    body:
      "This is a test message from GCCLAB TMS.\n\n" +
      "If you received it, scheduled report delivery is configured correctly.",
    attachments: [],
  });
}

/**
 * Compute the next retry time based on the retry delay.
 */
export function getNextRetryTime(retryDelayMin: number): Date {
  return new Date(Date.now() + retryDelayMin * 60 * 1000);
}

/**
 * Build a default email subject for a report.
 */
export function buildEmailSubject(scheduleName: string, dateRange?: string): string {
  const date = new Date().toLocaleDateString("en-GB", { year: "numeric", month: "long", day: "numeric" });
  if (dateRange) {
    return `${scheduleName} — ${dateRange} (Generated: ${date})`;
  }
  return `${scheduleName} — Generated: ${date}`;
}

/**
 * Build a default email body for a report.
 */
export function buildEmailBody(opts: {
  scheduleName: string;
  templateName: string;
  rowCount: number;
  filters?: Record<string, string>;
  attachments: string[];
}): string {
  const lines = [
    `Dear Recipient,`,
    ``,
    `Please find attached the following report:`,
    ``,
    `Report: ${opts.scheduleName}`,
    `Template: ${opts.templateName}`,
    `Total Records: ${opts.rowCount}`,
    `Generated: ${new Date().toLocaleString("en-GB")}`,
  ];

  if (opts.filters && Object.keys(opts.filters).length > 0) {
    lines.push(``, `Filters Applied:`);
    for (const [k, v] of Object.entries(opts.filters)) {
      lines.push(`  • ${k}: ${v}`);
    }
  }

  lines.push(``, `Attachments:`);
  for (const a of opts.attachments) {
    lines.push(`  • ${a}`);
  }

  lines.push(
    ``,
    `This report was generated automatically by GCCLAB TMS.`,
    `Please do not reply to this email.`,
    ``,
    `Best regards,`,
    `GCCLAB TMS Reporting Engine`
  );

  return lines.join("\n");
}
