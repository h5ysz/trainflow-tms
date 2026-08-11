// GCCLAB TMS — SESSION_SCHEDULE_UPDATED notification
// =====================================================================
// Sent when a coordinator edits an APPROVED/SCHEDULED session (date, time,
// period, location or trainer). ONE combined notification per save operation —
// never one message per field — delivered across the four channels:
//   in-app + Email + WhatsApp + SMS.
//
// Date/time changes are handled by the reminder design itself: reminders are
// query-driven off the session's CURRENT startDate, so moving a session cancels
// the old reminder automatically and the reschedule-aware dispatch in
// ./service.ts sends a fresh 24h reminder instance for the new date.
//
// Dedupe: the change hash rides in the NotificationLog referenceId, so two
// identical saves never re-notify, while two DIFFERENT edits both notify. The
// in-app inbox uses the same hash in its message key.
//
// Contractor scoping: recipients and the trainee count are resolved per company
// from the SessionEnrollment relation — a contractor never sees another
// company's data. The trainer shown is the session's assigned trainer (a
// TrainingSession has a single trainerId), or the "not assigned" fallback.

import { db } from "@/lib/db";
import { createHash } from "node:crypto";
import { dispatchNotification } from "./service";
import {
  buildSessionTemplateData,
  getCompanyTraineeCount,
  resolveCompanyRecipients,
  createInAppNotificationIfAbsent,
  displayLocation,
  type SessionSnapshot,
} from "./session-data";
import {
  buildSessionUpdateTemplates,
  type LocalizedSessionChange,
} from "./templates/session-update";
import { formatSessionDate, trainerFallback } from "./templates/session-reminder";
import { formatTime, type NotificationLocale } from "./types";

/** The NotificationLog type + in-app category label for schedule updates. */
export const SESSION_SCHEDULE_UPDATED_TYPE = "SESSION_SCHEDULE_UPDATED";

/** The session fields whose edits trigger the update notification. */
export type SessionChangeField = "startDate" | "endDate" | "location" | "trainer";

/** A change value that can still be localized per recipient. */
export type SessionChangeValue =
  | { kind: "datetime"; date: Date }
  | { kind: "text"; en: string; ar: string };

export interface SessionChangeDescriptor {
  field: SessionChangeField;
  label: string;
  labelAr: string;
  from: SessionChangeValue;
  to: SessionChangeValue;
}

/** The "before" snapshot the update route passes (values it already fetched). */
export interface SessionScheduleSnapshot {
  startDate: Date;
  endDate: Date;
  location: string | null;
  venue: string | null;
  city: string | null;
  trainerId: string | null;
}

interface AfterSession extends SessionSnapshot {
  trainerId: string | null;
  status: string;
  deletedAt: Date | null;
  trainer: { id: string; nameEn: string; nameAr: string | null } | null;
  request: {
    companyId: string | null;
    contact: { fullName: string; fullNameAr: string | null; email: string | null; mobile: string | null; phone: string | null } | null;
  } | null;
  sessionCompanies: Array<{ companyId: string; company: { name: string; nameAr: string | null } }>;
}

function formatChangeValue(v: SessionChangeValue, locale: NotificationLocale): string {
  if (v.kind === "datetime") {
    return `${formatSessionDate(v.date, locale)}, ${formatTime(v.date, locale)}`;
  }
  return locale === "ar" ? v.ar : v.en;
}

function textValue(str: string): SessionChangeValue {
  return { kind: "text", en: str || "—", ar: str || "—" };
}

function trainerValue(trainer: { nameEn: string; nameAr: string | null } | null | undefined): SessionChangeValue {
  if (!trainer) return { kind: "text", en: trainerFallback("en"), ar: trainerFallback("ar") };
  return { kind: "text", en: trainer.nameEn, ar: trainer.nameAr ?? trainer.nameEn };
}

/**
 * Stable hash of a change set. Equal change sets → equal hash → the same
 * NotificationLog dedupe reference and in-app key, so a double-submitted save
 * never notifies twice. Different changes → a fresh notification.
 */
export function sessionChangeHash(changes: SessionChangeDescriptor[]): string {
  const key = [...changes]
    .sort((a, b) => a.field.localeCompare(b.field))
    .map((c) => {
      const from = c.from.kind === "datetime" ? `t:${c.from.date.getTime()}` : `en:${c.from.en}|ar:${c.from.ar}`;
      const to = c.to.kind === "datetime" ? `t:${c.to.date.getTime()}` : `en:${c.to.en}|ar:${c.to.ar}`;
      return `${c.field}:${from}->${to}`;
    })
    .join("|");
  return createHash("sha1").update(key).digest("hex").slice(0, 12);
}

/**
 * Diff the schedule-relevant fields between the session before and after an
 * edit. Pure apart from the old-trainer lookup. Returns an empty array when
 * nothing schedule-relevant changed (e.g. only `notes` was edited).
 */
export async function buildSessionScheduleChanges(
  after: AfterSession,
  before: SessionScheduleSnapshot
): Promise<SessionChangeDescriptor[]> {
  const changes: SessionChangeDescriptor[] = [];

  if (before.startDate.getTime() !== after.startDate.getTime()) {
    changes.push({
      field: "startDate",
      label: "Date & time",
      labelAr: "التاريخ والوقت",
      from: { kind: "datetime", date: before.startDate },
      to: { kind: "datetime", date: after.startDate },
    });
  }
  if (before.endDate.getTime() !== after.endDate.getTime()) {
    changes.push({
      field: "endDate",
      label: "End time",
      labelAr: "وقت النهاية",
      from: { kind: "datetime", date: before.endDate },
      to: { kind: "datetime", date: after.endDate },
    });
  }

  const locBefore = displayLocation(before);
  const locAfter = displayLocation(after);
  if (locBefore !== locAfter) {
    changes.push({
      field: "location",
      label: "Location",
      labelAr: "الموقع",
      from: textValue(locBefore),
      to: textValue(locAfter),
    });
  }

  const newTrainerId = after.trainer?.id ?? null;
  if (before.trainerId !== newTrainerId) {
    const oldTrainer = before.trainerId
      ? await db.trainer.findUnique({ where: { id: before.trainerId }, select: { nameEn: true, nameAr: true } })
      : null;
    changes.push({
      field: "trainer",
      label: "Trainer",
      labelAr: "المدرب",
      from: trainerValue(oldTrainer),
      to: trainerValue(after.trainer),
    });
  }

  return changes;
}

