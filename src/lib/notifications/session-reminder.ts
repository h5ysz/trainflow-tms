// GCCLAB TMS — Session Reminder (24h) job
// =====================================================================
// Finds training sessions starting within the 24h reminder window, resolves the
// contractor(s) responsible for each enrolled company, and dispatches the reminder
// through the Notification Service across Email / WhatsApp / SMS.
//
// Deduplication: NotificationLog's unique (type, referenceId, companyId, channel)
// key means a cron that fires twice can never send the same reminder twice. Only
// channels still in PENDING/FAILED are retried; SENT channels are never re-sent.
//
// Window: sessions whose startDate falls within [now + 23h, now + 24h]. Absolute
// time comparison (timezone-independent); the project timezone only shapes the
// human-readable date/time and the morning/evening period in the templates.

import { db } from "@/lib/db";
import { dispatchNotification } from "./service";
import type { NotificationLocale, ChannelResult } from "./types";
import { buildSessionReminderTemplates } from "./templates/session-reminder";
import {
  buildSessionTemplateData,
  getCompanyTraineeCount,
  resolveCompanyRecipients,
  createInAppNotificationIfAbsent,
} from "./session-data";

/** How long before a session the reminder is due. */
export const REMINDER_HOURS = 24;
/** Grace window: sessions between 23h and 24h away are reminded in this tick. */
export const REMINDER_TOLERANCE_HOURS = 1;

/**
 * The absolute window a session's startDate must fall into for this tick to
 * remind it: [now + (HOURS - TOLERANCE), now + HOURS]. Pure — testable and used
 * by the cron query below. Sessions farther than 24h away are never reminded
 * early; sessions already past the window are left to earlier ticks.
 */
export function reminderWindow(now: Date): { from: Date; to: Date } {
  const from = new Date(now.getTime() + (REMINDER_HOURS - REMINDER_TOLERANCE_HOURS) * 3600_000);
  const to = new Date(now.getTime() + REMINDER_HOURS * 3600_000);
  return { from, to };
}

/** Whether a session's start time falls inside the reminder window. */
export function inReminderWindow(startDate: Date, now: Date): boolean {
  const { from, to } = reminderWindow(now);
  return startDate.getTime() >= from.getTime() && startDate.getTime() <= to.getTime();
}

/**
 * The Prisma WHERE clause for the reminder tick. Pure — this is the guarantee
 * that only SCHEDULED sessions inside the window are ever considered, so
 * COMPLETED / CANCELLED / IN_PROGRESS / NO_SHOW sessions are never reminded.
 */
export function buildReminderSessionWhere(now: Date) {
  const { from, to } = reminderWindow(now);
  return {
    deletedAt: null,
    status: "SCHEDULED",
    startDate: { gte: from, lte: to },
  } as const;
}

export interface SessionReminderResult {
  scanned: number; // sessions found inside the window
  companiesProcessed: number;
  sent: number; // channels actually delivered
  failed: number; // channels that failed
  skipped: number; // channels already sent (or no recipient)
  inAppNotifications: number;
  errors: string[];
}

/** The in-app notification type label for the Notification Center. */
export const SESSION_REMINDER_NOTIFICATION_TYPE = "SESSION_REMINDER_24H";

interface SessionRow {
  id: string;
  refNumber: string;
  title: string;
  startDate: Date;
  endDate: Date;
  location: string | null;
  venue: string | null;
  city: string | null;
  expectedTrainees: number;
  course: { title: string; titleAr: string | null } | null;
  trainer: { nameEn: string; nameAr: string | null } | null;
  request: {
    companyId: string | null;
    contact: { id: string; fullName: string; fullNameAr: string | null; email: string | null; mobile: string | null; phone: string | null } | null;
  } | null;
  sessionCompanies: Array<{ companyId: string; traineeCount: number; company: { name: string; nameAr: string | null } }>;
}

