// /api/claims/[id]/toggle-item — include/exclude a claim item from export.
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { toggleClaimItemIncluded, serializeClaim } from "@/lib/claims/service";

export const POST = withModuleAction("claims", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const itemId = typeof body.itemId === "string" ? body.itemId : "";
  if (!itemId) return fail("itemId is required", 422, "VALIDATION_ERROR");

  const updated = await toggleClaimItemIncluded(id, itemId, { id: user.id, fullName: user.fullName, trainerId: user.trainerId ?? null });

  await audit({
    user,
    action: "UPDATE",
    entity: "CLAIM",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Toggled item inclusion on claim ${updated.refNumber}`,
    descriptionAr: `تم تبديل تضمين بند في المطالبة ${updated.refNumber}`,
    req,
  });

  return ok(serializeClaim(updated));
});