export interface NotifyScheduleUpdateResult {
  companies: number;
  sent: number;
  failed: number;
  skipped: number;
  inAppNotifications: number;
  hash: string;
}

/**
 * Dispatch the SESSION_SCHEDULE_UPDATED notification (all four channels) to the
 * contractors of every company enrolled in the session. Returns null when the
 * session is not in SCHEDULED state or nothing schedule-relevant changed.
 */
export async function notifySessionScheduleUpdate(
  sessionId: string,
  before: SessionScheduleSnapshot
): Promise<NotifyScheduleUpdateResult | null> {
  const after = (await db.trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      course: { select: { title: true, titleAr: true } },
      trainer: { select: { id: true, nameEn: true, nameAr: true } },
      request: {
        select: {
          companyId: true,
          contact: { select: { fullName: true, fullNameAr: true, email: true, mobile: true, phone: true } },
        },
      },
      sessionCompanies: { select: { companyId: true, company: { select: { name: true, nameAr: true } } } },
    },
  })) as AfterSession | null;

  if (!after || after.deletedAt) return null;
  // Only approved/scheduled (future) sessions notify on edits — editing an
  // in-progress or completed session never fires a schedule update.
  if (after.status !== "SCHEDULED") return null;

  const changes = await buildSessionScheduleChanges(after, before);
  if (changes.length === 0) return null;

  const hash = sessionChangeHash(changes);
  const referenceId = `${after.id}:update:${hash}`;

  const result: NotifyScheduleUpdateResult = { companies: 0, sent: 0, failed: 0, skipped: 0, inAppNotifications: 0, hash };

  for (const sc of after.sessionCompanies) {
    result.companies++;
    const company = sc.company;

    // Per-company scoping: recipients + count come from THIS company only.
    const recipients = await resolveCompanyRecipients(after, sc.companyId, company.name);
    const companyTraineeCount = await getCompanyTraineeCount(after.id, sc.companyId);

    const dispatchResult = await dispatchNotification({
      type: SESSION_SCHEDULE_UPDATED_TYPE,
      referenceType: "SESSION",
      referenceId,
      sessionId: after.id,
      companyId: sc.companyId,
      scheduledAt: after.startDate,
      recipients,
      buildContent: (recipient) => buildUpdateContent(after, companyTraineeCount, changes, recipient),
    });

    result.sent += dispatchResult.sent;
    result.failed += dispatchResult.failed;
    result.skipped += dispatchResult.skipped;

    // In-app Notification for each contractor user of this company.
    for (const r of recipients) {
      if (!r.userId) continue;
      const inApp = buildInAppPayload(after, sc.companyId, companyTraineeCount, changes, hash, r.language);
      if (await createInAppNotificationIfAbsent(r.userId, inApp)) result.inAppNotifications++;
    }
  }

  return result;
}

function buildUpdateContent(
  after: AfterSession,
  traineeCount: number,
  changes: SessionChangeDescriptor[],
  recipient: { language: NotificationLocale; email?: string | null; phone?: string | null }
): Array<{ channel: "EMAIL" | "WHATSAPP" | "SMS"; subject?: string; body: string }> {
  const locale = recipient.language;
  const data = buildSessionTemplateData(after, traineeCount, locale);
  const localized = localizeChanges(changes, locale);
  const templates = buildSessionUpdateTemplates(locale, data, localized);

  const contents: Array<{ channel: "EMAIL" | "WHATSAPP" | "SMS"; subject?: string; body: string }> = [];
  if (recipient.email) contents.push({ channel: "EMAIL", subject: templates.email.subject, body: templates.email.html });
  if (recipient.phone) contents.push({ channel: "WHATSAPP", body: templates.whatsapp.body });
  if (recipient.phone) contents.push({ channel: "SMS", body: templates.sms.body });
  return contents;
}

function buildInAppPayload(
  after: AfterSession,
  companyId: string,
  traineeCount: number,
  changes: SessionChangeDescriptor[],
  hash: string,
  locale: NotificationLocale
): { title: string; titleAr: string; message: string; messageAr: string; link: string; key: string } {
  const data = buildSessionTemplateData(after, traineeCount, locale);
  const localized = localizeChanges(changes, locale);
  const templates = buildSessionUpdateTemplates(locale, data, localized);
  const key = `update-${after.id}-${companyId}-${hash}`;

  return {
    title: templates.inApp.title,
    titleAr: templates.inApp.titleAr,
    message: `${templates.inApp.message} [${key}]`,
    messageAr: `${templates.inApp.messageAr} [${key}]`,
    link: `/sessions/${after.refNumber}`,
    key,
  };
}

function localizeChanges(changes: SessionChangeDescriptor[], locale: NotificationLocale): LocalizedSessionChange[] {
  return changes.map((c) => ({
    label: c.label,
    labelAr: c.labelAr,
    from: formatChangeValue(c.from, locale),
    to: formatChangeValue(c.to, locale),
  }));
}
