// /api/claims/[id]/reject — coordinator rejects a submitted claim permanently.
import { withRole, ok, fail, audit } from "@/lib/auth/api";
import { rejectClaim, loadClaim } from "@/lib/claims/service";

export const POST = withRole(["SUPER_ADMIN", "COORDINATOR"], async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason : "";
  if (!reason.trim()) return fail("A rejection reason is required", 422, "VALIDATION_ERROR");

  const updated = await rejectClaim(id, { id: user.id, fullName: user.fullName, role: user.role }, reason, { req });

  await audit({
    user,
    action: "REJECT",
    entity: "CLAIM",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Rejected claim ${updated.refNumber}: ${reason.trim()}`,
    descriptionAr: `رفض المطالبة ${updated.refNumber}: ${reason.trim()}`,
    req,
    reason: reason.trim(),
  });

  const claim = await loadClaim(id);
  return ok(claim);
});
