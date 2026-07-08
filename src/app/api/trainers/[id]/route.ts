// /api/trainers/[id] — get / update / delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, auditLog } from "@/lib/auth/api";

export const GET = withModuleAction("trainers", "view", async ({ params }) => {
  const id = params.id as string;
  const trainer = await db.trainer.findUnique({
    where: { id },
    include: {
      qualifications: { orderBy: { createdAt: "desc" } },
      sessions: {
        orderBy: { startDate: "desc" },
        take: 20,
        include: { course: { select: { id: true, title: true, code: true } } },
      },
      _count: { select: { qualifications: true, sessions: true, evaluations: true } },
    },
  });
  if (!trainer) return notFound("Trainer not found");
  return ok(trainer);
});

export const PUT = withModuleAction("trainers", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.trainer.findUnique({ where: { id } });
  if (!existing) return notFound("Trainer not found");

  const {
    fullName, fullNameAr, nationalId, email, phone, mobile,
    gender, nationality, country, city, address, bio, photoUrl,
    status, hireDate,
  } = body;

  // Uniqueness checks
  if (nationalId && nationalId !== existing.nationalId) {
    const dup = await db.trainer.findUnique({ where: { nationalId } });
    if (dup) return fail("National ID already exists", 400);
  }
  if (email && email !== existing.email) {
    const dup = await db.trainer.findUnique({ where: { email } });
    if (dup) return fail("Email already exists", 400);
  }

  const updated = await db.trainer.update({
    where: { id },
    data: {
      ...(fullName !== undefined && { fullName }),
      ...(fullNameAr !== undefined && { fullNameAr }),
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
    },
  });

  await auditLog({
    userId: user.id,
    action: "UPDATE",
    entity: "TRAINER",
    entityId: id,
    description: `Updated trainer: ${updated.fullName}`,
    req,
  });

  return ok(updated);
});

export const DELETE = withModuleAction("trainers", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.trainer.findUnique({ where: { id } });
  if (!existing) return notFound("Trainer not found");

  const sessions = await db.trainingSession.count({ where: { trainerId: id } });
  if (sessions > 0) {
    return fail("Cannot delete a trainer with sessions. Suspend instead.", 400);
  }

  await db.trainer.delete({ where: { id } });
  await auditLog({
    userId: user.id,
    action: "DELETE",
    entity: "TRAINER",
    entityId: id,
    description: `Deleted trainer: ${existing.fullName}`,
    req,
  });

  return ok({ success: true });
});
