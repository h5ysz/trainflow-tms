// GCCLAB TMS — Session lifecycle event notifications
// =====================================================================
// Event-driven notifications fired at session lifecycle moments:
//   SESSION_SCHEDULED     (session created SCHEDULED)      → trainer + contractors
//   TRAINER_ASSIGNED      (trainer assigned)               → trainer + contractors
//   SESSION_STARTED       (lifecycle STARTED)              → contractors + coordinators
//   ATTENDANCE_FINALIZED  (lifecycle COMPLETED — locked)   → contractors + coordinators
//   SESSION_COMPLETED     (lifecycle COMPLETED)            → contractors + coordinators
//   RESULTS_FINALIZED     (certificates generated)         → contractors + coordinators
//
// Every event reuses the single dispatch layer (./service.ts): each channel is
// logged in NotificationLog and deduped exactly once per
// (type, referenceId, companyId, channel). Re-running a handler is a no-op.
//
// Scoping: contractors are resolved per company from SessionEnrollment →
// Trainee → Company (a contractor only ever sees their own company's data and
// count). Coordinators are resolved as active COORDINATOR users and each gets a
// distinct ledger key, so a coordinator receives exactly one notification per
// session/event — never one per company, never duplicated. The trainer is the
// session's assigned Trainer (Email/WhatsApp/SMS from the Trainer record; in-app
// only when the trainer has a linked user account).
//
// Audiences use distinct referenceId namespaces so their ledger rows never
// collide: contractors key on (sessionId, companyId), the trainer on
// (sessionId:trainer, null), each coordinator on (sessionId:coordinator:userId, null).

import { db } from "@/lib/db";
import {
  dispatchNotification,
  type NotificationRecipient,
} from "./service";
import type { NotificationLocale } from "./types";
import {
  buildSessionTemplateData,
  getCompanyTraineeCount,
  resolveCompanyRecipients,
  createInAppNotificationIfAbsent,
  type SessionSnapshot,
  type SessionTemplateData,
} from "./session-data";
import {
  buildSessionScheduledTemplates,
  buildTrainerAssignedTemplates,
  buildSessionStartedTemplates,
  buildAttendanceFinalizedTemplates,
  buildSessionCompletedTemplates,
  buildResultsFinalizedTemplates,
  sessionEventChannels,
  type SessionEventTemplates,
} from "./templates/session-events";

export const SESSION_SCHEDULED_TYPE = "SESSION_SCHEDULED";
export const TRAINER_ASSIGNED_TYPE = "TRAINER_ASSIGNED";
export const SESSION_STARTED_TYPE = "SESSION_STARTED";
export const ATTENDANCE_FINALIZED_TYPE = "ATTENDANCE_FINALIZED";
export const SESSION_COMPLETED_TYPE = "SESSION_COMPLETED";
export const RESULTS_FINALIZED_TYPE = "RESULTS_FINALIZED";

/** The slice of a session the event dispatchers need. */
interface EventSession extends SessionSnapshot {
  status: string;
  deletedAt: Date | null;
  trainer: {
    id: string;
    nameEn: string;
    nameAr: string | null;
    email: string | null;
    phone: string | null;
    mobile: string | null;
    user: { id: string; language: string | null } | null;
  } | null;
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
  sessionCompanies: Array<{
    companyId: string;
    traineeCount: number;
    company: { name: string; nameAr: string | null };
  }>;
}

export interface SessionEventResult {
  type: string;
  sessionRef: string;
  companies: number;
  trainers: number;
  coordinators: number;
  sent: number;
  failed: number;
  skipped: number;
  inAppNotifications: number;
}

/** Session total trainee count (used for trainer/coordinator messages). */
function sessionTotalCount(session: EventSession): number {
  return session.sessionCompanies.reduce((n, sc) => n + (sc.traineeCount ?? 0), 0);
}

async function loadEventSession(sessionId: string): Promise<EventSession | null> {
  return db.trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      course: { select: { title: true, titleAr: true } },
      trainer: {
        select: {
          id: true,
          nameEn: true,
          nameAr: true,
          email: true,
          phone: true,
          mobile: true,
          user: { select: { id: true, language: true } },
        },
      },
      request: {
        select: {
          companyId: true,
          contact: { select: { fullName: true, fullNameAr: true, email: true, mobile: true, phone: true } },
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
  }) as unknown as EventSession | null;
}

/** The assigned trainer as a notification recipient (null when no contact data). */
function buildTrainerRecipient(
  trainer: EventSession["trainer"]
): NotificationRecipient | null {
  if (!trainer) return null;
  const email = trainer.email;
  const phone = trainer.mobile ?? trainer.phone ?? null;
  if (!email && !phone) return null;
  return {
    name: trainer.nameAr ?? trainer.nameEn,
    email,
    phone,
    language: (trainer.user?.language === "ar" ? "ar" : "en") as NotificationLocale,
    userId: trainer.user?.id ?? null,
  };
}

