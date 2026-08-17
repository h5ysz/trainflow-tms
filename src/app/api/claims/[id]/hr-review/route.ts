import { withRole, ok, fail, audit } from "@/lib/auth/api";
import { hrReview, loadClaim } from "@/lib/claims/service";

export const POST = withRole(["SUPER_ADMIN", "COORDINATOR"], async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));

  const decision = typeof body.decision === "string" ? body.decision : "";
  if (!decision) return fail("Decision is required (APPROVED | APPROVED_WITH_CONDITIONS | NOT_APPROVED)", 422, "VALIDATION_ERROR");

  const maxApprovedOt = typeof body.maxApprovedOt === "number" ? body.maxApprovedOt : undefined;
  const periodFrom = typeof body.periodFrom === "string" ? body.periodFrom : undefined;
  const periodTo = typeof body.periodTo === "string" ? body.periodTo : undefined;
  const comments = typeof body.comments === "string" ? body.comments : undefined;

  const updated = await hrReview(id, { decision, maxApprovedOt, periodFrom, periodTo, comments }, { id: user.id, fullName: user.fullName }, { req });

  await audit({
    user,
    action: "UPDATE",
    entity: "CLAIM",
    entityId: id,
    entityRef: updated.refNumber,
    description: `HR review on claim ${updated.refNumber}: ${decision}`,
    descriptionAr: `مراجعة الموارد البشرية للمطالبة ${updated.refNumber}: ${decision}`,
    req,
  });

  const claim = await loadClaim(id);
  return ok(claim);
});
