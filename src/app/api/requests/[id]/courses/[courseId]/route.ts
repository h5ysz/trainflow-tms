// /api/requests/[id]/courses/[courseId] — manage a single course-within-request
//   POST   → add course to request (with optional trainee list)
//   GET    → get course details + trainees
//   PUT    → update course (notes, min/max)
//   DELETE → remove course from request
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { MIN_TRAINEES_PER_COURSE, MAX_TRAINEES_PER_COURSE } from "@/lib/api/request-validation";

export const GET = withModuleAction("requests", "view", async ({ params }) => {
  const requestId = params.id as string;
  const courseParamId = params.courseId as string;

  // courseParamId can be either the TrainingRequestCourse.id OR the Course.id
  // Try TrainingRequestCourse.id first
  let rc = await db.trainingRequestCourse.findUnique({
    where: { id: courseParamId },
    include: {
      course: true,
      trainees: {
        where: { deletedAt: null },
        include: {
          trainee: {
            include: { company: { select: { id: true, name: true } } },
          },
        },
      },
      request: { select: { id: true, refNumber: true, status: true, companyId: true } },
    },
  });

  // If not found, try by courseId within this request
  if (!rc || rc.deletedAt || rc.requestId !== requestId) {
    rc = await db.trainingRequestCourse.findFirst({
      where: { requestId, courseId: courseParamId, deletedAt: null },
      include: {
        course: true,
        trainees: {
          where: { deletedAt: null },
          include: {
            trainee: {
              include: { company: { select: { id: true, name: true } } },
            },
          },
        },
        request: { select: { id: true, refNumber: true, status: true, companyId: true } },
      },
    });
  }

  if (!rc || rc.deletedAt) return notFound("Course not found in this request");
  return ok(rc);
});

