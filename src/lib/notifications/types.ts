// GCCLAB TMS — Notification Service: shared types, channels and constants
// =====================================================================
// Single notification layer for outbound communications (Email / WhatsApp / SMS).
// Channel providers are pluggable (see ./providers.ts) so a provider can be swapped
// without rebuilding the system. Notification "types" are extensible strings —
// SESSION_REMINDER_24H today, future types (SESSION_RESCHEDULED, SESSION_CANCELLED,
// SESSION_TRAINER_CHANGED, SESSION_REMINDER_2H, …) plug into the same service.

import { zonedParts, DEFAULT_TIMEZONE } from "@/lib/reports/scheduler";

/** Delivery channels supported by the service. */
export type NotificationChannel = "EMAIL" | "WHATSAPP" | "SMS";

export const NOTIFICATION_CHANNELS: NotificationChannel[] = ["EMAIL", "WHATSAPP", "SMS"];

/** Delivery outcome for a single channel attempt. */
export type DeliveryStatus = "PENDING" | "SENT" | "FAILED";

/** A single channel result — statuses are independent per channel. */
export interface ChannelResult {
  channel: NotificationChannel;
  status: DeliveryStatus;
  messageId?: string;
  error?: string;
  sentAt?: Date;
  /** True when the channel was already recorded SENT and not re-dispatched. */
  deduplicated?: boolean;
}

/** A pluggable channel adapter. Swapping a vendor = swapping this adapter. */
export interface ChannelProvider {
  readonly channel: NotificationChannel;
  send(opts: { to: string; subject?: string; body: string }): Promise<ChannelResult>;
}

/** Locales supported by the notification templates. */
export type NotificationLocale = "en" | "ar";

// ─────────────────────────────────────────────────────────────────────────────
// SESSION PERIOD — derived from the session start time, never typed by hand.
// A session starting before MORNING_CUTOFF_HOUR is a morning session; at/after it
// is an evening session. Stored on the session as a single definition here so the
// reminder templates, the cron and any future consumer agree on the same rule.
// ─────────────────────────────────────────────────────────────────────────────
export const SESSION_PERIOD = {
  /** Sessions starting before this hour (exclusive) are "morning". */
  MORNING_CUTOFF_HOUR: 12,
} as const;

export type SessionPeriod = "MORNING" | "EVENING";

/**
 * Derive the session period from its start time, interpreted in the session's
 * timezone (project default Asia/Riyadh — sessions do not store a timezone).
 */
export function sessionPeriodFromTime(
  startDate: Date,
  timezone: string = DEFAULT_TIMEZONE
): SessionPeriod {
  const { hour } = zonedParts(startDate, timezone);
  return hour < SESSION_PERIOD.MORNING_CUTOFF_HOUR ? "MORNING" : "EVENING";
}

/** Localized label for a session period. */
export function periodLabel(period: SessionPeriod, locale: NotificationLocale): string {
  if (locale === "ar") return period === "MORNING" ? "صباحية" : "مسائية";
  return period === "MORNING" ? "Morning" : "Evening";
}

/** Format an absolute instant in the project timezone, localized. */
export function formatZoned(date: Date, locale: NotificationLocale, timezone = DEFAULT_TIMEZONE, opts: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory" : "en-GB", {
    timeZone: timezone,
    ...opts,
  }).format(date);
}

/** Format a time-of-day (hours + minutes) in the project timezone. */
export function formatTime(date: Date, locale: NotificationLocale, timezone = DEFAULT_TIMEZONE): string {
  return formatZoned(
    date,
    locale,
    timezone,
    locale === "ar"
      ? { hour: "2-digit", minute: "2-digit", hour12: true }
      : { hour: "numeric", minute: "2-digit", hour12: true }
  );
}
