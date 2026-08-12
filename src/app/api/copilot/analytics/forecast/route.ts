// /api/copilot/analytics/forecast — predictive forecasts
import { withModuleAction, ok } from "@/lib/auth/api";
import { computeForecast } from "@/lib/ai/analytics/forecasting";
import type { AnalyticsScope } from "@/lib/ai/analytics/types";

export const GET = withModuleAction("ai-dashboard", "view", async ({ user }) => {
  const scope: AnalyticsScope = {
    role: user.role,
    userId: user.id,
    companyId: user.companyId ?? null,
    canSeeFinancial: user.role === "SUPER_ADMIN" || user.role === "COORDINATOR" || user.role === "AUDITOR",
    canSeeOperational: user.role !== "CONTRACTOR",
  };
  const forecast = await computeForecast(scope);
  return ok(forecast);
});