/** Active GCCLAB coordinators — each notified individually, exactly once. */
async function resolveCoordinatorRecipients(): Promise<NotificationRecipient[]> {
  const users = await db.user.findMany({
    where: { role: "COORDINATOR", isActive: true, deletedAt: null },
    select: { id: true, fullName: true, email: true, phone: true, language: true },
  });
  return users.map((u) => ({
    name: u.fullName,
    email: u.email,
    phone: u.phone,
    language: (u.language === "ar" ? "ar" : "en") as NotificationLocale,
    userId: u.id,
  }));
}

type TemplatesBuilder = (
  locale: NotificationLocale,
  data: SessionTemplateData,
  extra: Record<string, string | number>
) => SessionEventTemplates;

interface NotifyEventOptions {
  session: EventSession;
  type: string;
  slug: string;
  audiences: Array<"trainer" | "contractors" | "coordinators">;
  buildTemplates: TemplatesBuilder;
  extra?: Record<string, string | number>;
}

function inAppPayload(
  t: SessionEventTemplates,
  key: string,
  sessionRef: string
): { title: string; titleAr: string; message: string; messageAr: string; link: string; key: string } {
  return {
    title: t.inApp.title,
    titleAr: t.inApp.titleAr,
    message: `${t.inApp.message} [${key}]`,
    messageAr: `${t.inApp.messageAr} [${key}]`,
    link: `/sessions/${sessionRef}`,
    key,
  };
}

