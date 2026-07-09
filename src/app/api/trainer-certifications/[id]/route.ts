// /api/trainer-certifications/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, audit } from "@/lib/auth/api";

export const GET = withModuleAction("trainer-qualifications", "view", async ({ params }) => {
  const id = params.id as string;
  const cert = await db.trainerCertification.findUnique({
    where: { id },
    include: {
      trainer: true,
      course: true,
      qualification: true,
    },
  });
  if (!cert || cert.deletedAt) return notFound("Certification not found");
  return ok(cert);
});

export const PUT = withModuleAction("trainer-qualifications", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.trainerCertification.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Certification not found");

  const { validFrom, validUntil, status, notes } = body;
  const updated = await db.trainerCertification.update({
    where: { id },
    data: {
      // validFrom is non-nullable in the schema — only write it when a real
      // date is supplied, otherwise leave the existing value alone.
      ...(validFrom ? { validFrom: new Date(validFrom) } : {}),
      // validUntil is nullable, so clearing it is meaningful.
      ...(validUntil !== undefined && { validUntil: validUntil ? new Date(validUntil) : null }),
      ...(status !== undefined && { status }),
      ...(notes !== undefined && { notes }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "TRAINER",
    entityId: existing.trainerId,
    description: `Updated trainer certification ${id}`,
    descriptionAr: `تم تحديث اعتماد مدرب ${id}`,
    req,
  });

  return ok(updated);
});

export const DELETE = withModuleAction("trainer-qualifications", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.trainerCertification.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Certification not found");

  await db.trainerCertification.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "TRAINER",
    entityId: existing.trainerId,
    description: `Removed trainer certification ${id}`,
    descriptionAr: `تم حذف اعتماد مدرب ${id}`,
    req,
  });

  return ok({ success: true });
});
