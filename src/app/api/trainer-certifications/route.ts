// /api/trainer-certifications — list + create
// A trainer can only teach courses they're certified for
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["createdAt", "updatedAt", "status", "validUntil", "validFrom"];

export const GET = withModuleAction("trainer-qualifications", "view", async ({ req }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.filters.trainerId) where.trainerId = q.filters.trainerId;
  if (q.filters.courseId) where.courseId = q.filters.courseId;
  if (q.filters.status) where.status = q.filters.status;

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.trainerCertification.findMany({
      where,
      include: {
        trainer: { select: { id: true, nameEn: true, nameAr: true, refNumber: true, deletedAt: true } },
        course: { select: { id: true, title: true, code: true, refNumber: true } },
        qualification: { select: { id: true, title: true, credentialNumber: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.trainerCertification.count({ where }),
  ]);

  return list(rows, buildListMeta(total, q));
});

export const POST = withModuleAction("trainer-qualifications", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { trainerId, courseId, qualificationId, validFrom, validUntil, status, notes } = body;

  if (!trainerId || !courseId) {
    return fail("trainerId and courseId are required", 422, "VALIDATION_ERROR");
  }

  const [trainer, course] = await Promise.all([
    db.trainer.findFirst({ where: { id: trainerId, deletedAt: null } }),
    db.course.findFirst({ where: { id: courseId, deletedAt: null } }),
  ]);
  if (!trainer) return fail("Trainer not found", 404);
  if (!course) return fail("Course not found", 404);

  // Prevent duplicate certification (same trainer + course, non-deleted)
  const existing = await db.trainerCertification.findFirst({
    where: { trainerId, courseId, deletedAt: null },
  });
  if (existing) {
    return fail(`Trainer ${trainer.nameEn} is already certified for ${course.title}`, 400, "DUPLICATE_CERTIFICATION");
  }

  // Validate qualification belongs to trainer if provided
  if (qualificationId) {
    const qual = await db.trainerQualification.findFirst({
      where: { id: qualificationId, trainerId, deletedAt: null },
    });
    if (!qual) return fail("Qualification not found for this trainer", 404);
  }

  const cert = await db.trainerCertification.create({
    data: {
      trainerId,
      courseId,
      qualificationId: qualificationId ?? null,
      validFrom: validFrom ? new Date(validFrom) : new Date(),
      validUntil: validUntil ? new Date(validUntil) : null,
      status: status ?? "VALID",
      notes: notes ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    },
    include: {
      trainer: { select: { nameEn: true, refNumber: true } },
      course: { select: { title: true, code: true, refNumber: true } },
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "TRAINER",
    entityId: trainerId,
    entityRef: trainer.refNumber,
    description: `Certified trainer ${trainer.nameEn} for course ${course.title}`,
    descriptionAr: `اعتماد المدرب ${trainer.nameEn} لتدريس دورة ${course.title}`,
    req,
    metadata: { certificationId: cert.id, courseId, trainerId },
  });

  return created(cert);
});
