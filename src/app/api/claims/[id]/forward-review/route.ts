import { withRole, ok, audit } from "@/lib/auth/api";
import { startManagerReview, loadClaim } from "@/lib/claims/service";

export const POST = withRole(["SUPER_ADMIN", "COORDINATOR"], async ({ req, params, user }) => {
  const id = params.id as string;

  const updated = await startManagerReview(id, { id: user.id, fullName: user.fullName }, { req });

  await audit({
    user,
    action: "UPDATE",
    entity: "CLAIM",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Forwarded claim ${updated.refNumber} to Line Manager review`,
    descriptionAr: `تم توجيه المطالبة ${updated.refNumber} لمراجعة مدير الخط`,
    req,
  });

  const claim = await loadClaim(id);
  return ok(claim);
});
