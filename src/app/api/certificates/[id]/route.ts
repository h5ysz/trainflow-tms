// /api/certificates/[id] — get / update (revoke) / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const GET = withModuleAction("certificates", "view", async ({ params, user }) => {
  const id = params.id as string;
  const cert = await db.certificate.findUnique({
    where: { id },
    include: {
      session: {
        include: {
          course: true,
          trainer: { select: { nameEn: true, refNumber: true } },
        },
      },
      course: true,
      company: true,
    },
  });
  if (!cert || cert.deletedAt) return notFound("Certificate not found");

  if (user.role === "CONTRACTOR" && user.companyId && cert.companyId !== user.companyId) {
    return fail("Forbidden", 403);
  }

  return ok(cert);
});

export const PUT = withModuleAction("certificates", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.certificate.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Certificate not found");

  const { status, validUntil, pdfUrl, qrCodeUrl } = body;

  const updated = await db.certificate.update({
    where: { id },
    data: {
      ...(status !== undefined && { status }),
      ...(validUntil !== undefined && { validUntil: new Date(validUntil) }),
      ...(pdfUrl !== undefined && { pdfUrl }),
      ...(qrCodeUrl !== undefined && { qrCodeUrl }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: status === "REVOKED" ? "REVOKE" : "UPDATE",
    entity: "CERTIFICATE",
    entityId: id,
    entityRef: existing.refNumber,
    description: status === "REVOKED"
      ? `Revoked certificate ${existing.refNumber}`
      : `Updated certificate ${existing.refNumber}`,
    descriptionAr: status === "REVOKED"
      ? `تم إلغاء شهادة ${existing.refNumber}`
      : `تم تحديث شهادة ${existing.refNumber}`,
    req,
  });

  return ok(updated);
});

export const DELETE = withModuleAction("certificates", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.certificate.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Certificate not found");

  await db.certificate.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "CERTIFICATE",
    entityId: id,
    entityRef: existing.refNumber,
    description: `Deleted certificate ${existing.refNumber}`,
    descriptionAr: `تم حذف شهادة ${existing.refNumber}`,
    req,
  });

  return ok({ success: true });
});
