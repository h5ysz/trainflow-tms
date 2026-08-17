import { withRole, ok, fail, audit } from "@/lib/auth/api";
import { lineManagerReview, loadClaim } from "@/lib/claims/service";

export const POST = withRole(["SUPER_ADMIN", "COORDINATOR"], async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));

  const decision = typeof body.decision === "string" ? body.decision : "";
  if (!decision) return fail("Decision is required (APPROVED | APPROVED_WITH_CONDITIONS | NOT_APPROVED)", 422, "VALIDATION_ERROR");

  const comments = typeof body.comments === "string" ? body.comments : undefined;
  const checklist = typeof body.checklist === "string" ? body.checklist : undefined;

  const updated = await lineManagerReview(id, { decision, comments, checklist }, { id: user.id, fullName: user.fullName }, { req });

  await audit({
    user,
    action: "UPDATE",
    entity: "CLAIM",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Line Manager review on claim ${updated.refNumber}: ${decision}`,
    descriptionAr: `مراجعة مدير الخط للمطالبة ${updated.refNumber}: ${decision}`,
    req,
  });

  const claim = await loadClaim(id);
  return ok(claim);
});
