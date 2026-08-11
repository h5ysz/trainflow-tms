// /api/notifications/session-reminder-tick — 24h session reminder job
// =====================================================================
// Called by the existing external cron (same SCHEDULER_SECRET bearer used by
// /api/report-scheduler/tick and /api/certificates/expiry-tick). Recommended
// cadence: every 5–15 minutes. It scans SCHEDULED sessions starting within the
// 24h reminder window and dispatches Email/WhatsApp/SMS reminders to the
// contractor of each enrolled company.
//
// Re-running is safe: NotificationLog's unique (type, referenceId, companyId,
// channel) key means each channel is sent at most once per company.
import { ok, fail } from "@/lib/auth/api";
import { timingSafeEqual } from "crypto";
import { processSessionReminders } from "@/lib/notifications/session-reminder";

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const expectedToken = process.env.SCHEDULER_SECRET;
  if (!expectedToken) {
    return fail("Scheduler is not configured", 503, "SCHEDULER_NOT_CONFIGURED");
  }
  const authHeader = req.headers.get("authorization") ?? "";
  if (!tokenMatches(authHeader, `Bearer ${expectedToken}`)) {
    return fail("Unauthorized — invalid scheduler token", 401);
  }

  try {
    const result = await processSessionReminders();
    return ok({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (e: unknown) {
    return fail(`Session reminder tick failed: ${(e as Error).message}`, 500, "SESSION_REMINDER_TICK_ERROR");
  }
}

export async function GET(req: Request) { return POST(req); }
