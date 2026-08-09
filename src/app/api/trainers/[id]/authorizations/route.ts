// /api/trainers/[id]/authorizations — get & reconcile a trainer's delivery grants
// Courses are stored as TrainerCertification rows (the same rows validateTrainerAssignment()
// checks when a session is created); workshops as WorkshopTrainerAuthorization rows.
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const GET = withModuleAction("trainer-qualifications", "view", async ({ params }) => {
  const trainerId = params.id as string;
  const trainer = await db.trainer.findFirst({ where: { id: trainerId, deletedAt: null } });
  if (!trainer) return notFound("Trainer not found");

  const [certifications, workshopAuthorizations] = await Promise.all([
    db.trainerCertification.findMany({
      where: { trainerId, deletedAt: null, status: "VALID" },
      include: { course: { select: { id: true, code: true, title: true } } },
      orderBy: { createdAt: "asc" },
    }),
    db.workshopTrainerAuthorization.findMany({
      where: { trainerId, deletedAt: null, status: "VALID" },
      include: { workshop: { select: { id: true, code: true, title: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return ok({
    trainerId,
    primarySpecialization: trainer.primarySpecialization,
    courseIds: certifications.map((c) => c.courseId),
    workshopIds: workshopAuthorizations.map((w) => w.workshopId),
    courses: certifications.map((c) => c.course),
    workshops: workshopAuthorizations.map((w) => w.workshop),
  });
});

export const PUT = withModuleAction("trainer-qualifications", "edit", async ({ req, params, user }) => {
  const trainerId = params.id as string;
  const body = await req.json().catch(() => ({}));
  const { courseIds, workshopIds } = body;

  const trainer = await db.trainer.findFirst({ where: { id: trainerId, deletedAt: null } });
  if (!trainer) return notFound("Trainer not found");

  if (!Array.isArray(courseIds) || !Array.isArray(workshopIds)) {
    return fail("courseIds and workshopIds arrays are required", 422, "VALIDATION_ERROR");
  }

  const [existingCerts, existingWs, courses, workshops] = await Promise.all([
    db.trainerCertification.findMany({ where: { trainerId, deletedAt: null } }),
    db.workshopTrainerAuthorization.findMany({ where: { trainerId, deletedAt: null } }),
    db.course.findMany({ where: { id: { in: courseIds }, deletedAt: null } }),
    db.workshop.findMany({ where: { id: { in: workshopIds }, deletedAt: null } }),
  ]);

  if (courses.length !== courseIds.length) return fail("One or more courses were not found", 404);
  if (workshops.length !== workshopIds.length) return fail("One or more workshops were not found", 404);

  const requestedCourseIds = new Set(courseIds);
  const requestedWorkshopIds = new Set(workshopIds);

  const now = new Date();
  let added = 0;
  let removed = 0;

  // Courses: create missing, soft-delete revoked.
  for (const c of courses) {
    if (!existingCerts.some((e) => e.courseId === c.id)) {
      await db.trainerCertification.create({
        data: {
          trainerId,
          courseId: c.id,
          validFrom: now,
          validUntil: null,
          status: "VALID",
          createdBy: user.id,
          updatedBy: user.id,
        },
      });
      added++;
    }
  }
  for (const e of existingCerts) {
    if (!requestedCourseIds.has(e.courseId)) {
      await db.trainerCertification.update({ where: { id: e.id }, data: { deletedAt: now, updatedBy: user.id } });
      removed++;
    }
  }

  // Workshops: create missing, soft-delete revoked.
  for (const w of workshops) {
    if (!existingWs.some((e) => e.workshopId === w.id)) {
      await db.workshopTrainerAuthorization.create({
        data: {
          trainerId,
          workshopId: w.id,
          validFrom: now,
          validUntil: null,
          status: "VALID",
          createdBy: user.id,
          updatedBy: user.id,
        },
      });
      added++;
    }
  }
  for (const e of existingWs) {
    if (!requestedWorkshopIds.has(e.workshopId)) {
      await db.workshopTrainerAuthorization.update({ where: { id: e.id }, data: { deletedAt: now, updatedBy: user.id } });
      removed++;
    }
  }

  // Recompute primarySpecialization from the resulting grants.
  const [csccCount, wsCount] = await Promise.all([
    db.trainerCertification.count({ where: { trainerId, deletedAt: null } }),
    db.workshopTrainerAuthorization.count({ where: { trainerId, deletedAt: null } }),
  ]);
  const parts: string[] = [];
  if (csccCount > 0) parts.push("Safety Certification Courses");
  if (wsCount > 0) parts.push("Technical Certification Tests");
  await db.trainer.update({
    where: { id: trainerId },
    data: { primarySpecialization: parts.join(" & ") || null, updatedBy: user.id },
  });

  await audit({
    user,
    action: "PERMISSION_CHANGE",
    entity: "TRAINER",
    entityId: trainerId,
    entityRef: trainer.refNumber,
    description: `Updated trainer authorizations: ${added} added, ${removed} removed (${courseIds.length} courses, ${workshopIds.length} workshops)`,
    descriptionAr: `تحديث صلاحيات المدرب: ${added} مضافة، ${removed} محذوفة (${courseIds.length} دورة، ${workshopIds.length} ورشة)`,
    req,
    metadata: { courseIds, workshopIds },
  });

  return ok({ trainerId, added, removed, courses: courseIds.length, workshops: workshopIds.length });
});
