import { withRole, ok, fail, audit } from "@/lib/auth/api";
import { qhseReview, loadClaim } from "@/lib/claims/service";

export const POST = withRole(["SUPER_ADMIN", "COORDINATOR"], async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));

  const assessment = typeof body.assessment === "string" ? body.assessment : "";
  if (!assessment) return fail("Assessment is required (ACCEPTABLE | ACCEPTABLE_WITH_CONTROLS | FURTHER_ASSESSMENT | NOT_RECOMMENDED)", 422, "VALIDATION_ERROR");

  const controls = typeof body.controls === "string" ? body.controls : undefined;

  const updated = await qhseReview(id, { assessment, controls }, { id: user.id, fullName: user.fullName }, { req });

  await audit({
    user,
    action: "UPDATE",
    entity: "CLAIM",
    entityId: id,
    entityRef: updated.refNumber,
    description: `QHSE review on claim ${updated.refNumber}: ${assessment}`,
    descriptionAr: `مراجعة السلامة للمطالبة ${updated.refNumber}: ${assessment}`,
    req,
  });

  const claim = await loadClaim(id);
  return ok(claim);
});
