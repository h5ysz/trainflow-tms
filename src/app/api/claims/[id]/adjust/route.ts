// /api/claims/[id]/adjust — trainer adjusts one item (reason required).
import { withModuleAction, ok, audit } from "@/lib/auth/api";
import { adjustClaimItem, loadClaim, serializeClaim } from "@/lib/claims/service";

export const POST = withModuleAction("claims", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const updated = await adjustClaimItem(
    id,
    { itemId: body.itemId, value: Number(body.value), reason: typeof body.reason === "string" ? body.reason : "" },
    { id: user.id, fullName: user.fullName, trainerId: user.trainerId ?? null },
  );

  await audit({
    user,
    action: "UPDATE",
    entity: "CLAIM",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Adjusted item on claim ${updated.refNumber}`,
    descriptionAr: `تم تعديل بند في المطالبة ${updated.refNumber}`,
    req,
  });

  return ok(serializeClaim(updated));
});
