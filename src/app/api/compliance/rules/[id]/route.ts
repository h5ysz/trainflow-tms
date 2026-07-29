// /api/compliance/rules/[id] — update + delete a compliance rule
// PUT    — update rule (SUPER_ADMIN only)
// DELETE — soft-delete rule (SUPER_ADMIN only; core mandatory rules cannot be deleted)
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, fail, notFound, audit } from "@/lib/auth/api";
import { recordComplianceRuleVersion } from "@/lib/worker/version-history";

export const PUT = withErrorEnvelope(async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SUPER_ADMIN");
  const { id } = await ctx.params;

  const existing = await db.complianceRule.findUnique({
    where: { id },
    include: { course: { select: { code: true, title: true, validityMonths: true } } },
  });
  if (!existing || existing.deletedAt) return notFound("Compliance rule not found");

  const body = await req.json().catch(() => ({}));
  const { isMandatory, isCoreMandatory, validityMonths, scopeType, scopeValue, scopeLabel, isActive, reason } = body as {
    isMandatory?: boolean;
    isCoreMandatory?: boolean;
    validityMonths?: number;
    scopeType?: string;
    scopeValue?: string;
    scopeLabel?: string;
    isActive?: boolean;
    reason?: string;
  };

  // Only SUPER_ADMIN can modify core mandatory rules
  if (existing.isCoreMandatory && user.role !== "SUPER_ADMIN") {
    return fail("Only SUPER_ADMIN can modify core mandatory rules", 403, "FORBIDDEN");
  }

  // Only SUPER_ADMIN can set isCoreMandatory=true
  if (isCoreMandatory === true && !existing.isCoreMandatory && user.role !== "SUPER_ADMIN") {
    return fail("Only SUPER_ADMIN can create core mandatory rules", 403, "FORBIDDEN");
  }

  // Validate scopeType if provided
  if (scopeType !== undefined) {
    const VALID_SCOPES = ["ALL", "COMPANY", "JOB_TITLE", "PROJECT", "CLIENT"];
    if (!VALID_SCOPES.includes(scopeType)) {
      return fail(`scopeType must be one of: ${VALID_SCOPES.join(", ")}`, 422, "VALIDATION_ERROR");
    }
  }

  // Snapshot the previous values for version history
  const previousSnapshot = {
    id: existing.id,
    courseId: existing.courseId,
    isMandatory: existing.isMandatory,
    isCoreMandatory: existing.isCoreMandatory,
    validityMonths: existing.validityMonths,
    scopeType: existing.scopeType,
    scopeValue: existing.scopeValue,
    scopeLabel: existing.scopeLabel,
    isActive: existing.isActive,
  };

  const updated = await db.complianceRule.update({
    where: { id },
    data: {
      ...(isMandatory !== undefined && { isMandatory }),
      ...(isCoreMandatory !== undefined && { isCoreMandatory }),
      ...(validityMonths !== undefined && { validityMonths }),
      ...(scopeType !== undefined && { scopeType }),
      ...(scopeValue !== undefined && { scopeValue: scopeValue || null }),
      ...(scopeLabel !== undefined && { scopeLabel: scopeLabel || null }),
      ...(isActive !== undefined && { isActive }),
      updatedBy: user.id,
    },
    include: { course: { select: { id: true, code: true, title: true, validityMonths: true } } },
  });

  // Determine change type
  let changeType: "UPDATE" | "ACTIVATE" | "DEACTIVATE" = "UPDATE";
  if (isActive === true && !existing.isActive) changeType = "ACTIVATE";
  if (isActive === false && existing.isActive) changeType = "DEACTIVATE";

  // Record version history
  await recordComplianceRuleVersion(
    {
      id: updated.id,
      courseId: updated.courseId,
      isMandatory: updated.isMandatory,
      isCoreMandatory: updated.isCoreMandatory,
      validityMonths: updated.validityMonths,
      scopeType: updated.scopeType,
      scopeValue: updated.scopeValue,
      scopeLabel: updated.scopeLabel,
      isActive: updated.isActive,
    },
    changeType,
    user.id,
    previousSnapshot,
    reason
  );

  await audit({
    user,
    action: "UPDATE",
    entity: "COURSE",
    entityId: existing.courseId,
    description: `Updated compliance rule for ${updated.course.title} (${updated.course.code}) — ${changeType}`,
    descriptionAr: `تحديث قاعدة امتثال لـ ${updated.course.title} (${updated.course.code}) — ${changeType}`,
    req,
    metadata: {
      ruleId: id,
      changeType,
      reason,
      previous: previousSnapshot,
      after: { isMandatory: updated.isMandatory, isActive: updated.isActive, validityMonths: updated.validityMonths },
    },
  });

  return ok(updated);
});

export const DELETE = withErrorEnvelope(async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SUPER_ADMIN");
  const { id } = await ctx.params;

  const existing = await db.complianceRule.findUnique({
    where: { id },
    include: { course: { select: { code: true, title: true } } },
  });
  if (!existing || existing.deletedAt) return notFound("Compliance rule not found");

  // Core mandatory rules cannot be deleted — only deactivated
  if (existing.isCoreMandatory) {
    return fail(
      "Core mandatory rules (OHS, Fire Safety, First Aid) cannot be deleted. Deactivate them instead.",
      400,
      "CORE_MANDATORY_CANNOT_DELETE"
    );
  }

  await db.complianceRule.update({
    where: { id },
    data: { deletedAt: new Date(), isActive: false, updatedBy: user.id },
  });

  // Record version history (deactivation via delete)
  await recordComplianceRuleVersion(
    {
      id: existing.id,
      courseId: existing.courseId,
      isMandatory: existing.isMandatory,
      isCoreMandatory: existing.isCoreMandatory,
      validityMonths: existing.validityMonths,
      scopeType: existing.scopeType,
      scopeValue: existing.scopeValue,
      scopeLabel: existing.scopeLabel,
      isActive: false,
    },
    "DEACTIVATE",
    user.id,
    {
      id: existing.id,
      courseId: existing.courseId,
      isMandatory: existing.isMandatory,
      isCoreMandatory: existing.isCoreMandatory,
      validityMonths: existing.validityMonths,
      scopeType: existing.scopeType,
      scopeValue: existing.scopeValue,
      scopeLabel: existing.scopeLabel,
      isActive: existing.isActive,
    },
    "Rule deleted"
  );

  await audit({
    user,
    action: "DELETE",
    entity: "COURSE",
    entityId: existing.courseId,
    description: `Deleted compliance rule for ${existing.course.title} (${existing.course.code})`,
    descriptionAr: `حذف قاعدة امتثال لـ ${existing.course.title} (${existing.course.code})`,
    req,
    metadata: { ruleId: id },
  });

  return ok({ success: true });
});
