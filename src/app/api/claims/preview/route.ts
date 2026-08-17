// /api/claims/preview — read-only preview of the items generation would produce
// Gate: claims.view (coordinators preview any trainer; trainers only themselves).
import { withModuleAction, fail, ok } from "@/lib/auth/api";
import { previewClaimItems } from "@/lib/claims/service";
import { CLAIM_TYPES } from "@/lib/claims/service";

export const GET = withModuleAction("claims", "view", async ({ req, user }) => {
  const url = new URL(req.url);
  const claimType = url.searchParams.get("claimType") ?? "";
  const trainerId = url.searchParams.get("trainerId") ?? "";
  const periodFrom = url.searchParams.get("periodFrom") ?? "";
  const periodTo = url.searchParams.get("periodTo") ?? "";

  if (!CLAIM_TYPES.includes(claimType as never)) {
    return fail("claimType must be OVERTIME or BUSINESS_MISSION", 422, "VALIDATION_ERROR");
  }

  // Trainers may only preview their own sessions.
  const targetTrainerId = user.role === "TRAINER" ? (user.trainerId ?? trainerId) : trainerId;
  if (!targetTrainerId) return fail("trainerId is required", 422, "VALIDATION_ERROR");
  if (!periodFrom || !periodTo) return fail("periodFrom and periodTo are required", 422, "VALIDATION_ERROR");

  const result = await previewClaimItems({
    trainerId: targetTrainerId,
    claimType: claimType as "OVERTIME" | "BUSINESS_MISSION",
    periodFrom,
    periodTo,
    user: { id: user.id },
  });

  return ok(result);
});
