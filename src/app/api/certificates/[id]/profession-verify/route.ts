// /api/certificates/[id]/profession-verify — coordinator confirms profession verification
// =====================================================================
// POST: marks the certificate's profession as verified (or un-verifies).
// Only COORDINATOR + SUPER_ADMIN can call this.
//
// Body: {
//   verified: boolean,           // true = mark verified, false = un-verify
//   notes?: string,              // optional notes
//   attachmentUrl?: string,      // optional URL to updated Iqama document
// }
import { db } from "@/lib/db";
import { withAuth, ok, fail, notFound, audit } from "@/lib/auth/api";
import { canPerformAction } from "@/lib/auth/permissions";

export const POST = withAuth(async ({ req, params, user }) => {
  const id = params.id as string;

  // Only coordinators + super admins can verify profession
  if (user.role !== "COORDINATOR" && user.role !== "SUPER_ADMIN") {
    return fail("Only coordinators can verify profession", 403, "FORBIDDEN");
  }
  if (!canPerformAction(user.permissions, "certificates", "edit")) {
    return fail("You do not have permission to edit certificates", 403, "FORBIDDEN");
  }

  const body = await req.json().catch(() => ({}));
  const { verified, notes, attachmentUrl } = body as {
    verified?: boolean;
    notes?: string;
    attachmentUrl?: string;
  };

  if (typeof verified !== "boolean") {
    return fail("verified (boolean) is required", 422, "VALIDATION_ERROR");
  }

  const cert = await db.certificate.findUnique({
    where: { id },
    select: { id: true, refNumber: true, traineeName: true, companyId: true, courseId: true, sessionId: true, professionVerified: true, deletedAt: true, course: { select: { title: true } } },
  });
  if (!cert || cert.deletedAt) return notFound("Certificate not found");

  const now = new Date();
  const updated = await db.certificate.update({
    where: { id },
    data: {
      professionVerified: verified,
      professionVerifiedAt: verified ? now : null,
      professionVerifiedBy: verified ? user.id : null,
      professionVerificationNotes: notes ?? null,
      professionVerificationAttachmentUrl: attachmentUrl ?? null,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "CERTIFICATE",
    entityId: cert.id,
    entityRef: cert.refNumber,
    description: `${verified ? "Verified" : "Un-verified"} profession for ${cert.traineeName} (${cert.refNumber})`,
    descriptionAr: `${verified ? "تم التحقق من" : "إلغاء التحقق من"} مهنة ${cert.traineeName} (${cert.refNumber})`,
    req,
    metadata: {
      aiGenerated: false,
      professionVerification: true,
      verified,
      oldValue: { professionVerified: cert.professionVerified },
      newValue: { professionVerified: verified, verifiedAt: verified ? now : null, verifiedBy: verified ? user.id : null },
    },
  });

  return ok({
    id: updated.id,
    professionVerified: updated.professionVerified,
    professionVerifiedAt: updated.professionVerifiedAt,
    professionVerifiedBy: updated.professionVerifiedBy,
    professionVerificationNotes: updated.professionVerificationNotes,
  });
});
