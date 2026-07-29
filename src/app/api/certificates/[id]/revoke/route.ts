// /api/certificates/[id]/revoke — Super Admin revokes an issued certificate
// =====================================================================
// Sprint 6: Certificate revocation (separate from rejection).
//
// Flow: APPROVED | ISSUED | VALID → REVOKED (with reason)
//
// Permissions: SUPER_ADMIN only (most destructive action)
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, fail, notFound, audit } from "@/lib/auth/api";

export const POST = withErrorEnvelope(async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SUPER_ADMIN");
  const { id } = await ctx.params;

  const cert = await db.certificate.findUnique({
    where: { id },
    include: { course: true },
  });
  if (!cert || cert.deletedAt) return notFound("Certificate not found");

  // State machine: can revoke from APPROVED, ISSUED, or VALID (legacy)
  const REVOCABLE_STATUSES = ["APPROVED", "ISSUED", "VALID"];
  if (!REVOCABLE_STATUSES.includes(cert.status)) {
    return fail(
      `Certificate cannot be revoked from status: ${cert.status}. Only ${REVOCABLE_STATUSES.join(", ")} certificates can be revoked.`,
      400,
      "INVALID_TRANSITION",
      { currentStatus: cert.status }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { reason } = body as { reason?: string };

  if (!reason) {
    return fail("reason is required when revoking a certificate", 422, "VALIDATION_ERROR");
  }

  const updated = await db.certificate.update({
    where: { id },
    data: {
      status: "REVOKED",
      revokedAt: new Date(),
      revokedBy: user.id,
      revokedReason: reason,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "REVOKE",
    entity: "CERTIFICATE",
    entityId: id,
    entityRef: cert.refNumber,
    description: `Revoked certificate ${cert.refNumber} for ${cert.traineeName} — ${reason}`,
    descriptionAr: `إلغاء شهادة ${cert.refNumber} لـ ${cert.traineeName} — ${reason}`,
    req,
    metadata: {
      refNumber: cert.refNumber,
      traineeName: cert.traineeName,
      reason,
      previousStatus: cert.status,
      courseCode: cert.course?.code,
    },
  });

  return ok({
    id: updated.id,
    refNumber: updated.refNumber,
    status: updated.status,
    revokedAt: updated.revokedAt,
    revokedBy: updated.revokedBy,
    revokedReason: updated.revokedReason,
  });
});