export const POST = withModuleAction("requests", "edit", async ({ req, params, user }) => {
  const requestId = params.id as string;
  const courseParamId = params.courseId as string;

  const request = await db.trainingRequest.findUnique({ where: { id: requestId } });
  if (!request || request.deletedAt) return notFound("Request not found");

  // Contractors can only modify their own DRAFT/SUBMITTED/REJECTED requests
  if (user.role === "CONTRACTOR") {
    if (request.companyId !== user.companyId) return fail("Forbidden", 403);
    if (!["DRAFT", "SUBMITTED", "REJECTED"].includes(request.status)) {
      return fail("Cannot modify courses on a request that has already entered review", 400);
    }
  }

  // courseParamId is the Course.id we want to add
  const course = await db.course.findFirst({ where: { id: courseParamId, deletedAt: null } });
  if (!course) return fail("Course not found", 404);

  const body = await req.json().catch(() => ({}));
  const { traineeIds, notes } = body as { traineeIds?: string[]; notes?: string };

  // Prevent duplicate course in same request
  const existing = await db.trainingRequestCourse.findFirst({
    where: { requestId, courseId: courseParamId, deletedAt: null },
  });
  if (existing) {
    return fail(`Course ${course.code} is already in this request`, 400, "DUPLICATE_COURSE");
  }

  // Validate trainee count if trainees provided
  if (traineeIds && traineeIds.length > MAX_TRAINEES_PER_COURSE) {
    return fail(
      `Cannot exceed ${MAX_TRAINEES_PER_COURSE} trainees per course (received ${traineeIds.length})`,
      422,
      "MAX_TRAINEES_EXCEEDED"
    );
  }

  // Validate trainees belong to the same company
  if (traineeIds && traineeIds.length > 0) {
    const trainees = await db.trainee.findMany({
      where: { id: { in: traineeIds }, deletedAt: null },
      select: { id: true, companyId: true },
    });
    const wrongCompany = trainees.filter((t) => t.companyId !== request.companyId);
    if (wrongCompany.length > 0) {
      return fail(
        `${wrongCompany.length} trainee(s) do not belong to the request's company`,
        422,
        "TRAINEE_COMPANY_MISMATCH"
      );
    }
  }

  // Create the requestCourse + trainee links in a transaction
  const requestCourse = await db.$transaction(async (tx) => {
    const rc = await tx.trainingRequestCourse.create({
      data: {
        requestId,
        courseId: courseParamId,
        traineeCount: traineeIds?.length ?? 0,
        minTrainees: MIN_TRAINEES_PER_COURSE,
        maxTrainees: MAX_TRAINEES_PER_COURSE,
        notes: notes ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });

    if (traineeIds && traineeIds.length > 0) {
      await tx.trainingRequestCourseTrainee.createMany({
        data: traineeIds.map((traineeId) => ({
          requestCourseId: rc.id,
          traineeId,
          createdBy: user.id,
          updatedBy: user.id,
        })),
      });
    }

    // Update the request's total traineeCount
    await tx.trainingRequest.update({
      where: { id: requestId },
      data: { traineeCount: { increment: traineeIds?.length ?? 0 }, updatedBy: user.id },
    });

    return rc;
  });

  await audit({
    user,
    action: "CREATE",
    entity: "REQUEST",
    entityId: requestId,
    entityRef: request.refNumber,
    description: `Added course ${course.title} to request ${request.refNumber} with ${traineeIds?.length ?? 0} trainees`,
    descriptionAr: `تمت إضافة دورة ${course.title} إلى طلب ${request.refNumber} بـ ${traineeIds?.length ?? 0} متدرب`,
    req,
    metadata: { courseId: courseParamId, requestCourseId: requestCourse.id, traineeCount: traineeIds?.length ?? 0 },
  });

  return ok(requestCourse);
});

export const PUT = withModuleAction("requests", "edit", async ({ req, params, user }) => {
  const requestId = params.id as string;
  const courseParamId = params.courseId as string;

  const request = await db.trainingRequest.findUnique({ where: { id: requestId } });
  if (!request || request.deletedAt) return notFound("Request not found");

  if (user.role === "CONTRACTOR") {
    if (request.companyId !== user.companyId) return fail("Forbidden", 403);
    if (!["DRAFT", "SUBMITTED", "REJECTED"].includes(request.status)) {
      return fail("Cannot modify courses on a request that has already entered review", 400);
    }
  }

  // Find the requestCourse
  let rc = await db.trainingRequestCourse.findFirst({
    where: { requestId, deletedAt: null, OR: [{ id: courseParamId }, { courseId: courseParamId }] },
  });
  if (!rc) return notFound("Course not found in this request");

  const body = await req.json().catch(() => ({}));
  const { notes, traineeIds } = body as { notes?: string; traineeIds?: string[] };

  // If traineeIds provided, replace the trainee list
  if (traineeIds !== undefined) {
    if (traineeIds.length > MAX_TRAINEES_PER_COURSE) {
      return fail(
        `Cannot exceed ${MAX_TRAINEES_PER_COURSE} trainees per course (received ${traineeIds.length})`,
        422,
        "MAX_TRAINEES_EXCEEDED"
      );
    }
    // Validate trainees belong to same company
    if (traineeIds.length > 0) {
      const trainees = await db.trainee.findMany({
        where: { id: { in: traineeIds }, deletedAt: null },
        select: { id: true, companyId: true },
      });
      const wrongCompany = trainees.filter((t) => t.companyId !== request.companyId);
      if (wrongCompany.length > 0) {
        return fail(
          `${wrongCompany.length} trainee(s) do not belong to the request's company`,
          422,
          "TRAINEE_COMPANY_MISMATCH"
        );
      }
    }

    await db.$transaction(async (tx) => {
      // Soft delete existing trainees
      await tx.trainingRequestCourseTrainee.updateMany({
        where: { requestCourseId: rc!.id, deletedAt: null },
        data: { deletedAt: new Date(), updatedBy: user.id },
      });
      // Insert new trainees
      if (traineeIds.length > 0) {
        await tx.trainingRequestCourseTrainee.createMany({
          data: traineeIds.map((traineeId) => ({
            requestCourseId: rc!.id,
            traineeId,
            createdBy: user.id,
            updatedBy: user.id,
          })),
        });
      }
      // Update trainee count
      await tx.trainingRequestCourse.update({
        where: { id: rc!.id },
        data: { traineeCount: traineeIds.length, updatedBy: user.id, ...(notes !== undefined && { notes }) },
      });
    });
  } else if (notes !== undefined) {
    await db.trainingRequestCourse.update({
      where: { id: rc.id },
      data: { notes, updatedBy: user.id },
    });
  }

  const updated = await db.trainingRequestCourse.findUnique({
    where: { id: rc.id },
    include: { trainees: { where: { deletedAt: null } } },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "REQUEST",
    entityId: requestId,
    entityRef: request.refNumber,
    description: `Updated course in request ${request.refNumber}`,
    descriptionAr: `تم تحديث دورة في طلب ${request.refNumber}`,
    req,
  });

  return ok(updated);
});

export const DELETE = withModuleAction("requests", "edit", async ({ params, user, req }) => {
  const requestId = params.id as string;
  const courseParamId = params.courseId as string;

  const request = await db.trainingRequest.findUnique({ where: { id: requestId } });
  if (!request || request.deletedAt) return notFound("Request not found");

  if (user.role === "CONTRACTOR") {
    if (request.companyId !== user.companyId) return fail("Forbidden", 403);
    if (!["DRAFT", "SUBMITTED", "REJECTED"].includes(request.status)) {
      return fail("Cannot modify courses on a request that has already entered review", 400);
    }
  }

  const rc = await db.trainingRequestCourse.findFirst({
    where: { requestId, deletedAt: null, OR: [{ id: courseParamId }, { courseId: courseParamId }] },
  });
  if (!rc) return notFound("Course not found in this request");

  await db.$transaction([
    db.trainingRequestCourseTrainee.updateMany({
      where: { requestCourseId: rc.id, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: user.id },
    }),
    db.trainingRequestCourse.update({
      where: { id: rc.id },
      data: { deletedAt: new Date(), updatedBy: user.id },
    }),
    db.trainingRequest.update({
      where: { id: requestId },
      data: { traineeCount: { decrement: rc.traineeCount }, updatedBy: user.id },
    }),
  ]);

  await audit({
    user,
    action: "DELETE",
    entity: "REQUEST",
    entityId: requestId,
    entityRef: request.refNumber,
    description: `Removed course from request ${request.refNumber}`,
    descriptionAr: `تم حذف دورة من طلب ${request.refNumber}`,
    req,
  });

  return ok({ success: true });
});
