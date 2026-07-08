// /api/trainees/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const GET = withModuleAction("trainees", "view", async ({ params }) => {
  const id = params.id as string;
  const trainee = await db.trainee.findUnique({
    where: { id },
    include: {
      company: true,
      requestCourses: {
        where: { deletedAt: null },
        include: {
          request: { select: { id: true, refNumber: true, status: true } },
          course: { select: { id: true, title: true, code: true, refNumber: true } },
        },
      },
    },
  });
  if (!trainee || trainee.deletedAt) return notFound("Trainee not found");
  return ok(trainee);
});

export const PUT = withModuleAction("trainees", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.trainee.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Trainee not found");

  const { fullName, nationalId, nationality, jobTitle, mobile, email, companyId, status, notes } = body;

  // Prevent duplicate National ID on update
  if (nationalId && nationalId !== existing.nationalId) {
    const dup = await db.trainee.findFirst({
      where: { nationalId, deletedAt: null, NOT: { id } },
    });
    if (dup) {
      return fail(`National ID "${nationalId}" already in use by ${dup.refNumber}`, 400, "DUPLICATE_NATIONAL_ID");
    }
  }

  if (companyId && companyId !== existing.companyId) {
    const company = await db.company.findFirst({ where: { id: companyId, deletedAt: null } });
    if (!company) return fail("Company not found", 404);
  }

  const updated = await db.trainee.update({
    where: { id },
    data: {
      ...(fullName !== undefined && { fullName }),
      ...(nationalId !== undefined && { nationalId }),
      ...(nationality !== undefined && { nationality }),
      ...(jobTitle !== undefined && { jobTitle }),
      ...(mobile !== undefined && { mobile }),
      ...(email !== undefined && { email }),
      ...(companyId !== undefined && { companyId }),
      ...(status !== undefined && { status }),
      ...(notes !== undefined && { notes }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "TRAINEE",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Updated trainee: ${updated.fullName}`,
    descriptionAr: `تم تحديث متدرب: ${updated.fullName}`,
    req,
    metadata: { before: existing, after: updated },
  });

  return ok(updated);
});

export const DELETE = withModuleAction("trainees", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.trainee.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Trainee not found");

  await db.trainee.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "TRAINEE",
    entityId: id,
    entityRef: existing.refNumber,
    description: `Deleted trainee: ${existing.fullName}`,
    descriptionAr: `تم حذف متدرب: ${existing.fullName}`,
    req,
  });

  return ok({ success: true });
});
