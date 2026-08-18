// /api/copilot/analytics/recommendations — AI-generated recommendations
import { withModuleAction, ok } from "@/lib/auth/api";
import { computeRecommendations } from "@/lib/ai/analytics/recommendations";
import { rangeFromPreset, type RangePreset, type AnalyticsScope } from "@/lib/ai/analytics/types";

export const GET = withModuleAction("copilot", "view", async ({ req, user }) => {
  const url = new URL(req.url);
  const rangeParam = (url.searchParams.get("range") ?? "30d") as RangePreset;
  const scope: AnalyticsScope = {
    role: user.role,
    userId: user.id,
    companyId: user.companyId ?? null,
    canSeeFinancial: user.role === "SUPER_ADMIN" || user.role === "COORDINATOR" || user.role === "AUDITOR",
    canSeeOperational: user.role !== "CONTRACTOR",
  };
  const range = rangeFromPreset(rangeParam);
  const recommendations = await computeRecommendations(scope, range);
  return ok(recommendations);
});
