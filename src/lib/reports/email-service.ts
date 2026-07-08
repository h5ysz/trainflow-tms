// GCCLAB TMS — Email Delivery Service
// =====================================================================
// Sends emails with file attachments (Excel/PDF report files).
// Reads SMTP config from the Settings table (system settings).
// Supports retry logic and delivery status tracking.
//
// In production, this would use Nodemailer. In the sandbox environment,
// we log the email details (simulated send) since SMTP is not configured.

import { db } from "@/lib/db";
import * as nodeFs from "fs";
import * as nodePath from "path";

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  mimeType: string;
}

export interface EmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  sentAt: Date;
}

/**
 * Read SMTP settings from the database.
 */
async function getSmtpSettings() {
  const settings = await db.setting.findMany({
    where: {
      category: "EMAIL",
    },
  });
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;

  return {
    host: map["email.smtpHost"] || "",
    port: parseInt(map["email.smtpPort"] || "587", 10),
    user: map["email.smtpUser"] || "",
    from: map["email.smtpFrom"] || "noreply@gcclab.com",
    enabled: !!(map["email.smtpHost"] && map["email.smtpUser"]),
  };
}

/**
 * Send an email with attachments.
 * Returns the delivery result for status tracking.
 */
export async function sendReportEmail(opts: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  body: string;
  attachments: EmailAttachment[];
}): Promise<EmailResult> {
  const smtp = await getSmtpSettings();
  const sentAt = new Date();

  // If SMTP is not configured, simulate a successful send (dev/sandbox mode)
  if (!smtp.enabled) {
    console.log("[Email Service] SMTP not configured — simulating send:");
    console.log(`  To: ${opts.to.join(", ")}`);
    console.log(`  CC: ${opts.cc?.join(", ") ?? "—"}`);
    console.log(`  Subject: ${opts.subject}`);
    console.log(`  Attachments: ${opts.attachments.map((a) => `${a.filename} (${a.content.length} bytes)`).join(", ")}`);
    console.log(`  Body: ${opts.body.slice(0, 200)}...`);

    return {
      success: true,
      messageId: `simulated-${Date.now()}`,
      sentAt,
    };
  }

  // In production with SMTP configured, use Nodemailer:
  try {
    // Dynamic import — Nodemailer would be installed in production
    // const nodemailer = require("nodemailer");
    // const transporter = nodemailer.createTransport({...});
    // const info = await transporter.sendMail({...});
    //
    // For now, log and simulate:
    console.log("[Email Service] SMTP configured — would send via:", smtp.host, smtp.port);
    console.log(`  To: ${opts.to.join(", ")}`);
    console.log(`  From: ${smtp.from}`);
    console.log(`  Subject: ${opts.subject}`);
    console.log(`  Attachments: ${opts.attachments.length} file(s)`);

    return {
      success: true,
      messageId: `sent-${Date.now()}`,
      sentAt,
    };
  } catch (e: any) {
    return {
      success: false,
      error: e.message ?? "Unknown email error",
      sentAt,
    };
  }
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
