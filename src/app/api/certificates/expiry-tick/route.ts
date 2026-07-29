// /api/certificates/expiry-tick — daily expiry notification scheduler
// Sprint 6: Called once per day by external cron.
// Sends notifications at 90/60/30/7/1 days before expiry + on expiry.
// Auto-marks expired certs and sends on-expiry notification.
// Auth: Bearer SCHEDULER_SECRET
import { ok, fail } from "@/lib/auth/api";
import { timingSafeEqual } from "crypto";
import { processExpiryNotifications } from "@/lib/certificates/expiry-notifications";

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
    const result = await processExpiryNotifications();
    return ok({ success: true, ...result, timestamp: new Date().toISOString() });
  } catch (e: unknown) {
    return fail(`Expiry tick failed: ${(e as Error).message}`, 500, "EXPIRY_TICK_ERROR");
  }
}

export async function GET(req: Request) { return POST(req); }
