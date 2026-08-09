// /api/workshops/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const GET = withModuleAction("workshops", "view", async ({ params }) => {
  const id = params.id as string;
  const workshop = await db.workshop.findUnique({
    where: { id },
    include: {
      authorizations: {
        where: { deletedAt: null },
        include: { trainer: { select: { id: true, nameEn: true, refNumber: true } } },
      },
    },
  });
  if (!workshop || workshop.deletedAt) return notFound("Workshop not found");
  return ok(workshop);
});

export const PUT = withModuleAction("workshops", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.workshop.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Workshop not found");

  if (body.code && body.code !== existing.code) {
    const dup = await db.workshop.findFirst({ where: { code: body.code, deletedAt: null } });
    if (dup) return fail("Workshop code already exists", 400);
  }

  const {
    code, title, description, category, durationDays, durationText, durationHours, status, isActive,
  } = body;

  const updated = await db.workshop.update({
    where: { id },
    data: {
      ...(code !== undefined && { code }),
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(category !== undefined && { category }),
      ...(durationDays !== undefined && { durationDays }),
      ...(durationText !== undefined && { durationText }),
      ...(durationHours !== undefined && { durationHours }),
      ...(status !== undefined && { status }),
      ...(isActive !== undefined && { isActive }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "WORKSHOP",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Updated workshop: ${updated.title}`,
    descriptionAr: `تم تحديث ورشة: ${updated.title}`,
    req,
    metadata: { before: existing, after: updated },
  });

  return ok(updated);
});

export const DELETE = withModuleAction("workshops", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.workshop.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Workshop not found");

  await db.workshop.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "WORKSHOP",
    entityId: id,
    entityRef: existing.refNumber,
    description: `Deleted workshop: ${existing.title}`,
    descriptionAr: `تم حذف ورشة: ${existing.title}`,
    req,
  });

  return ok({ success: true });
});
