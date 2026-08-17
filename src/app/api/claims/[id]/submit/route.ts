// /api/claims/[id]/submit — trainer submits their own claim for review.
import { withModuleAction, ok, audit } from "@/lib/auth/api";
import { submitClaim, loadClaim } from "@/lib/claims/service";

export const POST = withModuleAction("claims", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const updated = await submitClaim(id, { id: user.id, fullName: user.fullName, trainerId: user.trainerId ?? null });

  await audit({
    user,
    action: "STATUS_CHANGE",
    entity: "CLAIM",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Submitted claim ${updated.refNumber} for review`,
    descriptionAr: `تم إرسال المطالبة ${updated.refNumber} للمراجعة`,
    req,
  });

  const claim = await loadClaim(id);
  return ok(claim);
});
