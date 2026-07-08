// /api/companies/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const GET = withModuleAction("companies", "view", async ({ params }) => {
  const id = params.id as string;
  const company = await db.company.findUnique({
    where: { id },
    include: {
      contacts: {
        where: { deletedAt: null },
        orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
      },
      users: {
        where: { deletedAt: null },
        select: { id: true, fullName: true, email: true, role: true, isActive: true },
      },
      _count: { select: { trainingRequests: true, certificates: true } },
    },
  });
  if (!company || company.deletedAt) return notFound("Company not found");
  return ok(company);
});

export const PUT = withModuleAction("companies", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.company.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Company not found");

  const {
    name, nameAr, legalName, crNumber, vatNumber, industry,
    country, city, address, postalCode, phone, email, website,
    contactPerson, contactPhone, contactEmail, status, logoUrl,
  } = body;

  const updated = await db.company.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(nameAr !== undefined && { nameAr }),
      ...(legalName !== undefined && { legalName }),
      ...(crNumber !== undefined && { crNumber }),
      ...(vatNumber !== undefined && { vatNumber }),
      ...(industry !== undefined && { industry }),
      ...(country !== undefined && { country }),
      ...(city !== undefined && { city }),
      ...(address !== undefined && { address }),
      ...(postalCode !== undefined && { postalCode }),
      ...(phone !== undefined && { phone }),
      ...(email !== undefined && { email }),
      ...(website !== undefined && { website }),
      ...(contactPerson !== undefined && { contactPerson }),
      ...(contactPhone !== undefined && { contactPhone }),
      ...(contactEmail !== undefined && { contactEmail }),
      ...(status !== undefined && { status }),
      ...(logoUrl !== undefined && { logoUrl }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "COMPANY",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Updated company: ${updated.name}`,
    descriptionAr: `تم تحديث شركة: ${updated.name}`,
    req,
    metadata: { before: existing, after: updated },
  });

  return ok(updated);
});

export const DELETE = withModuleAction("companies", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.company.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Company not found");

  // Prevent cascade issues: check for related records (non-deleted)
  const related = await db.trainingRequest.count({ where: { companyId: id, deletedAt: null } });
  if (related > 0) {
    return fail("Cannot delete a company with training requests. Suspend it instead.", 400);
  }

  // Soft delete
  await db.company.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "COMPANY",
    entityId: id,
    entityRef: existing.refNumber,
    description: `Deleted company: ${existing.name}`,
    descriptionAr: `تم حذف شركة: ${existing.name}`,
    req,
  });

  return ok({ success: true });
});
