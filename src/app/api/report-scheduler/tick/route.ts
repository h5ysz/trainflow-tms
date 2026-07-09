// /api/report-scheduler/tick — scheduler tick endpoint
// Should be called every 5-10 minutes by an external cron or Vercel cron job.
// In production, this would be protected by a secret token.
import { schedulerTick } from "@/lib/reports/execution-engine";
import { ok, fail } from "@/lib/auth/api";
import { timingSafeEqual } from "crypto";

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request) {
  const expectedToken = process.env.SCHEDULER_SECRET;
  if (!expectedToken) {
    console.error("[Scheduler Tick] SCHEDULER_SECRET is not configured");
    return fail("Scheduler is not configured", 503, "SCHEDULER_NOT_CONFIGURED");
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (!tokenMatches(authHeader, `Bearer ${expectedToken}`)) {
    return fail("Unauthorized — invalid scheduler token", 401);
  }

  try {
    await schedulerTick();
    return ok({ success: true, message: "Scheduler tick completed", timestamp: new Date().toISOString() });
  } catch (e: any) {
    console.error("[Scheduler Tick Error]", e);
    return fail(`Scheduler tick failed: ${e.message}`, 500, "SCHEDULER_ERROR");
  }
}

// Also support GET for simple cron triggers
export async function GET(req: Request) {
  return POST(req);
}
