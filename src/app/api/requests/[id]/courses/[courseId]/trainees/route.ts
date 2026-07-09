// /api/requests/[id]/courses/[courseId]/trainees — manage trainees in a request-course
//   GET    → list trainees
//   POST   → add a single trainee (or batch via { traineeIds: [...] })
//   DELETE → remove a trainee (?traineeId=...) or batch via body
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { MAX_TRAINEES_PER_COURSE } from "@/lib/api/request-validation";

export const GET = withModuleAction("requests", "view", async ({ params, user }) => {
  const requestId = params.id as string;
  const courseParamId = params.courseId as string;

  // Contractors may only read their own company's requests.
  if (user.role === "CONTRACTOR") {
    const request = await db.trainingRequest.findUnique({
      where: { id: requestId },
      select: { companyId: true, deletedAt: true },
    });
    if (!request || request.deletedAt || request.companyId !== user.companyId) {
      return notFound("Course not found in this request");
    }
  }

  const rc = await db.trainingRequestCourse.findFirst({
    where: { requestId, deletedAt: null, OR: [{ id: courseParamId }, { courseId: courseParamId }] },
    include: {
      course: { select: { id: true, title: true, code: true, refNumber: true } },
      trainees: {
        where: { deletedAt: null },
        include: {
          trainee: {
            include: { company: { select: { id: true, name: true } } },
          },
        },
      },
    },
  });
  if (!rc) return notFound("Course not found in this request");

  return ok({
    requestCourseId: rc.id,
    courseId: rc.courseId,
    courseTitle: rc.course?.title ?? null,
    courseCode: rc.course?.code ?? null,
    courseRef: rc.course?.refNumber ?? null,
    traineeCount: rc.traineeCount,
    minTrainees: rc.minTrainees,
    maxTrainees: rc.maxTrainees,
    trainees: rc.trainees.map((t) => ({
      id: t.id,
      traineeId: t.traineeId,
      fullName: t.trainee.fullName,
      nationalId: t.trainee.nationalId,
      nationality: t.trainee.nationality,
      jobTitle: t.trainee.jobTitle,
      mobile: t.trainee.mobile,
      email: t.trainee.email,
      companyName: t.trainee.company?.name ?? null,
      traineeRef: t.trainee.refNumber,
    })),
  });
});

export const POST = withModuleAction("requests", "edit", async ({ req, params, user }) => {
  const requestId = params.id as string;
  const courseParamId = params.courseId as string;

  const request = await db.trainingRequest.findUnique({ where: { id: requestId } });
  if (!request || request.deletedAt) return notFound("Request not found");

  if (user.role === "CONTRACTOR") {
    if (request.companyId !== user.companyId) return fail("Forbidden", 403);
    if (!["DRAFT", "SUBMITTED", "REJECTED"].includes(request.status)) {
      return fail("Cannot modify trainees on a request that has already entered review", 400);
    }
  }

  const rc = await db.trainingRequestCourse.findFirst({
    where: { requestId, deletedAt: null, OR: [{ id: courseParamId }, { courseId: courseParamId }] },
    include: { _count: { select: { trainees: true } } },
  });
  if (!rc) return notFound("Course not found in this request");

  const body = await req.json().catch(() => ({}));
  const traineeIds: string[] = Array.isArray(body.traineeIds) ? body.traineeIds : (body.traineeId ? [body.traineeId] : []);
  if (traineeIds.length === 0) return fail("traineeId or traineeIds is required", 422, "VALIDATION_ERROR");

  // Check max capacity
  const currentCount = rc._count.trainees;
  if (currentCount + traineeIds.length > MAX_TRAINEES_PER_COURSE) {
    return fail(
      `Cannot add ${traineeIds.length} trainee(s): would exceed maximum of ${MAX_TRAINEES_PER_COURSE} (current: ${currentCount})`,
      422,
      "MAX_TRAINEES_EXCEEDED",
      { current: currentCount, adding: traineeIds.length, max: MAX_TRAINEES_PER_COURSE }
    );
  }

  // Validate trainees exist + belong to same company
  const trainees = await db.trainee.findMany({
    where: { id: { in: traineeIds }, deletedAt: null },
    select: { id: true, companyId: true, fullName: true, refNumber: true },
  });
  if (trainees.length !== traineeIds.length) {
    return fail(`Some trainees were not found (${trainees.length}/${traineeIds.length})`, 404);
  }
  const wrongCompany = trainees.filter((t) => t.companyId !== request.companyId);
  if (wrongCompany.length > 0) {
    return fail(
      `${wrongCompany.length} trainee(s) do not belong to the request's company`,
      422,
      "TRAINEE_COMPANY_MISMATCH",
      { wrongTrainees: wrongCompany.map((t) => ({ id: t.id, name: t.fullName, ref: t.refNumber })) }
    );
  }

  // Filter out already-added trainees
  const existingLinks = await db.trainingRequestCourseTrainee.findMany({
    where: { requestCourseId: rc.id, traineeId: { in: traineeIds }, deletedAt: null },
    select: { traineeId: true },
  });
  const existingIds = new Set(existingLinks.map((l) => l.traineeId));
  const newTraineeIds = traineeIds.filter((id) => !existingIds.has(id));

  if (newTraineeIds.length === 0) {
    return fail("All trainees are already added to this course", 400, "ALREADY_ADDED");
  }

  await db.$transaction(async (tx) => {
    await tx.trainingRequestCourseTrainee.createMany({
      data: newTraineeIds.map((traineeId) => ({
        requestCourseId: rc.id,
        traineeId,
        createdBy: user.id,
        updatedBy: user.id,
      })),
    });
    await tx.trainingRequestCourse.update({
      where: { id: rc.id },
      data: { traineeCount: { increment: newTraineeIds.length }, updatedBy: user.id },
    });
    await tx.trainingRequest.update({
      where: { id: requestId },
      data: { traineeCount: { increment: newTraineeIds.length }, updatedBy: user.id },
    });
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "REQUEST",
    entityId: requestId,
    entityRef: request.refNumber,
    description: `Added ${newTraineeIds.length} trainee(s) to a course in request ${request.refNumber}`,
    descriptionAr: `تمت إضافة ${newTraineeIds.length} متدرب إلى دورة في طلب ${request.refNumber}`,
    req,
    metadata: { requestCourseId: rc.id, addedTraineeIds: newTraineeIds },
  });

  return ok({ added: newTraineeIds.length, skipped: traineeIds.length - newTraineeIds.length });
});

