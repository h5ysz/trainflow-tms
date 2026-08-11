// GCCLAB TMS — Notification Service (single dispatch layer)
// =====================================================================
// The one place that sends outbound messages across Email / WhatsApp / SMS and
// records every attempt in the NotificationLog ledger.
//
// Guarantees:
//   • Exactly-once per (type, referenceId, companyId, channel): the NotificationLog
//     unique constraint + SENT-skip make a re-run cron tick a no-op.
//   • Channel independence: a failed WhatsApp never blocks Email or SMS — each
//     channel is dispatched, logged and reported separately.
//   • Honesty: a channel reports SENT only when the provider accepted the message.
//   • Extensibility: a new notification type (reschedule, cancellation, 2h reminder…)
//     only supplies a different `type`, reference and content builder.

import { db } from "@/lib/db";
import { randomUUID } from "node:crypto";
import { getChannelProviders } from "./providers";
import type {
  NotificationChannel,
  NotificationLocale,
  ChannelResult,
} from "./types";

export interface NotificationRecipient {
  /** Display name (company contact / user) for the ledger. */
  name?: string | null;
  /** Email address for the EMAIL channel. */
  email?: string | null;
  /** Phone for the WHATSAPP / SMS channels. */
  phone?: string | null;
  /** Template locale for this recipient. */
  language: NotificationLocale;
  /** Target user id when an in-app Notification should also be created. */
  userId?: string | null;
}

/** Per-channel content for one recipient, in the recipient's locale. */
export interface ChannelContent {
  channel: NotificationChannel;
  subject?: string;
  body: string;
}

export interface NotificationDispatchInput {
  type: string;
  referenceType: string;
  referenceId: string;
  companyId?: string | null;
  /**
   * Explicit session id for the ledger. Defaults to `referenceId` when
   * `referenceType` is SESSION — override it when `referenceId` is composite
   * (e.g. SESSION_SCHEDULE_UPDATED keys which encode a change hash).
   */
  sessionId?: string | null;
  /** When the reminded event starts — logged as `scheduledAt`. */
  scheduledAt?: Date | null;
  /**
   * Instance-aware dedupe for reminders. When true, a SENT ledger row whose
   * `scheduledAt` differs from this dispatch's is treated as a *previous
   * reminder instance* (the session was rescheduled) and re-dispatched for the
   * new date. Two ticks for the SAME date still dedupe exactly once.
   */
  rescheduleAware?: boolean;
  /** The recipients to notify on behalf of this company/reference. */
  recipients: NotificationRecipient[];
  /**
   * Build per-channel content for a recipient. Returning an empty array skips
   * the recipient entirely (e.g. no contact details available).
   */
  buildContent: (recipient: NotificationRecipient) => ChannelContent[];
}

export interface DispatchSummary {
  /** One result per (recipient, channel) actually attempted or skipped. */
  results: ChannelResult[];
  sent: number;
  failed: number;
  skipped: number;
}

/** The value a channel must reach to count as delivered (and stop re-sends). */
const DELIVERED: "SENT" = "SENT";

/**
 * Dispatch a notification to all recipients across their channels. Dedupes on
 * the NotificationLog unique key — re-invoking with the same (type, referenceId,
 * companyId) never re-sends a channel already recorded SENT.
 */
export async function dispatchNotification(input: NotificationDispatchInput): Promise<DispatchSummary> {
  const providers = getChannelProviders();
  const summary: DispatchSummary = { results: [], sent: 0, failed: 0, skipped: 0 };

  for (const recipient of input.recipients) {
    const contents = input.buildContent(recipient);
    if (contents.length === 0) {
      summary.skipped++;
      continue;
    }

    // Channels within one recipient run in parallel: each writes a *different*
    // unique key (type, referenceId, companyId, channel), so SQLite's single
    // writer serializes them without any cross-channel conflict.
    const results = await Promise.all(
      contents.map((c) =>
        deliverChannel(
          providers[c.channel].send.bind(providers[c.channel]),
          {
            type: input.type,
            referenceType: input.referenceType,
            referenceId: input.referenceId,
            companyId: input.companyId ?? null,
            sessionId: input.sessionId ?? (input.referenceType === "SESSION" ? input.referenceId : null),
            scheduledAt: input.scheduledAt ?? null,
            channel: c.channel,
            recipient,
            content: c,
            rescheduleAware: input.rescheduleAware ?? false,
          }
        )
      )
    );

    for (const r of results) {
      summary.results.push(r);
      if (r.status === "SENT") {
        // A deduplicated hit means the channel was already sent by an earlier
        // run — count it as skipped, never as a fresh send.
        if (r.deduplicated) summary.skipped++;
        else summary.sent++;
      } else if (r.status === "FAILED") summary.failed++;
      else summary.skipped++;
    }
  }

  return summary;
}

