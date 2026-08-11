// GCCLAB TMS — Shared session data for notification templates
// =====================================================================
// One place that turns a TrainingSession row into the localized template data
// (course title, date, derived period, times, location, trainer, ref) used by
// BOTH the 24h reminder and the SESSION_SCHEDULE_UPDATED notification, plus the
// per-company recipient resolution.
//
// Contractor scoping: every value a contractor sees is computed from the
// SessionEnrollment → Trainee → Company relation for THAT company only. A
// session with Contractor A (5 trainees) and Contractor B (8 trainees) shows A
// exactly "5" and B exactly "8" — never the session total, and never each
// other's data.

import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { DEFAULT_TIMEZONE } from "@/lib/reports/scheduler";
import {
  sessionPeriodFromTime,
  formatTime,
  type NotificationLocale,
  type SessionPeriod,
} from "./types";
import { formatSessionDate, trainerFallback } from "./templates/session-reminder";
import type { NotificationRecipient } from "./service";

/** The slice of a TrainingSession (with course + trainer) the templates need. */
export interface SessionSnapshot {
  id: string;
  refNumber: string;
  title: string;
  location: string | null;
  venue: string | null;
  city: string | null;
  startDate: Date;
  endDate: Date;
  course: { title: string; titleAr: string | null } | null;
  trainer: { nameEn: string; nameAr: string | null } | null;
}

export interface SessionTemplateData {
  courseTitle: string; // localized course title
  dateLabel: string;   // localized session date
  period: SessionPeriod;
  startTime: string;
  endTime: string;
  location: string;
  trainerName: string; // resolved, with the "not assigned" fallback
  traineeCount: number;
  sessionRef: string;
}

/** The human-visible training location (location ?? venue, + city suffix). */
export function displayLocation(snapshot: Pick<SessionSnapshot, "location" | "venue" | "city">): string {
  const venue = snapshot.location ?? snapshot.venue;
  const city = snapshot.city ?? null;
  return venue
    ? city
      ? `${venue} – ${city}`
      : venue
    : city
      ? city
      : "";
}

/** Localized trainer name, or the "not assigned" fallback. */
export function sessionTrainerName(
  trainer: { nameEn: string; nameAr: string | null } | null,
  locale: NotificationLocale
): string {
  if (!trainer) return trainerFallback(locale);
  return locale === "ar" ? (trainer.nameAr ?? trainer.nameEn) : trainer.nameEn;
}

/**
 * Build the localized template data for a session and a single company's trainee
 * count. The period is DERIVED from the session start time (unified rule in
 * types.ts) — never typed by a coordinator.
 */
export function buildSessionTemplateData(
  session: SessionSnapshot,
  traineeCount: number,
  locale: NotificationLocale
): SessionTemplateData {
  const isAr = locale === "ar";
  return {
    courseTitle: isAr
      ? (session.course?.titleAr ?? session.course?.title ?? session.title)
      : (session.course?.title ?? session.title),
    dateLabel: formatSessionDate(session.startDate, locale),
    period: sessionPeriodFromTime(session.startDate, DEFAULT_TIMEZONE),
    startTime: formatTime(session.startDate, locale),
    endTime: formatTime(session.endDate, locale),
    location: displayLocation(session) || (isAr ? "مركز التدريب" : "Training center"),
    trainerName: sessionTrainerName(session.trainer, locale),
    traineeCount,
    sessionRef: session.refNumber,
  };
}

/**
 * The per-company trainee count, computed from the ACTUAL enrollment relation:
 * SessionEnrollment → Trainee → Company. Never falls back to the session total,
 * so a contractor only ever sees their own trainees' count. Matches the
 * `recomputeSessionCounts` definition of "active" (not soft-deleted, not CANCELLED).
 */
export async function getCompanyTraineeCount(sessionId: string, companyId: string): Promise<number> {
  return db.sessionEnrollment.count({
    where: {
      sessionId,
      companyId,
      deletedAt: null,
      enrollmentStatus: { not: "CANCELLED" },
    },
  });
}

/**
 * Resolve the recipients for one company in a session:
 *   1. Contractor users of THAT company (role CONTRACTOR, active).
 *   2. Fallback: the request's linked contact — only for the requesting company,
 *      only when the company has no contractor users.
 * Contractors of other companies are never included, so no cross-company data leaks.
 */
export async function resolveCompanyRecipients(
  session: {
    request: {
      companyId: string | null;
      contact: {
        fullName: string;
        fullNameAr: string | null;
        email: string | null;
        mobile: string | null;
        phone: string | null;
      } | null;
    } | null;
  },
  companyId: string,
  companyName: string
): Promise<NotificationRecipient[]> {
  const contractorUsers = await db.user.findMany({
    where: { role: "CONTRACTOR", companyId, isActive: true, deletedAt: null },
    select: { id: true, fullName: true, email: true, phone: true, language: true },
  });

  const recipients: NotificationRecipient[] = contractorUsers.map((u) => ({
    name: u.fullName,
    email: u.email,
    phone: u.phone,
    language: (u.language === "ar" ? "ar" : "en") as NotificationLocale,
    userId: u.id,
  }));

  if (recipients.length === 0 && session.request?.companyId === companyId && session.request.contact) {
    const c = session.request.contact;
    const email = c.email;
    const phone = c.mobile ?? c.phone ?? null;
    if (email || phone) {
      recipients.push({
        name: c.fullNameAr ?? c.fullName,
        email,
        phone,
        language: "en",
      });
    }
  }

  // A company with no contacts still yields an explicit FAILED ledger row.
  return recipients.length > 0 ? recipients : [anonymousRecipient(companyName)];
}

/** A placeholder recipient so a company with no contacts produces FAILED ledger rows. */
export function anonymousRecipient(companyName: string): NotificationRecipient {
  return { name: companyName, email: null, phone: null, language: "en" };
}

/**
 * Create an in-app Notification unless one with the same dedupe key already
 * exists. The key rides in the message (same convention as the expiry
 * notifications) so a re-run cron / double-submit cannot duplicate inbox items.
 */
export async function createInAppNotificationIfAbsent(
  userId: string,
  n: { title: string; titleAr: string; message: string; messageAr: string; link: string; key: string }
): Promise<boolean> {
  const existing = await db.notification.findFirst({
    where: { userId, message: { contains: `[${n.key}]` } },
    select: { id: true },
  });
  if (existing) return false;

  await db.notification.create({
    data: {
      id: randomUUID(),
      userId,
      title: n.title,
      titleAr: n.titleAr,
      message: n.message,
      messageAr: n.messageAr,
      type: "INFO",
      category: "SESSION",
      link: n.link,
      updatedAt: new Date(),
    },
  });
  return true;
}
