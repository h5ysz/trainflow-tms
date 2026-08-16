// GCCLAB TMS — Session lifecycle event templates
// =====================================================================
// Bilingual (AR + EN) Email / WhatsApp / SMS / in-app templates for the
// event-driven notifications: SESSION_SCHEDULED, TRAINER_ASSIGNED,
// SESSION_STARTED, ATTENDANCE_FINALIZED, SESSION_COMPLETED, RESULTS_FINALIZED.
//
// Every template string uses explicit {{variable}} slots — nothing is typed by
// a coordinator. `applyTemplate` substitutes the slot values; unknown slots
// render empty so a missing value can never crash a send.

import type { NotificationLocale } from "../types";
import { periodLabel } from "../types";
import type { SessionTemplateData } from "../session-data";

/** Substitute {{variable}} slots in a template. Pure + testable. */
export function applyTemplate(
  template: string,
  vars: Record<string, string | number>
): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key: string) =>
    String(vars[key] ?? "")
  );
}

/** Content set produced by every event builder, for every channel + in-app. */
export interface SessionEventTemplates {
  email: { subject: string; html: string };
  whatsapp: { body: string };
  sms: { body: string };
  inApp: { title: string; titleAr: string; message: string; messageAr: string };
}

/** Turn templates into the per-channel contents for one recipient. */
export function sessionEventChannels(
  t: SessionEventTemplates,
  recipient: { email?: string | null; phone?: string | null }
): Array<{ channel: "EMAIL" | "WHATSAPP" | "SMS"; subject?: string; body: string }> {
  const contents: Array<{ channel: "EMAIL" | "WHATSAPP" | "SMS"; subject?: string; body: string }> = [];
  if (recipient.email) contents.push({ channel: "EMAIL", subject: t.email.subject, body: t.email.html });
  if (recipient.phone) contents.push({ channel: "WHATSAPP", body: t.whatsapp.body });
  if (recipient.phone) contents.push({ channel: "SMS", body: t.sms.body });
  return contents;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared building blocks
// ─────────────────────────────────────────────────────────────────────────────

function baseVars(
  d: SessionTemplateData,
  locale: NotificationLocale,
  extra: Record<string, string | number> = {}
): Record<string, string | number> {
  return {
    courseTitle: d.courseTitle,
    dateLabel: d.dateLabel,
    period: periodLabel(d.period, locale),
    startTime: d.startTime,
    endTime: d.endTime,
    location: d.location,
    trainerName: d.trainerName,
    traineeCount: d.traineeCount,
    sessionRef: d.sessionRef,
    ...extra,
  };
}

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:7px 10px;background:#f3f4f6;border:1px solid #e5e7eb;font-weight:600;width:40%;">${label}</td>
      <td style="padding:7px 10px;border:1px solid #e5e7eb;">${value}</td>
    </tr>`;
}

/** The details table; values are {{var}} slots substituted by the layout. */
function detailsRows(d: SessionTemplateData, isAr: boolean): string {
  const entries: Array<[string, string]> = [
    [isAr ? "الدورة" : "Course", "{{courseTitle}}"],
    [isAr ? "التاريخ" : "Date", "{{dateLabel}}"],
    [isAr ? "الفترة" : "Period", "{{period}}"],
    [isAr ? "وقت البداية" : "Start time", "{{startTime}}"],
    [isAr ? "وقت النهاية" : "End time", "{{endTime}}"],
    [isAr ? "الموقع" : "Location", "{{location}}"],
    [isAr ? "المدرب" : "Trainer", "{{trainerName}}"],
    [isAr ? "عدد المتدربين" : "Trainee count", "{{traineeCount}}"],
    [isAr ? "رقم الجلسة" : "Session ref", "{{sessionRef}}"],
  ];
  return entries.map(([label, value]) => row(label, value)).join("");
}

function emailLayout(opts: {
  isAr: boolean;
  heading: string;
  intro: string;
  rows: string;
  vars: Record<string, string | number>;
}): string {
  const { isAr, heading, intro, rows, vars } = opts;
  return `
<div dir="${isAr ? "rtl" : "ltr"}" style="font-family:Arial,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;">
  <div style="background:#1e40af;color:#fff;padding:18px 22px;border-radius:8px 8px 0 0;">
    <h2 style="margin:0;font-size:18px;">${applyTemplate(heading, vars)}</h2>
  </div>
  <div style="border:1px solid #e5e7eb;border-top:none;padding:22px;border-radius:0 0 8px 8px;">
    <p style="margin-top:0;color:#374151;">${applyTemplate(intro, vars)}</p>
    <table style="border-collapse:collapse;width:100%;">
      ${applyTemplate(rows, vars)}
    </table>
    <p style="margin-bottom:0;color:#6b7280;font-size:12px;">
      ${isAr
        ? "هذه رسالة تلقائية من نظام GCCLAB — لا تقم بالرد على هذه الرسالة."
        : "This is an automated message from GCCLAB TMS — please do not reply."}
    </p>
  </div>
</div>`;
}

/** The copy for one event; every string is bilingual and uses {{var}} slots. */
interface EventCopySpec {
  title: string;
  titleAr: string;
  emailSubject: string;
  emailSubjectAr: string;
  heading: string;
  headingAr: string;
  intro: string;
  introAr: string;
  waHeader: string;
  waHeaderAr: string;
  waLines: string[];
  waLinesAr: string[];
  sms: string;
  smsAr: string;
  inApp: string;
  inAppAr: string;
  extraVars?: Record<string, string | number>;
}

function buildEventTemplates(
  locale: NotificationLocale,
  d: SessionTemplateData,
  spec: EventCopySpec
): SessionEventTemplates {
  const isAr = locale === "ar";
  const extra = spec.extraVars ?? {};
  const enVars = baseVars(d, "en", extra);
  const arVars = baseVars(d, "ar", extra);
  const vars = isAr ? arVars : enVars;
  const rows = detailsRows(d, isAr);

  const waLines = (isAr ? spec.waLinesAr : spec.waLines).map((l) => applyTemplate(l, vars));

  return {
    email: {
      subject: applyTemplate(isAr ? spec.emailSubjectAr : spec.emailSubject, vars),
      html: emailLayout({
        isAr,
        heading: isAr ? spec.headingAr : spec.heading,
        intro: isAr ? spec.introAr : spec.intro,
        rows,
        vars,
      }),
    },
    whatsapp: { body: [isAr ? spec.waHeaderAr : spec.waHeader, "", ...waLines].join("\n") },
    sms: { body: applyTemplate(isAr ? spec.smsAr : spec.sms, vars) },
    inApp: {
      title: spec.title,
      titleAr: spec.titleAr,
      message: applyTemplate(spec.inApp, enVars),
      messageAr: applyTemplate(spec.inAppAr, arVars),
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION_SCHEDULED
// ─────────────────────────────────────────────────────────────────────────────

export function buildSessionScheduledTemplates(
  locale: NotificationLocale,
  d: SessionTemplateData,
  _extra: Record<string, string | number> = {}
): SessionEventTemplates {
  return buildEventTemplates(locale, d, {
    title: "Session Scheduled",
    titleAr: "تم جدولة جلسة تدريبية",
    emailSubject: `Training session scheduled — {{courseTitle}} ({{sessionRef}})`,
    emailSubjectAr: `تم جدولة جلسة تدريبية — {{courseTitle}} ({{sessionRef}})`,
    heading: "Training Session Scheduled",
    headingAr: "تم جدولة جلسة تدريبية",
    intro: "A new training session has been scheduled. Please review the details below.",
    introAr: "تم جدولة جلسة تدريبية جديدة. يرجى مراجعة التفاصيل أدناه.",
    waHeader: "*Training Session Scheduled*",
    waHeaderAr: "*تم جدولة جلسة تدريبية*",
    waLines: [
      `Course: {{courseTitle}}`,
      `Date: {{dateLabel}}`,
      `Period: {{period}}`,
      `Time: {{startTime}} – {{endTime}}`,
      `Location: {{location}}`,
      `Trainer: {{trainerName}}`,
      `Trainees: {{traineeCount}}`,
      `Session Ref: {{sessionRef}}`,
    ],
    waLinesAr: [
      `الدورة: {{courseTitle}}`,
      `التاريخ: {{dateLabel}}`,
      `الفترة: {{period}}`,
      `الوقت: {{startTime}} – {{endTime}}`,
      `الموقع: {{location}}`,
      `المدرب: {{trainerName}}`,
      `عدد المتدربين: {{traineeCount}}`,
      `رقم الجلسة: {{sessionRef}}`,
    ],
    sms: `Session scheduled: {{courseTitle}} ({{sessionRef}}), {{dateLabel}}, {{period}} {{startTime}}–{{endTime}} @ {{location}}. Trainer: {{trainerName}}.`,
    smsAr: `تم جدولة جلسة: {{courseTitle}} ({{sessionRef}})، {{dateLabel}}، {{period}} {{startTime}}–{{endTime}} @ {{location}}. المدرب: {{trainerName}}.`,
    inApp: `Training session {{courseTitle}} ({{sessionRef}}) is scheduled for {{dateLabel}} at {{startTime}} ({{period}}). Location: {{location}}. Trainer: {{trainerName}}. Trainees: {{traineeCount}}.`,
    inAppAr: `تم جدولة جلسة التدريب {{courseTitle}} ({{sessionRef}}) بتاريخ {{dateLabel}} في {{startTime}} ({{period}}). الموقع: {{location}}. المدرب: {{trainerName}}. المتدربون: {{traineeCount}}.`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// TRAINER_ASSIGNED
// ─────────────────────────────────────────────────────────────────────────────

export function buildTrainerAssignedTemplates(
  locale: NotificationLocale,
  d: SessionTemplateData,
  _extra: Record<string, string | number> = {}
): SessionEventTemplates {
  return buildEventTemplates(locale, d, {
    title: "Trainer Assigned",
    titleAr: "تم تعيين المدرب",
    emailSubject: `Trainer assigned — {{courseTitle}} ({{sessionRef}})`,
    emailSubjectAr: `تم تعيين مدرب — {{courseTitle}} ({{sessionRef}})`,
    heading: "Trainer Assigned",
    headingAr: "تم تعيين المدرب",
    intro: `Trainer {{trainerName}} has been assigned to the training session below.`,
    introAr: `تم تعيين المدرب {{trainerName}} للجلسة التدريبية أدناه.`,
    waHeader: "*Trainer Assigned*",
    waHeaderAr: "*تم تعيين المدرب*",
    waLines: [
      `Trainer: {{trainerName}}`,
      `Course: {{courseTitle}}`,
      `Date: {{dateLabel}}`,
      `Period: {{period}}`,
      `Time: {{startTime}} – {{endTime}}`,
      `Location: {{location}}`,
      `Session Ref: {{sessionRef}}`,
    ],
    waLinesAr: [
      `المدرب: {{trainerName}}`,
      `الدورة: {{courseTitle}}`,
      `التاريخ: {{dateLabel}}`,
      `الفترة: {{period}}`,
      `الوقت: {{startTime}} – {{endTime}}`,
      `الموقع: {{location}}`,
      `رقم الجلسة: {{sessionRef}}`,
    ],
    sms: `Trainer {{trainerName}} assigned to session {{courseTitle}} ({{sessionRef}}) — {{dateLabel}} {{period}} {{startTime}}–{{endTime}} @ {{location}}.`,
    smsAr: `تم تعيين المدرب {{trainerName}} لجلسة {{courseTitle}} ({{sessionRef}}) — {{dateLabel}} {{period}} {{startTime}}–{{endTime}} @ {{location}}.`,
    inApp: `Trainer {{trainerName}} has been assigned to training session {{courseTitle}} ({{sessionRef}}) on {{dateLabel}}.`,
    inAppAr: `تم تعيين المدرب {{trainerName}} لجلسة التدريب {{courseTitle}} ({{sessionRef}}) بتاريخ {{dateLabel}}.`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION_STARTED
// ─────────────────────────────────────────────────────────────────────────────

export function buildSessionStartedTemplates(
  locale: NotificationLocale,
  d: SessionTemplateData,
  _extra: Record<string, string | number> = {}
): SessionEventTemplates {
  return buildEventTemplates(locale, d, {
    title: "Session Started",
    titleAr: "بدأت الجلسة",
    emailSubject: `Training session started — {{courseTitle}} ({{sessionRef}})`,
    emailSubjectAr: `بدأت جلسة تدريبية — {{courseTitle}} ({{sessionRef}})`,
    heading: "Training Session Started",
    headingAr: "بدأت الجلسة التدريبية",
    intro: "The training session has started.",
    introAr: "بدأت الجلسة التدريبية.",
    waHeader: "*Training Session Started*",
    waHeaderAr: "*بدأت الجلسة التدريبية*",
    waLines: [
      `Course: {{courseTitle}}`,
      `Date: {{dateLabel}}`,
      `Period: {{period}}`,
      `Time: {{startTime}} – {{endTime}}`,
      `Location: {{location}}`,
      `Session Ref: {{sessionRef}}`,
    ],
    waLinesAr: [
      `الدورة: {{courseTitle}}`,
      `التاريخ: {{dateLabel}}`,
      `الفترة: {{period}}`,
      `الوقت: {{startTime}} – {{endTime}}`,
      `الموقع: {{location}}`,
      `رقم الجلسة: {{sessionRef}}`,
    ],
    sms: `Session started: {{courseTitle}} ({{sessionRef}}) — {{period}} {{startTime}} @ {{location}}.`,
    smsAr: `بدأت الجلسة: {{courseTitle}} ({{sessionRef}}) — {{period}} {{startTime}} @ {{location}}.`,
    inApp: `Training session {{courseTitle}} ({{sessionRef}}) has STARTED. Location: {{location}}.`,
    inAppAr: `بدأت جلسة التدريب {{courseTitle}} ({{sessionRef}}). الموقع: {{location}}.`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ATTENDANCE_FINALIZED
// ─────────────────────────────────────────────────────────────────────────────

export function buildAttendanceFinalizedTemplates(
  locale: NotificationLocale,
  d: SessionTemplateData,
  _extra: Record<string, string | number> = {}
): SessionEventTemplates {
  return buildEventTemplates(locale, d, {
    title: "Attendance Finalized",
    titleAr: "تم توثيق الحضور",
    emailSubject: `Attendance finalized — {{courseTitle}} ({{sessionRef}})`,
    emailSubjectAr: `تم توثيق الحضور — {{courseTitle}} ({{sessionRef}})`,
    heading: "Attendance Finalized",
    headingAr: "تم توثيق الحضور",
    intro: "Attendance for the training session has been finalized and locked.",
    introAr: "تم توثيق حضور الجلسة التدريبية وإقفاله.",
    waHeader: "*Attendance Finalized*",
    waHeaderAr: "*تم توثيق الحضور*",
    waLines: [
      `Course: {{courseTitle}}`,
      `Date: {{dateLabel}}`,
      `Period: {{period}}`,
      `Time: {{startTime}} – {{endTime}}`,
      `Location: {{location}}`,
      `Session Ref: {{sessionRef}}`,
    ],
    waLinesAr: [
      `الدورة: {{courseTitle}}`,
      `التاريخ: {{dateLabel}}`,
      `الفترة: {{period}}`,
      `الوقت: {{startTime}} – {{endTime}}`,
      `الموقع: {{location}}`,
      `رقم الجلسة: {{sessionRef}}`,
    ],
    sms: `Attendance finalized for {{courseTitle}} ({{sessionRef}}).`,
    smsAr: `تم توثيق الحضور لجلسة {{courseTitle}} ({{sessionRef}}).`,
    inApp: `Attendance for training session {{courseTitle}} ({{sessionRef}}) has been finalized.`,
    inAppAr: `تم توثيق الحضور لجلسة التدريب {{courseTitle}} ({{sessionRef}}).`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SESSION_COMPLETED
// ─────────────────────────────────────────────────────────────────────────────

export function buildSessionCompletedTemplates(
  locale: NotificationLocale,
  d: SessionTemplateData,
  _extra: Record<string, string | number> = {}
): SessionEventTemplates {
  return buildEventTemplates(locale, d, {
    title: "Session Completed",
    titleAr: "اكتملت الجلسة",
    emailSubject: `Training session completed — {{courseTitle}} ({{sessionRef}})`,
    emailSubjectAr: `اكتملت جلسة تدريبية — {{courseTitle}} ({{sessionRef}})`,
    heading: "Training Session Completed",
    headingAr: "اكتملت الجلسة التدريبية",
    intro: "The training session has been completed.",
    introAr: "اكتملت الجلسة التدريبية.",
    waHeader: "*Training Session Completed*",
    waHeaderAr: "*اكتملت الجلسة التدريبية*",
    waLines: [
      `Course: {{courseTitle}}`,
      `Date: {{dateLabel}}`,
      `Period: {{period}}`,
      `Time: {{startTime}} – {{endTime}}`,
      `Location: {{location}}`,
      `Session Ref: {{sessionRef}}`,
    ],
    waLinesAr: [
      `الدورة: {{courseTitle}}`,
      `التاريخ: {{dateLabel}}`,
      `الفترة: {{period}}`,
      `الوقت: {{startTime}} – {{endTime}}`,
      `الموقع: {{location}}`,
      `رقم الجلسة: {{sessionRef}}`,
    ],
    sms: `Session completed: {{courseTitle}} ({{sessionRef}}).`,
    smsAr: `اكتملت الجلسة: {{courseTitle}} ({{sessionRef}}).`,
    inApp: `Training session {{courseTitle}} ({{sessionRef}}) has been COMPLETED.`,
    inAppAr: `اكتملت جلسة التدريب {{courseTitle}} ({{sessionRef}}).`,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// RESULTS_FINALIZED
// ─────────────────────────────────────────────────────────────────────────────

export function buildResultsFinalizedTemplates(
  locale: NotificationLocale,
  d: SessionTemplateData,
  extra: Record<string, string | number> = {}
): SessionEventTemplates {
  return buildEventTemplates(locale, d, {
    title: "Results Finalized",
    titleAr: "تم اعتماد النتائج",
    emailSubject: `Results finalized — {{courseTitle}} ({{sessionRef}})`,
    emailSubjectAr: `تم اعتماد النتائج — {{courseTitle}} ({{sessionRef}})`,
    heading: "Results Finalized",
    headingAr: "تم اعتماد النتائج",
    intro: "The final results for the training session are finalized. {{certificatesCount}} certificate(s) have been issued.",
    introAr: "تم اعتماد النتائج النهائية لجلسة التدريب. تم إصدار {{certificatesCount}} شهادة.",
    waHeader: "*Results Finalized*",
    waHeaderAr: "*تم اعتماد النتائج*",
    waLines: [
      `Course: {{courseTitle}}`,
      `Date: {{dateLabel}}`,
      `Period: {{period}}`,
      `Time: {{startTime}} – {{endTime}}`,
      `Location: {{location}}`,
      `Certificates: {{certificatesCount}}`,
      `Session Ref: {{sessionRef}}`,
    ],
    waLinesAr: [
      `الدورة: {{courseTitle}}`,
      `التاريخ: {{dateLabel}}`,
      `الفترة: {{period}}`,
      `الوقت: {{startTime}} – {{endTime}}`,
      `الموقع: {{location}}`,
      `الشهادات: {{certificatesCount}}`,
      `رقم الجلسة: {{sessionRef}}`,
    ],
    sms: `Results finalized for {{courseTitle}} ({{sessionRef}}) — {{certificatesCount}} certificate(s) issued.`,
    smsAr: `تم اعتماد النتائج لجلسة {{courseTitle}} ({{sessionRef}}) — تم إصدار {{certificatesCount}} شهادة.`,
    inApp: `Results for training session {{courseTitle}} ({{sessionRef}}) are finalized — {{certificatesCount}} certificate(s) issued.`,
    inAppAr: `تم اعتماد نتائج جلسة التدريب {{courseTitle}} ({{sessionRef}}) — تم إصدار {{certificatesCount}} شهادة.`,
    extraVars: extra,
  });
}
