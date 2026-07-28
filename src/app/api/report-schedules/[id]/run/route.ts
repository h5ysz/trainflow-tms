// /api/report-schedules/[id]/run — manual "Run Now" trigger
import { db } from "@/lib/db";
import { requireModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { executeReportSchedule } from "@/lib/reports/execution-engine";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireModuleAction("report-schedules", "edit"); } catch { return fail("Forbidden", 403); }
  const { id } = await ctx.params;

  const schedule = await db.reportSchedule.findUnique({ where: { id } });
  if (!schedule || schedule.deletedAt) return fail("Schedule not found", 404);
  if (!schedule.isActive) return fail("Schedule is not active", 400);

  try {
    const result = await executeReportSchedule({
      scheduleId: id,
      triggerType: "MANUAL",
      triggeredBy: user.id,
    });

    return ok(result);
  } catch (e: any) {
    return fail(`Execution failed: ${e.message}`, 500, "EXECUTION_FAILED", { error: e.message });
  }
}
