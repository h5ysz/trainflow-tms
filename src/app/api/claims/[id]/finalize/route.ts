// /api/claims/[id]/finalize — coordinator finalizes an approved claim.
import { withRole, ok, audit } from "@/lib/auth/api";
import { finalizeClaim, loadClaim } from "@/lib/claims/service";

export const POST = withRole(["SUPER_ADMIN", "COORDINATOR"], async ({ params, user, req }) => {
  const id = params.id as string;
  const updated = await finalizeClaim(id, { id: user.id, fullName: user.fullName }, { req });

  await audit({
    user,
    action: "STATUS_CHANGE",
    entity: "CLAIM",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Finalized claim ${updated.refNumber}`,
    descriptionAr: `تمت المتابعة النهائية للمطالبة ${updated.refNumber}`,
    req,
  });

  const claim = await loadClaim(id);
  return ok(claim);
});
