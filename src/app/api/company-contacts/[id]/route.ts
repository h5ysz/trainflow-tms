// /api/company-contacts/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, audit } from "@/lib/auth/api";

export const GET = withModuleAction("company-contacts", "view", async ({ params }) => {
  const id = params.id as string;
  const contact = await db.companyContact.findUnique({
    where: { id },
    include: { company: true },
  });
  if (!contact || contact.deletedAt) return notFound("Contact not found");
  return ok(contact);
});

export const PUT = withModuleAction("company-contacts", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.companyContact.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Contact not found");

  const { fullName, jobTitle, email, phone, mobile, isPrimary, isActive, notes, companyId } = body;
  const updated = await db.companyContact.update({
    where: { id },
    data: {
      ...(fullName !== undefined && { fullName }),
      ...(jobTitle !== undefined && { jobTitle }),
      ...(email !== undefined && { email }),
      ...(phone !== undefined && { phone }),
      ...(mobile !== undefined && { mobile }),
      ...(isPrimary !== undefined && { isPrimary }),
      ...(isActive !== undefined && { isActive }),
      ...(notes !== undefined && { notes }),
      ...(companyId !== undefined && { companyId }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "COMPANY",
    entityId: id,
    description: `Updated contact: ${updated.fullName}`,
    descriptionAr: `تم تحديث جهة اتصال: ${updated.fullName}`,
    req,
  });

  return ok(updated);
});

export const DELETE = withModuleAction("company-contacts", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.companyContact.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Contact not found");

  await db.companyContact.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "COMPANY",
    entityId: id,
    description: `Deleted contact: ${existing.fullName}`,
    descriptionAr: `تم حذف جهة اتصال: ${existing.fullName}`,
    req,
  });

  return ok({ success: true });
});
