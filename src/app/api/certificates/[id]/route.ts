// /api/certificates/[id] — get / update (revoke) / delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, auditLog } from "@/lib/auth/api";

export const GET = withModuleAction("certificates", "view", async ({ params, user }) => {
  const id = params.id as string;
  const cert = await db.certificate.findUnique({
    where: { id },
    include: {
      session: { include: { course: true } },
      course: true,
      company: true,
    },
  });
  if (!cert) return notFound("Certificate not found");

  // Contractors see only their own
  if (user.role === "CONTRACTOR" && user.companyId && cert.companyId !== user.companyId) {
    return fail("Forbidden", 403);
  }

  return ok(cert);
});

export const PUT = withModuleAction("certificates", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.certificate.findUnique({ where: { id } });
  if (!existing) return notFound("Certificate not found");

  const { status, validUntil, pdfUrl, qrCodeUrl } = body;

  const updated = await db.certificate.update({
    where: { id },
    data: {
      ...(status !== undefined && { status }),
      ...(validUntil !== undefined && { validUntil: new Date(validUntil) }),
      ...(pdfUrl !== undefined && { pdfUrl }),
      ...(qrCodeUrl !== undefined && { qrCodeUrl }),
    },
  });

  await auditLog({
    userId: user.id,
    action: status === "REVOKED" ? "REVOKE" : "UPDATE",
    entity: "CERTIFICATE",
    entityId: id,
    description: `${status === "REVOKED" ? "Revoked" : "Updated"} certificate ${existing.certificateNumber}`,
    req,
  });

  return ok(updated);
});

export const DELETE = withModuleAction("certificates", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.certificate.findUnique({ where: { id } });
  if (!existing) return notFound("Certificate not found");

  await db.certificate.delete({ where: { id } });
  await auditLog({
    userId: user.id,
    action: "DELETE",
    entity: "CERTIFICATE",
    entityId: id,
    description: `Deleted certificate ${existing.certificateNumber}`,
    req,
  });

  return ok({ success: true });
});
