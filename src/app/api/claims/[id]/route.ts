// /api/claims/[id] — get detail + soft delete
import { withModuleAction, ok, notFound, audit } from "@/lib/auth/api";
import { loadClaim, serializeClaim, softDeleteClaim } from "@/lib/claims/service";

export const GET = withModuleAction("claims", "view", async ({ params, user }) => {
  const id = params.id as string;
  const claim = await loadClaim(id);
  if (!claim || claim.deletedAt) return notFound("Claim not found");

  // Trainers may only open their own claims.
  if (user.role === "TRAINER" && claim.trainerId !== user.trainerId) {
    return notFound("Claim not found");
  }

  return ok(serializeClaim(claim));
});

export const DELETE = withModuleAction("claims", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const updated = await softDeleteClaim(id, { id: user.id, fullName: user.fullName }, { req });

  await audit({
    user,
    action: "DELETE",
    entity: "CLAIM",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Deleted claim ${updated.refNumber}`,
    descriptionAr: `تم حذف المطالبة ${updated.refNumber}`,
    req,
  });

  return ok({ success: true });
});
