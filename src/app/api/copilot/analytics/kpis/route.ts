// /api/copilot/analytics/kpis — KPI cards for the AI dashboard
// =====================================================================
// Query: ?range=30d|90d|ytd|12m|all (default 30d)
// Returns: KpiResult
import { withModuleAction, ok, fail } from "@/lib/auth/api";
import { computeKpis } from "@/lib/ai/analytics/kpis";
import { rangeFromPreset, type RangePreset, type AnalyticsScope } from "@/lib/ai/analytics/types";

export const GET = withModuleAction("copilot", "view", async ({ req, user }) => {
  const url = new URL(req.url);
  const rangeParam = (url.searchParams.get("range") ?? "30d") as RangePreset;
  const validRanges: RangePreset[] = ["7d", "30d", "90d", "ytd", "12m", "all"];
  if (!validRanges.includes(rangeParam)) {
    return fail(`Invalid range. Must be one of: ${validRanges.join(", ")}`, 422, "VALIDATION_ERROR");
  }

  const scope: AnalyticsScope = {
    role: user.role,
    userId: user.id,
    companyId: user.companyId ?? null,
    canSeeFinancial: user.role === "SUPER_ADMIN" || user.role === "COORDINATOR" || user.role === "AUDITOR",
    canSeeOperational: user.role !== "CONTRACTOR",
  };

  const range = rangeFromPreset(rangeParam);
  const kpis = await computeKpis(scope, range);
  return ok(kpis);
});