export async function processSessionReminders(now: Date = new Date()): Promise<SessionReminderResult> {
  const result: SessionReminderResult = {
    scanned: 0, companiesProcessed: 0, sent: 0, failed: 0, skipped: 0, inAppNotifications: 0, errors: [],
  };

  const window = reminderWindow(now);

  // Only SCHEDULED sessions with a valid startDate inside the window. COMPLETED /
  // CANCELLED / IN_PROGRESS / NO_SHOW sessions are never reminded.
  const sessions = (await db.trainingSession.findMany({
    where: buildReminderSessionWhere(now),
    include: {
      course: { select: { title: true, titleAr: true } },
      trainer: { select: { nameEn: true, nameAr: true } },
      request: {
        select: {
          companyId: true,
          contact: {
            select: { id: true, fullName: true, fullNameAr: true, email: true, mobile: true, phone: true },
          },
        },
      },
      sessionCompanies: {
        select: {
          companyId: true,
          traineeCount: true,
          company: { select: { name: true, nameAr: true } },
        },
      },
    },
  })) as SessionRow[];

  result.scanned = sessions.length;

  for (const session of sessions) {
    try {
      const outcome = await remindSession(session, result);
      result.sent += outcome.sent;
      result.failed += outcome.failed;
      result.skipped += outcome.skipped;
      result.inAppNotifications += outcome.inAppNotifications;
    } catch (e) {
      result.errors.push(`Session ${session.refNumber}: ${(e as Error).message}`);
    }
  }

  return result;
}

async function remindSession(
  session: SessionRow,
  result: SessionReminderResult
): Promise<{ sent: number; failed: number; skipped: number; inAppNotifications: number }> {
  const companies = session.sessionCompanies;
  const summary = { sent: 0, failed: 0, skipped: 0, inAppNotifications: 0 };
  const adminChannels: Array<{ companyLabel: string; channels: ChannelResult[] }> = [];

  for (const sc of companies) {
    result.companiesProcessed++;
    const company = sc.company;

    // ── Recipients: contractor users of THIS company only. The count each sees
    //    is computed from the actual enrollment relation for their company — a
    //    contractor never learns anything about the other companies in the
    //    session. ──
    const recipients = await resolveCompanyRecipients(session, sc.companyId, company.name);
    const companyTraineeCount = await getCompanyTraineeCount(session.id, sc.companyId);

    const dispatchResult = await dispatchNotification({
      type: SESSION_REMINDER_NOTIFICATION_TYPE,
      referenceType: "SESSION",
      referenceId: session.id,
      companyId: sc.companyId,
      scheduledAt: session.startDate,
      // A rescheduled session is a NEW reminder instance: SENT rows for the old
      // date are rolled forward (service re-dispatches), while two ticks for the
      // same date still dedupe exactly once.
      rescheduleAware: true,
      recipients,
      buildContent: (recipient) => buildRecipientContent(session, companyTraineeCount, recipient),
    });

    summary.sent += dispatchResult.sent;
    summary.failed += dispatchResult.failed;
    summary.skipped += dispatchResult.skipped;

    // ── In-app Notification for each contractor of this company ──
    const companyLabel = company.nameAr ?? company.name;
    for (const r of recipients) {
      if (!r.userId) continue;
      const personal = buildPersonalNotification(session, companyTraineeCount, sc.companyId, dispatchResult.results);
      if (await createInAppNotificationIfAbsent(r.userId, personal)) summary.inAppNotifications++;
    }

    adminChannels.push({ companyLabel, channels: dispatchResult.results });
  }

  // ── Admin-facing broadcast: per-company per-channel delivery status ──
  const adminNotif = buildAdminNotification(session, adminChannels);
  const admins = await db.user.findMany({
    where: { role: "SUPER_ADMIN", isActive: true, deletedAt: null },
    select: { id: true },
  });
  for (const a of admins) {
    if (await createInAppNotificationIfAbsent(a.id, adminNotif)) summary.inAppNotifications++;
  }

  return summary;
}

