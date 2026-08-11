// GCCLAB TMS — SESSION_SCHEDULE_UPDATED templates
// =====================================================================
// AR + EN templates for Email / WhatsApp / SMS / in-app. One notification
// aggregates ALL changes made in a single save (never one message per field),
// followed by the full new schedule so the contractor has the complete picture.
//
// `changes` items are already localized by the caller (see session-update.ts);
// every value shown to a contractor is scoped to THEIR company's trainee count.

import type { NotificationLocale } from "../types";
import { periodLabel } from "../types";
import type { SessionTemplateData } from "../session-data";

export interface LocalizedSessionChange {
  label: string;
  labelAr: string;
  from: string;
  to: string;
}

export interface SessionUpdateTemplates {
  email: { subject: string; html: string };
  whatsapp: { body: string };
  sms: { body: string };
  inApp: { title: string; titleAr: string; message: string; messageAr: string };
}

export function buildSessionUpdateTemplates(
  locale: NotificationLocale,
  d: SessionTemplateData,
  changes: LocalizedSessionChange[]
): SessionUpdateTemplates {
  return {
    email: buildEmailTemplates(locale, d, changes),
    whatsapp: { body: buildWhatsAppBody(locale, d, changes) },
    sms: { body: buildSmsBody(locale, d, changes) },
    inApp: buildInAppTemplates(locale, d, changes),
  };
}

function changeLine(locale: NotificationLocale, c: LocalizedSessionChange): string {
  const label = locale === "ar" ? c.labelAr : c.label;
  return `${label}: ${c.from} → ${c.to}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL — structured
// ─────────────────────────────────────────────────────────────────────────────

function buildEmailTemplates(
  locale: NotificationLocale,
  d: SessionTemplateData,
  changes: LocalizedSessionChange[]
): { subject: string; html: string } {
  const isAr = locale === "ar";
  const subject = isAr
    ? `تحديث موعد جلسة تدريبية — ${d.courseTitle} (${d.sessionRef})`
    : `Training session updated — ${d.courseTitle} (${d.sessionRef})`;

  const changeItems = changes
    .map(
      (c) => `<li>${changeLine(locale, c)}</li>`
    )
    .join("");

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
  <div style="background:#b45309;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;font-size:18px;">${isAr ? "تم تحديث بيانات الجلسة التدريبية" : "Training Session Updated"}</h2>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;padding:22px;border-radius:0 0 8px 8px;">
    <p style="margin-top:0;color:#374151;">${
      isAr
        ? "تم تعديل بيانات جلستكم التدريبية. يرجى مراجعة التحديثات التالية والموعد الجديد."
        : "Your training session details have been updated. Please review the changes and the new schedule below."
    }</p>
    ${
      changes.length > 0
        ? `<p style="margin:0 0 6px;font-weight:600;">${isAr ? "التغييرات:" : "Changes:"}</p>
           <ul style="margin:0 0 16px;padding-left:${isAr ? "20px" : "20px"};color:#111827;">${changeItems}</ul>`
        : ""
    }
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

function buildWhatsAppBody(
  locale: NotificationLocale,
  d: SessionTemplateData,
  changes: LocalizedSessionChange[]
): string {
  const changeLines = changes.map((c) => `• ${changeLine(locale, c)}`);

  if (locale === "ar") {
    return [
      `*تحديث بيانات الجلسة التدريبية*`,
      ``,
      ...changeLines,
      ``,
      `التفاصيل الجديدة:`,
      `الدورة: ${d.courseTitle}`,
      `التاريخ: ${d.dateLabel}`,
      `الفترة: ${periodLabel(d.period, locale)}`,
      `الوقت: ${d.startTime} – ${d.endTime}`,
      `الموقع: ${d.location}`,
      `المدرب: ${d.trainerName}`,
      `عدد المتدربين: ${d.traineeCount}`,
      `رقم الجلسة: ${d.sessionRef}`,
      ``,
      `يرجى مراجعة الموعد والموقع المحدثين.`,
    ].join("\n");
  }
  return [
    `*Training Session Updated*`,
    ``,
    ...changeLines,
    ``,
    `New details:`,
    `Course: ${d.courseTitle}`,
    `Date: ${d.dateLabel}`,
    `Period: ${periodLabel(d.period, locale)}`,
    `Time: ${d.startTime} – ${d.endTime}`,
    `Location: ${d.location}`,
    `Trainer: ${d.trainerName}`,
    `Trainees: ${d.traineeCount}`,
    `Session Ref: ${d.sessionRef}`,
    ``,
    `Please review the updated schedule and location.`,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// SMS — short
// ─────────────────────────────────────────────────────────────────────────────

function buildSmsBody(
  locale: NotificationLocale,
  d: SessionTemplateData,
  changes: LocalizedSessionChange[]
): string {
  const summary = changes.map((c) => changeLine(locale, c)).join("; ");
  if (locale === "ar") {
    return (
      `تحديث جلسة ${d.sessionRef}: ${summary}. الجديد: ${d.dateLabel} ${periodLabel(d.period, locale)} ${d.startTime}–${d.endTime} @ ${d.location}. المدرب: ${d.trainerName}.`
    );
  }
  return (
    `Session ${d.sessionRef} updated: ${summary}. New: ${d.dateLabel} ${periodLabel(d.period, locale)} ${d.startTime}–${d.endTime} @ ${d.location}. Trainer: ${d.trainerName}.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IN-APP — short and clear (dedupe key appended by the caller)
// ─────────────────────────────────────────────────────────────────────────────

function buildInAppTemplates(
  locale: NotificationLocale,
  d: SessionTemplateData,
  changes: LocalizedSessionChange[]
): { title: string; titleAr: string; message: string; messageAr: string } {
  const summary = changes.map((c) => changeLine(locale, c)).join("; ");
  return {
    title: "Session Updated",
    titleAr: "تحديث موعد الجلسة",
    message:
      `Session ${d.sessionRef} (${d.courseTitle}) updated. ${summary}. ` +
      `New details: ${d.dateLabel}, ${periodLabel(d.period, "en")}, ${d.startTime}–${d.endTime}, ${d.location}, Trainer: ${d.trainerName}, Trainees: ${d.traineeCount}.`,
    messageAr:
      `تم تحديث الجلسة ${d.sessionRef} (${d.courseTitle}). ${summary}. ` +
      `الموعد الجديد: ${d.dateLabel}، ${periodLabel(d.period, "ar")}، ${d.startTime}–${d.endTime}، ${d.location}، المدرب: ${d.trainerName}، المتدربون: ${d.traineeCount}.`,
  };
}
