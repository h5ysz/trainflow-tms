import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { acknowledgeClaim, loadClaim } from "@/lib/claims/service";

export const POST = withModuleAction("claims", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));

  const accepted = body.accepted === true || body.accepted === "true";
  const requestedBy = typeof body.requestedBy === "string" ? body.requestedBy : undefined;
  const reason = typeof body.reason === "string" ? body.reason : undefined;
  const normalWorkingHours = typeof body.normalWorkingHours === "number" ? body.normalWorkingHours : undefined;
  const estimatedOtPerDay = typeof body.estimatedOtPerDay === "number" ? body.estimatedOtPerDay : undefined;

  const updated = await acknowledgeClaim(
    id,
    { accepted, requestedBy, reason, normalWorkingHours, estimatedOtPerDay },
    { id: user.id, fullName: user.fullName, trainerId: user.trainerId ?? null },
  );

  await audit({
    user,
    action: "UPDATE",
    entity: "CLAIM",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Acknowledgment ${accepted ? "accepted" : "declined"} on claim ${updated.refNumber}`,
    descriptionAr: `تم ${accepted ? "قبول" : "رفض"} الاعتراف على المطالبة ${updated.refNumber}`,
    req,
  });

  const claim = await loadClaim(id);
  return ok(claim);
});
