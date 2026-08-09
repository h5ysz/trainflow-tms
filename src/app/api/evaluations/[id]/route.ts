// /api/evaluations/[id] — get / update / soft-delete a course evaluation
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

const RATING_FIELDS = [
  "trainerRating",
  "contentRating",
  "venueRating",
  "materialsRating",
  "overallRating",
] as const;

export const GET = withModuleAction("evaluation", "view", async ({ params }) => {
  const id = params.id as string;
  const evaluation = await db.courseEvaluation.findUnique({
    where: { id },
    include: {
      session: { select: { id: true, refNumber: true, title: true } },
      trainer: { select: { id: true, nameEn: true, refNumber: true } },
    },
  });
  if (!evaluation || evaluation.deletedAt) return notFound("Evaluation not found");
  return ok(evaluation);
});

export const PUT = withModuleAction("evaluation", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const existing = await db.courseEvaluation.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Evaluation not found");

  const body = await req.json().catch(() => ({}));
  const {
    trainerId, traineeName, traineeEmail,
    trainerRating, contentRating, venueRating, materialsRating, overallRating,
    comments, suggestions, wouldRecommend,
  } = body;

  // Match POST: a rating that is supplied must land in 1..5.
  const supplied = RATING_FIELDS.map((f) => body[f]).filter((r) => r !== undefined);
  if (supplied.some((r) => typeof r !== "number" || r < 1 || r > 5)) {
    return fail("All ratings must be between 1 and 5", 422, "VALIDATION_ERROR");
  }

  const updated = await db.courseEvaluation.update({
    where: { id },
    data: {
      ...(trainerId !== undefined && { trainerId }),
      ...(traineeName !== undefined && { traineeName }),
      ...(traineeEmail !== undefined && { traineeEmail }),
      ...(trainerRating !== undefined && { trainerRating }),
      ...(contentRating !== undefined && { contentRating }),
      ...(venueRating !== undefined && { venueRating }),
      ...(materialsRating !== undefined && { materialsRating }),
      ...(overallRating !== undefined && { overallRating }),
      ...(comments !== undefined && { comments }),
      ...(suggestions !== undefined && { suggestions }),
      ...(wouldRecommend !== undefined && { wouldRecommend }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "EVALUATION",
    entityId: id,
    description: `Updated evaluation for ${updated.traineeName}`,
    descriptionAr: `تم تحديث تقييم ${updated.traineeName}`,
    req,
  });

  return ok(updated);
});

export const DELETE = withModuleAction("evaluation", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.courseEvaluation.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Evaluation not found");

  await db.courseEvaluation.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "EVALUATION",
    entityId: id,
    description: `Deleted evaluation for ${existing.traineeName}`,
    descriptionAr: `تم حذف تقييم ${existing.traineeName}`,
    req,
  });

  return ok({ success: true });
});
