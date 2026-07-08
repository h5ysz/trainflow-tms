// /api/report-scheduler/tick — scheduler tick endpoint
// Should be called every 5-10 minutes by an external cron or Vercel cron job.
// In production, this would be protected by a secret token.
import { schedulerTick } from "@/lib/reports/execution-engine";
import { ok, fail } from "@/lib/auth/api";

export async function POST(req: Request) {
  // In production, verify a secret token from the Authorization header
  // For now, require authentication
  const authHeader = req.headers.get("authorization");
  const expectedToken = process.env.SCHEDULER_SECRET || "trainflow-scheduler-secret";

  if (authHeader !== `Bearer ${expectedToken}`) {
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
