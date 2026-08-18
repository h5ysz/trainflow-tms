// /api/copilot/analytics/query — natural language analytics query
// =====================================================================
// POST { question: string } → NlQueryResult (table/chart/kpi/text)
import { withModuleAction, ok, fail } from "@/lib/auth/api";
import { answerNlQuery } from "@/lib/ai/analytics/nl-query";
import type { AnalyticsScope } from "@/lib/ai/analytics/types";
import { audit } from "@/lib/auth/api";

export const POST = withModuleAction("copilot", "view", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { question } = body as { question?: string };
  if (!question || typeof question !== "string") {
    return fail("question is required", 422, "VALIDATION_ERROR");
  }
  if (question.length > 500) {
    return fail("question must be 500 characters or fewer", 422, "VALIDATION_ERROR");
  }

  const scope: AnalyticsScope = {
    role: user.role,
    userId: user.id,
    companyId: user.companyId ?? null,
    canSeeFinancial: user.role === "SUPER_ADMIN" || user.role === "COORDINATOR" || user.role === "AUDITOR",
    canSeeOperational: user.role !== "CONTRACTOR",
  };

  const result = await answerNlQuery(question, scope);

  // Audit the query (read-only, but valuable for understanding usage patterns)
  await audit({
    user,
    action: "EXPORT",
    entity: "USER",
    description: `AI analytics NL query: "${question.slice(0, 100)}" → ${result.kind}`,
    descriptionAr: `استعلام تحليلي بالذكاء الاصطناعي: "${question.slice(0, 100)}" → ${result.kind}`,
    req,
    metadata: {
      aiGenerated: true,
      copilotAction: "ANALYTICS_NL_QUERY",
      question: question.slice(0, 200),
      resultKind: result.kind,
      intent: result.intent,
    },
  });

  return ok(result);
});