async function notifySessionEvent(opts: NotifyEventOptions): Promise<SessionEventResult> {
  const { session, type, slug, audiences, buildTemplates, extra = {} } = opts;
  const result: SessionEventResult = {
    type,
    sessionRef: session.refNumber,
    companies: 0,
    trainers: 0,
    coordinators: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    inAppNotifications: 0,
  };

  // ── Contractors: one dispatch + in-app item per enrolled company ──
  if (audiences.includes("contractors")) {
    for (const sc of session.sessionCompanies) {
      result.companies++;
      const company = sc.company;
      const recipients = await resolveCompanyRecipients(session, sc.companyId, company.name);
      const companyTraineeCount = await getCompanyTraineeCount(session.id, sc.companyId);

      const dispatch = await dispatchNotification({
        type,
        referenceType: "SESSION",
        referenceId: session.id,
        sessionId: session.id,
        companyId: sc.companyId,
        scheduledAt: session.startDate,
        recipients,
        buildContent: (recipient) => {
          const data = buildSessionTemplateData(session, companyTraineeCount, recipient.language);
          return sessionEventChannels(buildTemplates(recipient.language, data, extra), recipient);
        },
      });

      result.sent += dispatch.sent;
      result.failed += dispatch.failed;
      result.skipped += dispatch.skipped;

      const key = `${slug}-${session.id}-${sc.companyId}`;
      const inApp = inAppPayload(buildTemplates("en", buildSessionTemplateData(session, companyTraineeCount, "en"), extra), key, session.refNumber);
      for (const r of recipients) {
        if (!r.userId) continue;
        if (await createInAppNotificationIfAbsent(r.userId, inApp)) result.inAppNotifications++;
      }
    }
  }

  // ── Trainer: the session's assigned trainer, single recipient ──
  if (audiences.includes("trainer")) {
    const trainerRecipient = buildTrainerRecipient(session.trainer);
    if (trainerRecipient) {
      result.trainers++;
      const total = sessionTotalCount(session);
      const dispatch = await dispatchNotification({
        type,
        referenceType: "SESSION",
        referenceId: `${session.id}:trainer`,
        sessionId: session.id,
        companyId: null,
        scheduledAt: session.startDate,
        recipients: [trainerRecipient],
        buildContent: (recipient) => {
          const data = buildSessionTemplateData(session, total, recipient.language);
          return sessionEventChannels(buildTemplates(recipient.language, data, extra), recipient);
        },
      });

      result.sent += dispatch.sent;
      result.failed += dispatch.failed;
      result.skipped += dispatch.skipped;

      if (trainerRecipient.userId) {
        const key = `${slug}-${session.id}-trainer`;
        const inApp = inAppPayload(buildTemplates("en", buildSessionTemplateData(session, total, "en"), extra), key, session.refNumber);
        if (await createInAppNotificationIfAbsent(trainerRecipient.userId, inApp)) result.inAppNotifications++;
      }
    }
  }

  // ── Coordinators: each coordinator gets a distinct ledger key (no duplicates) ──
  if (audiences.includes("coordinators")) {
    const coordinators = await resolveCoordinatorRecipients();
    for (const coordinator of coordinators) {
      result.coordinators++;
      const total = sessionTotalCount(session);
      const dispatch = await dispatchNotification({
        type,
        referenceType: "SESSION",
        referenceId: `${session.id}:coordinator:${coordinator.userId ?? "anon"}`,
        sessionId: session.id,
        companyId: null,
        scheduledAt: session.startDate,
        recipients: [coordinator],
        buildContent: (recipient) => {
          const data = buildSessionTemplateData(session, total, recipient.language);
          return sessionEventChannels(buildTemplates(recipient.language, data, extra), recipient);
        },
      });

      result.sent += dispatch.sent;
      result.failed += dispatch.failed;
      result.skipped += dispatch.skipped;

      if (coordinator.userId) {
        const key = `${slug}-${session.id}-coordinator-${coordinator.userId}`;
        const inApp = inAppPayload(buildTemplates("en", buildSessionTemplateData(session, total, "en"), extra), key, session.refNumber);
        if (await createInAppNotificationIfAbsent(coordinator.userId, inApp)) result.inAppNotifications++;
      }
    }
  }

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Event handlers — each guards on the session state, dispatches, and is safe to
// re-run (NotificationLog dedupe makes the second run a no-op).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SESSION_SCHEDULED — a session was created with status SCHEDULED.
 * Recipients: the assigned trainer (when present) + each enrolled company's
 * contractor. Set `notifyTrainer: false` when the trainer is already told by a
 * request-level notification (bulk generate-sessions path).
 */
export async function notifySessionScheduled(
  sessionId: string,
  opts: { notifyTrainer?: boolean } = {}
): Promise<SessionEventResult | null> {
  const session = await loadEventSession(sessionId);
  if (!session || session.deletedAt || session.status !== "SCHEDULED") return null;
  return notifySessionEvent({
    session,
    type: SESSION_SCHEDULED_TYPE,
    slug: "scheduled",
    audiences: opts.notifyTrainer === false ? ["contractors"] : ["trainer", "contractors"],
    buildTemplates: buildSessionScheduledTemplates,
  });
}

/**
 * TRAINER_ASSIGNED — a trainer was assigned to a scheduled session.
 * Recipients: the trainer + contractors. When a trainer CHANGES (was already
 * assigned), the contractors learn the change via SESSION_SCHEDULE_UPDATED, so
 * pass `notifyContractors: false` to tell only the new trainer and avoid
 * duplicate contractor messages.
 */
export async function notifyTrainerAssigned(
  sessionId: string,
  opts: { notifyContractors?: boolean } = {}
): Promise<SessionEventResult | null> {
  const session = await loadEventSession(sessionId);
  if (!session || session.deletedAt || session.status !== "SCHEDULED") return null;
  return notifySessionEvent({
    session,
    type: TRAINER_ASSIGNED_TYPE,
    slug: "trainer-assigned",
    audiences: opts.notifyContractors === false ? ["trainer"] : ["trainer", "contractors"],
    buildTemplates: buildTrainerAssignedTemplates,
  });
}

/** SESSION_STARTED — fired on the lifecycle STARTED event (actual start). */
export async function notifySessionStarted(sessionId: string): Promise<SessionEventResult | null> {
  const session = await loadEventSession(sessionId);
  if (!session || session.deletedAt || session.status !== "IN_PROGRESS") return null;
  return notifySessionEvent({
    session,
    type: SESSION_STARTED_TYPE,
    slug: "session-started",
    audiences: ["contractors", "coordinators"],
    buildTemplates: buildSessionStartedTemplates,
  });
}

/** ATTENDANCE_FINALIZED — fired on lifecycle COMPLETED (attendance locked). */
export async function notifyAttendanceFinalized(sessionId: string): Promise<SessionEventResult | null> {
  const session = await loadEventSession(sessionId);
  if (!session || session.deletedAt || session.status !== "COMPLETED") return null;
  return notifySessionEvent({
    session,
    type: ATTENDANCE_FINALIZED_TYPE,
    slug: "attendance-finalized",
    audiences: ["contractors", "coordinators"],
    buildTemplates: buildAttendanceFinalizedTemplates,
  });
}

/** SESSION_COMPLETED — fired on lifecycle COMPLETED (session status COMPLETED). */
export async function notifySessionCompleted(sessionId: string): Promise<SessionEventResult | null> {
  const session = await loadEventSession(sessionId);
  if (!session || session.deletedAt || session.status !== "COMPLETED") return null;
  return notifySessionEvent({
    session,
    type: SESSION_COMPLETED_TYPE,
    slug: "session-completed",
    audiences: ["contractors", "coordinators"],
    buildTemplates: buildSessionCompletedTemplates,
  });
}

/**
 * RESULTS_FINALIZED — fired when the coordinator generates certificates for the
 * session (the moment final results are confirmed). `certificatesCount` is the
 * number of certificates issued in that run.
 */
export async function notifyResultsFinalized(
  sessionId: string,
  opts: { certificatesCount: number }
): Promise<SessionEventResult | null> {
  const session = await loadEventSession(sessionId);
  if (!session || session.deletedAt || session.status !== "COMPLETED") return null;
  return notifySessionEvent({
    session,
    type: RESULTS_FINALIZED_TYPE,
    slug: "results-finalized",
    audiences: ["contractors", "coordinators"],
    buildTemplates: buildResultsFinalizedTemplates,
    extra: { certificatesCount: opts.certificatesCount },
  });
}
