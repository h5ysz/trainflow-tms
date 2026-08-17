// /api/claims/[id]/approve — coordinator approves a submitted claim.
import { withRole, ok, audit } from "@/lib/auth/api";
import { approveClaim, loadClaim } from "@/lib/claims/service";

export const POST = withRole(["SUPER_ADMIN", "COORDINATOR"], async ({ params, user, req }) => {
  const id = params.id as string;
  const updated = await approveClaim(id, { id: user.id, fullName: user.fullName, role: user.role }, { req });

  await audit({
    user,
    action: "APPROVE",
    entity: "CLAIM",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Approved claim ${updated.refNumber}`,
    descriptionAr: `تمت الموافقة على المطالبة ${updated.refNumber}`,
    req,
  });

  const claim = await loadClaim(id);
  return ok(claim);
});
