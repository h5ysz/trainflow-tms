// /api/report-executions/[id]/retry — manually retry a failed execution
import { db } from "@/lib/db";
import { requireRole, ok, fail } from "@/lib/auth/api";
import { retryExecution } from "@/lib/reports/execution-engine";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireRole("SUPER_ADMIN", "COORDINATOR"); } catch { return fail("Forbidden", 403); }
  const { id } = await ctx.params;

  const execution = await db.reportExecution.findUnique({ where: { id } });
  if (!execution) return fail("Execution not found", 404);
  if (execution.status !== "FAILED") return fail("Only failed executions can be retried", 400);
  if (execution.attemptNumber >= execution.maxRetries) {
    return fail(`Max retries (${execution.maxRetries}) already reached`, 400, "MAX_RETRIES_REACHED");
  }

  try {
    await retryExecution(id);
    return ok({ success: true, message: "Retry initiated" });
  } catch (e: any) {
    return fail(`Retry failed: ${e.message}`, 500, "RETRY_FAILED");
  }
}
