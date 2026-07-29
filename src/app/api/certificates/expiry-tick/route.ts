// /api/certificates/expiry-tick — daily expiry notification scheduler
// =====================================================================
// Sprint 6: Called once per day by an external cron job (or Vercel cron).
// Scans all active certificates and sends expiry notifications at
// 180/90/60/30/15/7/1 days before expiry, plus on the expiry date itself.
//
// Recipients per notification:
//   - Trainee (if they have a user account)
//   - Company Coordinator (all CONTRACTOR users on the trainee's company)
//   - GCCLAB Coordinators (all COORDINATOR users)
//   - Administrators (all SUPER_ADMIN users)
//
// Auth: Bearer token via SCHEDULER_SECRET env var (same as report-scheduler/tick)
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
    console.error("[Expiry Tick] SCHEDULER_SECRET is not configured");
    return fail("Scheduler is not configured", 503, "SCHEDULER_NOT_CONFIGURED");
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!tokenMatches(authHeader, `Bearer ${expectedToken}`)) {
    return fail("Unauthorized — invalid scheduler token", 401);
  }

  try {
    const result = await processExpiryNotifications();
    console.log(
      `[Expiry Tick] Scanned: ${result.scanned}, Notified: ${result.notified}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`
    );
    return ok({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (e: unknown) {
    console.error("[Expiry Tick Error]", e);
    return fail(`Expiry tick failed: ${(e as Error).message}`, 500, "EXPIRY_TICK_ERROR");
  }
}

// GET support for simple cron triggers (e.g. Render cron, UptimeRobot)
export async function GET(req: Request) {
  return POST(req);
}