/** A placeholder recipient so a company with no contacts still produces FAILED ledger rows. */
function buildRecipientContent(
  session: SessionRow,
  traineeCount: number,
  recipient: { language: NotificationLocale; email?: string | null; phone?: string | null }
): Array<{ channel: "EMAIL" | "WHATSAPP" | "SMS"; subject?: string; body: string }> {
  const locale = recipient.language;
  const t = buildSessionTemplateData(session, traineeCount, locale);
  const templates = buildSessionReminderTemplates(locale, t);

  const contents: Array<{ channel: "EMAIL" | "WHATSAPP" | "SMS"; subject?: string; body: string }> = [];
  if (recipient.email) contents.push({ channel: "EMAIL", subject: templates.email.subject, body: templates.email.html });
  if (recipient.phone) contents.push({ channel: "WHATSAPP", body: templates.whatsapp.body });
  if (recipient.phone) contents.push({ channel: "SMS", body: templates.sms.body });
  return contents;
}

// ─────────────────────────────────────────────────────────────────────────────
// In-app Notification rows (Notification Center)
// ─────────────────────────────────────────────────────────────────────────────

/** Dedupe key is scoped to the reminder INSTANCE (session start instant), so a
 *  rescheduled session produces a fresh in-app reminder while a re-run cron
 *  (same date) can never duplicate the inbox item. */
function dedupeKey(sessionId: string, companyId: string, startDate: Date): string {
  return `reminder-24h-${sessionId}-${companyId}-${startDate.getTime()}`;
}

function channelSummary(channels: ChannelResult[]): string {
  const byChannel: Record<string, string> = {};
  for (const c of channels) byChannel[c.channel] = c.status;
  return ["EMAIL", "WHATSAPP", "SMS"]
    .map((ch) => `${ch} ${byChannel[ch] ?? "—"}`)
    .join(" • ");
}

function buildPersonalNotification(
  session: SessionRow,
  traineeCount: number,
  companyId: string,
  channels: ChannelResult[]
): { title: string; titleAr: string; message: string; messageAr: string; link: string; key: string } {
  const en = buildSessionTemplateData(session, traineeCount, "en");
  const ar = buildSessionTemplateData(session, traineeCount, "ar");
  const key = dedupeKey(session.id, companyId, session.startDate);

  return {
    title: "Session Reminder – 24 Hours",
    titleAr: "تذكير بجلسة تدريبية — 24 ساعة",
    message:
      `${en.courseTitle} (${session.refNumber}) starts tomorrow at ${en.startTime}. ` +
      `Location: ${en.location}. Trainees: ${en.traineeCount}. Channels: ${channelSummary(channels)} [${key}]`,
    messageAr:
      `${ar.courseTitle} (${session.refNumber}) تبدأ غدًا في ${ar.startTime}. ` +
      `الموقع: ${ar.location}. المتدربون: ${ar.traineeCount}. القنوات: ${channelSummary(channels)} [${key}]`,
    link: `/sessions/${session.refNumber}`,
    key,
  };
}

function buildAdminNotification(
  session: SessionRow,
  companies: Array<{ companyLabel: string; channels: ChannelResult[] }>
): { title: string; titleAr: string; message: string; messageAr: string; link: string; key: string } {
  const key = dedupeKey(session.id, "admin", session.startDate);
  const lines = companies.map((c) => `${c.companyLabel} → ${channelSummary(c.channels)}`);

  return {
    title: "Session Reminder – 24 Hours",
    titleAr: "تذكير بجلسة تدريبية — 24 ساعة",
    message:
      `Session ${session.refNumber} (${session.course?.title ?? session.title}) reminded 24h ahead. ` +
      `Delivery per company: ${lines.join("; ") || "no companies"}. [${key}]`,
    messageAr:
      `تم إرسال تذكير 24 ساعة للجلسة ${session.refNumber} (${session.course?.titleAr ?? session.course?.title ?? session.title}). ` +
      `حالة الإرسال لكل شركة: ${lines.join("؛ ") || "لا توجد شركات"}. [${key}]`,
    link: `/sessions/${session.refNumber}`,
    key,
  };
}
