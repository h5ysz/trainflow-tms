// /api/claims/[id]/generate — (re)generate items from the trainer's sessions.
// Coordinator-only: trainers may view/edit their own items, never re-derive them.
import { withRole, ok, audit } from "@/lib/auth/api";
import { generateClaimItems, loadClaim, serializeClaim } from "@/lib/claims/service";

export const POST = withRole(["SUPER_ADMIN", "COORDINATOR"], async ({ params, user, req }) => {
  const id = params.id as string;
  const claim = await generateClaimItems(id, { id: user.id, fullName: user.fullName });

  await audit({
    user,
    action: "CREATE",
    entity: "CLAIM",
    entityId: id,
    entityRef: claim.refNumber,
    description: `Generated items for claim ${claim.refNumber}`,
    descriptionAr: `تم توليد بنود المطالبة ${claim.refNumber}`,
    req,
  });

  return ok(serializeClaim(claim));
});
