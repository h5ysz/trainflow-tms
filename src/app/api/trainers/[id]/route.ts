// /api/trainers/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const GET = withModuleAction("trainers", "view", async ({ params }) => {
  const id = params.id as string;
  const trainer = await db.trainer.findUnique({
    where: { id },
    include: {
      qualifications: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      sessions: {
        where: { deletedAt: null },
        orderBy: { startDate: "desc" },
        take: 20,
        include: { course: { select: { id: true, title: true, code: true } } },
      },
      _count: { select: { qualifications: true, sessions: true, evaluations: true } },
    },
  });
  if (!trainer || trainer.deletedAt) return notFound("Trainer not found");
  return ok(trainer);
});

export const PUT = withModuleAction("trainers", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.trainer.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Trainer not found");

  const {
    nameEn, nameAr, nationalId, email, phone, mobile,
    gender, nationality, country, city, address, bio, photoUrl,
    status, hireDate,
  } = body;

  if (nationalId && nationalId !== existing.nationalId) {
    const dup = await db.trainer.findFirst({ where: { nationalId, deletedAt: null } });
    if (dup) return fail("National ID already exists", 400);
  }
  if (email && email !== existing.email) {
    const dup = await db.trainer.findFirst({ where: { email, deletedAt: null } });
    if (dup) return fail("Email already exists", 400);
  }

  const updated = await db.trainer.update({
    where: { id },
    data: {
      ...(nameEn !== undefined && { nameEn }),
      ...(nameAr !== undefined && { nameAr }),
      ...(nationalId !== undefined && { nationalId }),
      ...(email !== undefined && { email }),
      ...(phone !== undefined && { phone }),
      ...(mobile !== undefined && { mobile }),
      ...(gender !== undefined && { gender }),
      ...(nationality !== undefined && { nationality }),
      ...(country !== undefined && { country }),
      ...(city !== undefined && { city }),
      ...(address !== undefined && { address }),
      ...(bio !== undefined && { bio }),
      ...(photoUrl !== undefined && { photoUrl }),
      ...(status !== undefined && { status }),
      ...(hireDate !== undefined && { hireDate: hireDate ? new Date(hireDate) : null }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "TRAINER",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Updated trainer: ${updated.nameEn}`,
    descriptionAr: `تم تحديث مدرب: ${updated.nameEn}`,
    req,
    metadata: { before: existing, after: updated },
  });

  return ok(updated);
});

export const DELETE = withModuleAction("trainers", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.trainer.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Trainer not found");

  const sessions = await db.trainingSession.count({ where: { trainerId: id, deletedAt: null } });
  if (sessions > 0) {
    return fail("Cannot delete a trainer with sessions. Suspend instead.", 400);
  }

  await db.trainer.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "TRAINER",
    entityId: id,
    entityRef: existing.refNumber,
    description: `Deleted trainer: ${existing.nameEn}`,
    descriptionAr: `تم حذف مدرب: ${existing.nameEn}`,
    req,
  });

  return ok({ success: true });
});
