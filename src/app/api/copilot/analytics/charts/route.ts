// /api/copilot/analytics/charts — chart datasets for the AI dashboard
import { withModuleAction, ok, fail } from "@/lib/auth/api";
import { computeCharts } from "@/lib/ai/analytics/charts";
import { rangeFromPreset, type RangePreset, type AnalyticsScope } from "@/lib/ai/analytics/types";

export const GET = withModuleAction("copilot", "view", async ({ req, user }) => {
  const url = new URL(req.url);
  const rangeParam = (url.searchParams.get("range") ?? "12m") as RangePreset;
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
  const charts = await computeCharts(scope, range);
  return ok(charts);
});