export const DELETE = withModuleAction("requests", "edit", async ({ req, params, user }) => {
  const requestId = params.id as string;
  const courseParamId = params.courseId as string;

  const request = await db.trainingRequest.findUnique({ where: { id: requestId } });
  if (!request || request.deletedAt) return notFound("Request not found");

  if (user.role === "CONTRACTOR") {
    if (request.companyId !== user.companyId) return fail("Forbidden", 403);
    if (!["DRAFT", "SUBMITTED", "REJECTED"].includes(request.status)) {
      return fail("Cannot modify trainees on a request that has already entered review", 400);
    }
  }

  const rc = await db.trainingRequestCourse.findFirst({
    where: { requestId, deletedAt: null, OR: [{ id: courseParamId }, { courseId: courseParamId }] },
  });
  if (!rc) return notFound("Course not found in this request");

  const url = new URL(req.url);
  const traineeIdFromQuery = url.searchParams.get("traineeId");

  const body = await req.json().catch(() => ({}));
  const traineeIds: string[] = traineeIdFromQuery
    ? [traineeIdFromQuery]
    : Array.isArray(body.traineeIds)
      ? body.traineeIds
      : (body.traineeId ? [body.traineeId] : []);

  if (traineeIds.length === 0) return fail("traineeId or traineeIds is required", 422, "VALIDATION_ERROR");

  // Soft delete the trainee links
  const result = await db.trainingRequestCourseTrainee.updateMany({
    where: { requestCourseId: rc.id, traineeId: { in: traineeIds }, deletedAt: null },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  if (result.count > 0) {
    await db.$transaction([
      db.trainingRequestCourse.update({
        where: { id: rc.id },
        data: { traineeCount: { decrement: result.count }, updatedBy: user.id },
      }),
      db.trainingRequest.update({
        where: { id: requestId },
        data: { traineeCount: { decrement: result.count }, updatedBy: user.id },
      }),
    ]);
  }

  await audit({
    user,
    action: "UPDATE",
    entity: "REQUEST",
    entityId: requestId,
    entityRef: request.refNumber,
    description: `Removed ${result.count} trainee(s) from a course in request ${request.refNumber}`,
    descriptionAr: `تم حذف ${result.count} متدرب من دورة في طلب ${request.refNumber}`,
    req,
    metadata: { requestCourseId: rc.id, removedTraineeIds: traineeIds, removedCount: result.count },
  });

  return ok({ removed: result.count });
});
