// /api/compliance/rules — list + create compliance rules
// =====================================================================
// Sprint 6: Compliance Matrix — admin-configurable mandatory courses.
//
// GET   — list all rules (SUPER_ADMIN, COORDINATOR)
// POST  — create a new rule (SUPER_ADMIN only)
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, created, fail, audit } from "@/lib/auth/api";
import { recordComplianceRuleVersion } from "@/lib/worker/version-history";

export const GET = withErrorEnvelope(async function GET(req: Request) {
  await requireRole("SUPER_ADMIN", "COORDINATOR");

  const url = new URL(req.url);
  const scopeType = url.searchParams.get("scopeType");
  const courseId = url.searchParams.get("courseId");
  const isActive = url.searchParams.get("isActive");

  const where: Record<string, unknown> = { deletedAt: null };
  if (scopeType) where.scopeType = scopeType;
  if (courseId) where.courseId = courseId;
  if (isActive !== null && isActive !== undefined) where.isActive = isActive === "true";

  const rules = await db.complianceRule.findMany({
    where,
    include: {
      course: { select: { id: true, code: true, title: true, validityMonths: true } },
      _count: { select: { versions: true } },
    },
    orderBy: [{ isCoreMandatory: "desc" }, { scopeType: "asc" }, { createdAt: "desc" }],
  });

  return ok(rules);
});

export const POST = withErrorEnvelope(async function POST(req: Request) {
  const user = await requireRole("SUPER_ADMIN");

  const body = await req.json().catch(() => ({}));
  const { courseId, isMandatory, isCoreMandatory, validityMonths, scopeType, scopeValue, scopeLabel, isActive } = body as {
    courseId?: string;
    isMandatory?: boolean;
    isCoreMandatory?: boolean;
    validityMonths?: number;
    scopeType?: string;
    scopeValue?: string;
    scopeLabel?: string;
    isActive?: boolean;
  };

  if (!courseId) return fail("courseId is required", 422, "VALIDATION_ERROR");

  // Validate course exists
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course || course.deletedAt) return fail("Course not found", 404, "NOT_FOUND");

  // Validate scopeType
  const VALID_SCOPES = ["ALL", "COMPANY", "JOB_TITLE", "PROJECT", "CLIENT"];
  const finalScopeType = scopeType ?? "ALL";
  if (!VALID_SCOPES.includes(finalScopeType)) {
    return fail(`scopeType must be one of: ${VALID_SCOPES.join(", ")}`, 422, "VALIDATION_ERROR");
  }

  // Only SUPER_ADMIN can create core mandatory rules
  const finalIsCoreMandatory = isCoreMandatory ?? false;
  if (finalIsCoreMandatory && user.role !== "SUPER_ADMIN") {
    return fail("Only SUPER_ADMIN can create core mandatory rules", 403, "FORBIDDEN");
  }

  // Check for duplicate (same course + same scope)
  const existing = await db.complianceRule.findFirst({
    where: {
      courseId,
      scopeType: finalScopeType,
      scopeValue: scopeValue ?? null,
      deletedAt: null,
    },
  });
  if (existing) {
    return fail("A compliance rule already exists for this course + scope", 400, "DUPLICATE_RULE");
  }

  const rule = await db.complianceRule.create({
    data: {
      courseId,
      isMandatory: isMandatory ?? true,
      isCoreMandatory: finalIsCoreMandatory,
      validityMonths: validityMonths ?? course.validityMonths,
      scopeType: finalScopeType,
      scopeValue: scopeValue ?? null,
      scopeLabel: scopeLabel ?? null,
      isActive: isActive ?? true,
      createdBy: user.id,
      updatedBy: user.id,
    },
    include: {
      course: { select: { id: true, code: true, title: true, validityMonths: true } },
    },
  });

  // Record version history
  await recordComplianceRuleVersion(rule, "CREATE", user.id, null, "Initial creation");

  await audit({
    user,
    action: "CREATE",
    entity: "COURSE",
    entityId: courseId,
    description: `Created compliance rule: ${course.title} (${course.code}) — scope: ${finalScopeType}${scopeLabel ? ` (${scopeLabel})` : ""}`,
    descriptionAr: `إنشاء قاعدة امتثال: ${course.title} (${course.code}) — النطاق: ${finalScopeType}`,
    req,
    metadata: { ruleId: rule.id, courseId, scopeType: finalScopeType, isCoreMandatory: finalIsCoreMandatory },
  });

  return created(rule);
});
