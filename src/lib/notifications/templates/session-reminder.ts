// GCCLAB TMS — Session Reminder (24h) templates
// =====================================================================
// AR + EN templates for Email / WhatsApp / SMS. All values are pulled from the
// session record — nothing is typed by a coordinator. The same information is
// formatted to suit each channel: Email is structured, WhatsApp concise, SMS a
// short plain text message.

import type { NotificationLocale, SessionPeriod } from "../types";
import { formatZoned, formatTime, periodLabel } from "../types";

export interface SessionReminderTemplateData {
  courseTitle: string; // localized course title
  dateLabel: string;   // localized session date
  period: SessionPeriod;
  startTime: string;
  endTime: string;
  location: string;
  trainerName: string; // already resolved (with "not assigned" fallback)
  traineeCount: number;
  sessionRef: string;
}

/** Trainer fallback when the session has no trainer assigned yet. */
export function trainerFallback(locale: NotificationLocale): string {
  return locale === "ar" ? "لم يتم التعيين بعد" : "Not assigned yet";
}

/** Build the reminder content for every channel in the recipient's locale. */
export function buildSessionReminderTemplates(
  locale: NotificationLocale,
  d: SessionReminderTemplateData
): { email: { subject: string; html: string }; whatsapp: { body: string }; sms: { body: string } } {
  return {
    email: buildEmailTemplates(locale, d),
    whatsapp: { body: buildWhatsAppBody(locale, d) },
    sms: { body: buildSmsBody(locale, d) },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL — structured message
// ─────────────────────────────────────────────────────────────────────────────

function buildEmailTemplates(
  locale: NotificationLocale,
  d: SessionReminderTemplateData
): { subject: string; html: string } {
  const isAr = locale === "ar";
  const subject = isAr
    ? `تذكير بجلسة تدريبية غدًا — ${d.courseTitle} (${d.sessionRef})`
    : `Training session reminder tomorrow — ${d.courseTitle} (${d.sessionRef})`;

  const rows = [
    row(isAr ? "الدورة" : "Course", d.courseTitle),
    row(isAr ? "التاريخ" : "Date", d.dateLabel),
    row(isAr ? "الفترة" : "Period", periodLabel(d.period, locale)),
    row(isAr ? "وقت البداية" : "Start time", d.startTime),
    row(isAr ? "وقت النهاية" : "End time", d.endTime),
    row(isAr ? "الموقع" : "Location", d.location),
    row(isAr ? "المدرب" : "Trainer", d.trainerName),
    row(isAr ? "عدد المتدربين" : "Trainee count", String(d.traineeCount)),
    row(isAr ? "رقم الجلسة" : "Session ref", d.sessionRef),
  ].join("");

  const html = `
<div dir="${isAr ? "rtl" : "ltr"}" style="font-family:Arial,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;">
  <div style="background:#1e40af;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;font-size:18px;">${isAr ? "تذكير بجلسة تدريبية غدًا" : "Training Session Reminder — Tomorrow"}</h2>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;padding:22px;border-radius:0 0 8px 8px;">
    <p style="margin-top:0;color:#374151;">${
      isAr
        ? "نذكّركم بجلسة التدريب المقررة غدًا. نأمل التأكد من حضور المتدربين في الموعد والموقع المحددين."
        : "This is a reminder of your training session scheduled for tomorrow. Please make sure trainees attend on time at the specified location."
    }</p>
    <table style="border-collapse:collapse;width:100%;">
      ${rows}
    </table>
    <p style="margin-bottom:0;color:#6b7280;font-size:12px;">
      ${isAr
        ? "هذه رسالة تلقائية من نظام GCCLAB — لا تقم بالرد على هذه الرسالة."
        : "This is an automated message from GCCLAB TMS — please do not reply."}
    </p>
  </div>
</div>`;

  return { subject, html };
}

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:7px 10px;background:#f3f4f6;border:1px solid #e5e7eb;font-weight:600;width:40%;">${label}</td>
      <td style="padding:7px 10px;border:1px solid #e5e7eb;">${value}</td>
    </tr>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// WHATSAPP — clear and concise
// ─────────────────────────────────────────────────────────────────────────────

function buildWhatsAppBody(locale: NotificationLocale, d: SessionReminderTemplateData): string {
  if (locale === "ar") {
    return [
      `*تذكير بجلسة تدريبية غدًا*`,
      ``,
      `الدورة: ${d.courseTitle}`,
      `التاريخ: ${d.dateLabel}`,
      `الفترة: ${periodLabel(d.period, locale)}`,
      `الوقت: ${d.startTime} – ${d.endTime}`,
      `الموقع: ${d.location}`,
      `المدرب: ${d.trainerName}`,
      `عدد المتدربين: ${d.traineeCount}`,
      `رقم الجلسة: ${d.sessionRef}`,
      ``,
      `نأمل التأكد من حضور المتدربين في الموعد والموقع المحددين.`,
    ].join("\n");
  }
  return [
    `*Training Session Reminder — Tomorrow*`,
    ``,
    `Course: ${d.courseTitle}`,
    `Date: ${d.dateLabel}`,
    `Period: ${periodLabel(d.period, locale)}`,
    `Time: ${d.startTime} – ${d.endTime}`,
    `Location: ${d.location}`,
    `Trainer: ${d.trainerName}`,
    `Trainees: ${d.traineeCount}`,
    `Session Ref: ${d.sessionRef}`,
    ``,
    `Please make sure trainees attend on time at the specified location.`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// SMS — short version
// ─────────────────────────────────────────────────────────────────────────────

function buildSmsBody(locale: NotificationLocale, d: SessionReminderTemplateData): string {
  if (locale === "ar") {
    return (
      `تذكير: جلسة غدًا ${d.courseTitle} (${d.sessionRef}) — ${periodLabel(d.period, locale)} ${d.startTime}–${d.endTime} @ ${d.location}. ` +
      `المدرب: ${d.trainerName}. المتدربون: ${d.traineeCount}.`
    );
  }
  return (
    `Reminder: Tomorrow ${d.courseTitle} (${d.sessionRef}) — ${periodLabel(d.period, locale)} ${d.startTime}–${d.endTime} @ ${d.location}. ` +
    `Trainer: ${d.trainerName}. Trainees: ${d.traineeCount}.`
  );
}

/** Format the session date once, localized (used by both the email and the in-app message). */
export function formatSessionDate(startDate: Date, locale: NotificationLocale, timezone?: string): string {
  return formatZoned(
    startDate,
    locale,
    timezone,
    locale === "ar"
      ? { weekday: "long", day: "numeric", month: "long", year: "numeric" }
      : { weekday: "long", day: "numeric", month: "long", year: "numeric" }
  );
}

export { formatTime };
