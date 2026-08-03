// /api/courses/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const GET = withModuleAction("courses", "view", async ({ params }) => {
  const id = params.id as string;
  const course = await db.course.findUnique({
    where: { id },
    include: {
      _count: { select: { requests: true, sessions: true, certificates: true, questions: true } },
    },
  });
  if (!course || course.deletedAt) return notFound("Course not found");
  return ok(course);
});

export const PUT = withModuleAction("courses", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.course.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Course not found");

  if (body.code && body.code !== existing.code) {
    const dup = await db.course.findFirst({ where: { code: body.code, deletedAt: null } });
    if (dup) return fail("Course code already exists", 400);
  }

  const {
    code, title, titleAr, description, category, durationHours,
    language, validityMonths, passScore, maxTrainees,
    hasPreTest, hasFinalTest, hasEvaluation, status,
    aiExamEnabled, aiExamConfig,
    requiresProfessionVerification,
  } = body;

  const updated = await db.course.update({
    where: { id },
    data: {
      ...(code !== undefined && { code }),
      ...(title !== undefined && { title }),
      ...(titleAr !== undefined && { titleAr }),
      ...(description !== undefined && { description }),
      ...(category !== undefined && { category }),
      ...(durationHours !== undefined && { durationHours }),
      ...(language !== undefined && { language }),
      ...(validityMonths !== undefined && { validityMonths }),
      ...(passScore !== undefined && { passScore }),
      ...(maxTrainees !== undefined && { maxTrainees }),
      ...(hasPreTest !== undefined && { hasPreTest }),
      ...(hasFinalTest !== undefined && { hasFinalTest }),
      ...(hasEvaluation !== undefined && { hasEvaluation }),
      ...(status !== undefined && { status }),
      ...(aiExamEnabled !== undefined && { aiExamEnabled }),
      ...(aiExamConfig !== undefined && { aiExamConfig }),
      ...(requiresProfessionVerification !== undefined && { requiresProfessionVerification }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "COURSE",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Updated course: ${updated.title}`,
    descriptionAr: `تم تحديث دورة: ${updated.title}`,
    req,
    metadata: { before: existing, after: updated },
  });

  return ok(updated);
});

export const DELETE = withModuleAction("courses", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.course.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Course not found");

  const sessions = await db.trainingSession.count({ where: { courseId: id, deletedAt: null } });
  if (sessions > 0) {
    return fail("Cannot delete a course with sessions. Deactivate it instead.", 400);
  }

  await db.course.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "COURSE",
    entityId: id,
    entityRef: existing.refNumber,
    description: `Deleted course: ${existing.title}`,
    descriptionAr: `تم حذف دورة: ${existing.title}`,
    req,
  });

  return ok({ success: true });
});
