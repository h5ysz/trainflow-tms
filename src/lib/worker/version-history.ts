// Compliance Rule Version History service.
// Sprint 6: immutable audit trail for every compliance rule change.
import { db } from "@/lib/db";

interface RuleSnapshot {
  id: string;
  courseId: string;
  isMandatory: boolean;
  isCoreMandatory: boolean;
  validityMonths: number;
  scopeType: string;
  scopeValue: string | null;
  scopeLabel: string | null;
  isActive: boolean;
}

/**
 * Record a version snapshot of a compliance rule.
 * Never deletes — full history is preserved forever.
 */
export async function recordComplianceRuleVersion(
  rule: RuleSnapshot,
  changeType: "CREATE" | "UPDATE" | "ACTIVATE" | "DEACTIVATE",
  changedBy: string,
  previousValues: RuleSnapshot | null,
  reason?: string | null
): Promise<void> {
  // Count existing versions for this rule to determine the version number
  const versionCount = await db.complianceRuleVersion.count({
    where: { ruleId: rule.id },
  });

  await db.complianceRuleVersion.create({
    data: {
      ruleId: rule.id,
      version: versionCount + 1,
      courseId: rule.courseId,
      isMandatory: rule.isMandatory,
      isCoreMandatory: rule.isCoreMandatory,
      validityMonths: rule.validityMonths,
      scopeType: rule.scopeType,
      scopeValue: rule.scopeValue,
      scopeLabel: rule.scopeLabel,
      isActive: rule.isActive,
      changedBy,
      changeType,
      reason: reason ?? null,
      previousValues: previousValues ? JSON.stringify({
        courseId: previousValues.courseId,
        isMandatory: previousValues.isMandatory,
        isCoreMandatory: previousValues.isCoreMandatory,
        validityMonths: previousValues.validityMonths,
        scopeType: previousValues.scopeType,
        scopeValue: previousValues.scopeValue,
        scopeLabel: previousValues.scopeLabel,
        isActive: previousValues.isActive,
      }) : null,
    },
  });
}

/**
 * Get the full version history for a rule.
 */
export async function getRuleVersionHistory(ruleId: string) {
  return db.complianceRuleVersion.findMany({
    where: { ruleId },
    orderBy: { version: "desc" },
  });
}
