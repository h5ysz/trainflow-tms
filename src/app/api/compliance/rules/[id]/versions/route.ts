// /api/compliance/rules/[id]/versions — list version history for a rule
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, notFound } from "@/lib/auth/api";

export const GET = withErrorEnvelope(async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireRole("SUPER_ADMIN", "COORDINATOR");
  const { id } = await ctx.params;

  const rule = await db.complianceRule.findUnique({ where: { id } });
  if (!rule || rule.deletedAt) return notFound("Compliance rule not found");

  const versions = await db.complianceRuleVersion.findMany({
    where: { ruleId: id },
    orderBy: { version: "desc" },
  });

  return ok(versions);
});
