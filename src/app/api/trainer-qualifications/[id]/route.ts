// /api/trainer-qualifications/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, audit } from "@/lib/auth/api";

export const GET = withModuleAction("trainer-qualifications", "view", async ({ params }) => {
  const id = params.id as string;
  const qual = await db.trainerQualification.findUnique({
    where: { id },
    include: { trainer: true },
  });
  if (!qual || qual.deletedAt) return notFound("Qualification not found");
  return ok(qual);
});

export const PUT = withModuleAction("trainer-qualifications", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.trainerQualification.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Qualification not found");

  const { title, issuer, credentialNumber, issueDate, expiryDate, documentUrl, status } = body;
  const updated = await db.trainerQualification.update({
    where: { id },
    data: {
      ...(title !== undefined && { title }),
      ...(issuer !== undefined && { issuer }),
      ...(credentialNumber !== undefined && { credentialNumber }),
      ...(issueDate !== undefined && { issueDate: issueDate ? new Date(issueDate) : null }),
      ...(expiryDate !== undefined && { expiryDate: expiryDate ? new Date(expiryDate) : null }),
      ...(documentUrl !== undefined && { documentUrl }),
      ...(status !== undefined && { status }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "TRAINER",
    entityId: id,
    description: `Updated qualification: ${updated.title}`,
    descriptionAr: `تم تحديث مؤهل: ${updated.title}`,
    req,
  });

  return ok(updated);
});

export const DELETE = withModuleAction("trainer-qualifications", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.trainerQualification.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Qualification not found");

  await db.trainerQualification.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "TRAINER",
    entityId: id,
    description: `Deleted qualification: ${existing.title}`,
    descriptionAr: `تم حذف مؤهل: ${existing.title}`,
    req,
  });

  return ok({ success: true });
});
