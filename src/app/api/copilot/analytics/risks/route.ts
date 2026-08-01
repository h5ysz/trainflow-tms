// /api/copilot/analytics/risks — risk detection
import { withAuth, ok } from "@/lib/auth/api";
import { computeRisks } from "@/lib/ai/analytics/risks";
import type { AnalyticsScope } from "@/lib/ai/analytics/types";

export const GET = withAuth(async ({ user }) => {
  const scope: AnalyticsScope = {
    role: user.role,
    userId: user.id,
    companyId: user.companyId ?? null,
    canSeeFinancial: user.role === "SUPER_ADMIN" || user.role === "COORDINATOR" || user.role === "AUDITOR",
    canSeeOperational: user.role !== "CONTRACTOR",
  };
  const risks = await computeRisks(scope);
  return ok(risks);
});
