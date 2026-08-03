// /api/certificates/[id]/mark-downloaded — mark certificate as downloaded by contractor
// =====================================================================
// POST: transitions releaseStatus from RELEASED → DOWNLOADED.
// Called by the contractor portal when they download or print the PDF.
// Can only be called if the certificate is already RELEASED.
import { db } from "@/lib/db";
import { withAuth, ok, fail, notFound, audit } from "@/lib/auth/api";

export const POST = withAuth(async ({ req, params, user }) => {
  const id = params.id as string;
  const cert = await db.certificate.findUnique({
    where: { id },
    select: { id: true, refNumber: true, releaseStatus: true, companyId: true, traineeName: true, deletedAt: true },
  });
  if (!cert || cert.deletedAt) return notFound("Certificate not found");

  // Contractor can only mark their own company's certificates
  if (user.role === "CONTRACTOR") {
    if (!user.companyId || cert.companyId !== user.companyId) {
      return fail("Forbidden", 403, "FORBIDDEN");
    }
    if (cert.releaseStatus !== "RELEASED" && cert.releaseStatus !== "DOWNLOADED") {
      return fail("Certificate has not been released for download", 403, "NOT_RELEASED");
    }
  } else {
    // Coordinator/admin can mark any certificate
    if (cert.releaseStatus !== "RELEASED" && cert.releaseStatus !== "DOWNLOADED") {
      return fail("Certificate is not in RELEASED status", 400, "INVALID_STATUS");
    }
  }

  if (cert.releaseStatus === "DOWNLOADED") {
    return ok({ id: cert.id, releaseStatus: "DOWNLOADED", alreadyDownloaded: true });
  }

  const now = new Date();
  const updated = await db.certificate.update({
    where: { id },
    data: {
      releaseStatus: "DOWNLOADED",
      downloadedAt: now,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "CERTIFICATE",
    entityId: cert.id,
    entityRef: cert.refNumber,
    description: `Certificate ${cert.refNumber} downloaded by ${user.fullName}`,
    descriptionAr: `تم تنزيل الشهادة ${cert.refNumber} بواسطة ${user.fullName}`,
    req,
    metadata: {
      aiGenerated: false,
      certificateDownloaded: true,
      oldValue: { releaseStatus: cert.releaseStatus },
      newValue: { releaseStatus: "DOWNLOADED", downloadedAt: now },
    },
  });

  return ok({ id: updated.id, releaseStatus: updated.releaseStatus, downloadedAt: updated.downloadedAt });
});