interface DeliverContext {
  type: string;
  referenceType: string;
  referenceId: string;
  companyId: string | null;
  sessionId: string | null;
  scheduledAt: Date | null;
  channel: NotificationChannel;
  recipient: NotificationRecipient;
  content: { subject?: string; body: string };
  rescheduleAware: boolean;
}

/**
 * Deliver a single channel for a single recipient and record it in the ledger.
 * Each channel writes its own (type, referenceId, companyId, channel) key, so
 * the unique constraint — not locking — is the duplicate guard.
 */
async function deliverChannel(
  send: (opts: { to: string; subject?: string; body: string }) => Promise<ChannelResult>,
  ctx: DeliverContext
): Promise<ChannelResult> {
  const to = ctx.channel === "EMAIL" ? ctx.recipient.email : ctx.recipient.phone;
  if (!to || !to.trim()) {
    const missing = ctx.channel === "EMAIL" ? "recipient has no email" : "recipient has no phone";
    await recordAttempt(ctx, "FAILED", undefined, missing);
    return { channel: ctx.channel, status: "FAILED", error: missing, sentAt: new Date() };
  }

  // ── Dedupe: find the ledger row for this (type, reference, company, channel). ──
  const existing = await db.notificationLog.findFirst({
    where: {
      type: ctx.type,
      referenceId: ctx.referenceId,
      companyId: ctx.companyId,
      channel: ctx.channel,
    },
  });

  if (existing?.status === DELIVERED) {
    // Same reminder instance = same scheduledAt. A reschedule moves the session
    // to a new scheduledAt, so the row is a *previous* instance — re-dispatch.
    const sameInstance =
      !ctx.rescheduleAware ||
      !existing.scheduledAt ||
      !ctx.scheduledAt ||
      existing.scheduledAt.getTime() === ctx.scheduledAt.getTime();
    if (sameInstance) {
      // Already sent and recorded — a re-run cron must not send again. Reported
      // with `deduplicated` so the summary counts it as skipped, not sent.
      return {
        channel: ctx.channel,
        status: "SENT",
        messageId: existing.messageId ?? undefined,
        sentAt: existing.sentAt ?? undefined,
        deduplicated: true,
      };
    }
  }

  // Mark in-flight (PENDING) before the network call so a crash mid-send leaves a
  // trace; the next tick treats PENDING like FAILED and retries once. When a
  // reschedule reuses a SENT row, `scheduledAt` is rolled forward to the new
  // instance before re-dispatching.
  let logId: string | undefined = existing?.id;
  if (!logId) {
    const created = await db.notificationLog.create({
      data: {
        id: randomUUID(),
        type: ctx.type,
        referenceType: ctx.referenceType,
        referenceId: ctx.referenceId,
        companyId: ctx.companyId,
        sessionId: ctx.sessionId,
        channel: ctx.channel,
        recipientName: ctx.recipient.name ?? null,
        recipientValue: to,
        language: ctx.recipient.language,
        scheduledAt: ctx.scheduledAt,
        status: "PENDING",
      },
    });
    logId = created.id;
  } else {
    await db.notificationLog.update({
      where: { id: logId },
      data: { status: "PENDING", errorMessage: null, scheduledAt: ctx.scheduledAt },
    });
  }

  const result = await send({ to, subject: ctx.content.subject, body: ctx.content.body });

  if (result.status === "SENT") {
    await db.notificationLog.update({
      where: { id: logId },
      data: { status: "SENT", sentAt: result.sentAt ?? new Date(), messageId: result.messageId ?? null, errorMessage: null, updatedAt: new Date() },
    });
    return result;
  }

  await recordAttempt(ctx, "FAILED", logId, result.error ?? "Send failed");
  return { channel: ctx.channel, status: "FAILED", error: result.error ?? "Send failed", sentAt: result.sentAt ?? new Date() };
}

async function recordAttempt(
  ctx: DeliverContext,
  status: "FAILED",
  logId: string | undefined,
  error: string
): Promise<void> {
  const sentAt = new Date();
  if (logId) {
    await db.notificationLog.update({
      where: { id: logId },
      data: { status, errorMessage: error?.slice(0, 500), updatedAt: sentAt },
    });
    return;
  }
  await db.notificationLog.create({
    data: {
      id: randomUUID(),
      type: ctx.type,
      referenceType: ctx.referenceType,
      referenceId: ctx.referenceId,
      companyId: ctx.companyId,
      sessionId: ctx.sessionId,
      channel: ctx.channel,
      recipientName: ctx.recipient.name ?? null,
      recipientValue: null,
      language: ctx.recipient.language,
      scheduledAt: ctx.scheduledAt,
      status,
      errorMessage: error?.slice(0, 500),
    },
  });
}
