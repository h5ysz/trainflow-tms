// /api/certificates/[id]/reject — coordinator rejects a pending certificate
// =====================================================================
// Sprint 6: Certificate approval workflow.
//
// Flow: PENDING_APPROVAL → REVOKED (with reason)
//
// Permissions: SUPER_ADMIN or COORDINATOR
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, fail, notFound, audit } from "@/lib/auth/api";

export const POST = withErrorEnvelope(async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SUPER_ADMIN", "COORDINATOR");
  const { id } = await ctx.params;

  const cert = await db.certificate.findUnique({
    where: { id },
    include: { course: true },
  });
  if (!cert || cert.deletedAt) return notFound("Certificate not found");

  // State machine: only PENDING_APPROVAL can be rejected
  if (cert.status !== "PENDING_APPROVAL") {
    return fail(
      `Certificate cannot be rejected from status: ${cert.status}. Only PENDING_APPROVAL certificates can be rejected.`,
      400,
      "INVALID_TRANSITION",
      { currentStatus: cert.status }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { reason } = body as { reason?: string };

  const updated = await db.certificate.update({
    where: { id },
    data: {
      status: "REVOKED",
      rejectionReason: reason ?? null,
      revokedAt: new Date(),
      revokedBy: user.id,
      revokedReason: reason ?? "Rejected by coordinator",
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "REJECT",
    entity: "CERTIFICATE",
    entityId: id,
    entityRef: cert.refNumber,
    description: `Rejected certificate ${cert.refNumber} for ${cert.traineeName}${reason ? ` — ${reason}` : ""}`,
    descriptionAr: `رفض شهادة ${cert.refNumber} لـ ${cert.traineeName}${reason ? ` — ${reason}` : ""}`,
    req,
    metadata: {
      refNumber: cert.refNumber,
      traineeName: cert.traineeName,
      reason,
      courseCode: cert.course?.code,
    },
  });

  return ok({
    id: updated.id,
    refNumber: updated.refNumber,
    status: updated.status,
    rejectionReason: updated.rejectionReason,
    revokedAt: updated.revokedAt,
  });
});
