// /api/sessions/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { recordStatusChange } from "@/lib/auth/audit";
import { validateTrainerAssignment, validationErrorToResponse } from "@/lib/api/trainer-assignment";

export const GET = withModuleAction("sessions", "view", async ({ params, user }) => {
  const id = params.id as string;
  const session = await db.trainingSession.findUnique({
    where: { id },
    include: {
      course: true,
      trainer: true,
      request: { include: { company: true } },
      requestCourse: { include: { course: true } },
      attendance: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
      _count: { select: { attendance: true, certificates: true, testResults: true, evaluations: true } },
    },
  });
  if (!session || session.deletedAt) return notFound("Session not found");

  // Coordinator and Trainer have equivalent operational permissions — no trainer scoping

  return ok(session);
});

export const PUT = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.trainingSession.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Session not found");

  // Coordinator and Trainer have equivalent operational permissions — no trainer scoping

  const {
    courseId, trainerId, title, location, city, region, venue, shift, durationHours, capacity, language,
    startDate, endDate, status, notes,
    instituteName, classification, locationMapUrl, durationDays,
  } = body;

  // No status transition validation — coordinators can set any status at
  // any time. Every change is audit-logged.

  // Determine the effective courseId (may be changing)
  const newCourseId = courseId !== undefined ? courseId : existing.courseId;

  // If trainer is being changed (or dates changing with a trainer set), validate assignment
  const newTrainerId = trainerId !== undefined ? trainerId : existing.trainerId;
  const newStartDate = startDate ? new Date(startDate) : existing.startDate;
  const newEndDate = endDate ? new Date(endDate) : existing.endDate;

  if (newTrainerId && (trainerId !== undefined || startDate !== undefined || endDate !== undefined || courseId !== undefined)) {
    // Skip conflict check if trainer is unchanged AND dates unchanged AND course unchanged
    const isTrainerChanging = trainerId !== undefined && trainerId !== existing.trainerId;
    const areDatesChanging = (startDate !== undefined && newStartDate.getTime() !== existing.startDate.getTime())
                          || (endDate !== undefined && newEndDate.getTime() !== existing.endDate.getTime());

    if (isTrainerChanging || areDatesChanging) {
      const validation = await validateTrainerAssignment({
        user,
        trainerId: newTrainerId,
        courseId: newCourseId,
        startDate: newStartDate,
        endDate: newEndDate,
        excludeSessionId: id,
      });
      if (!validation.valid) {
        return validationErrorToResponse(validation);
      }
    }
  }

  // Note: `expectedTrainees` and `actualTrainees` are NOT settable via PUT.
  // They are derived from SessionEnrollment counts (recomputeSessionCounts)
  // and Attendance records respectively. Allowing direct mutation would
  // desync the cached values from the source of truth.
  const updated = await db.trainingSession.update({
    where: { id },
    data: {
      ...(courseId !== undefined && { courseId }),
      ...(trainerId !== undefined && { trainerId }),
      ...(title !== undefined && { title }),
      ...(location !== undefined && { location }),
      ...(city !== undefined && { city }),
      ...(region !== undefined && { region }),
      ...(venue !== undefined && { venue }),
      ...(shift !== undefined && { shift }),
      ...(durationHours !== undefined && { durationHours }),
      ...(capacity !== undefined && { capacity }),
      ...(language !== undefined && { language }),
      ...(startDate !== undefined && { startDate: new Date(startDate) }),
      ...(endDate !== undefined && { endDate: new Date(endDate) }),
      ...(status !== undefined && { status }),
      ...(notes !== undefined && { notes }),
      ...(instituteName !== undefined && { instituteName }),
      ...(classification !== undefined && { classification }),
      ...(locationMapUrl !== undefined && { locationMapUrl }),
      ...(durationDays !== undefined && { durationDays }),
      updatedBy: user.id,
    },
  });

  if (status && status !== existing.status) {
    await recordStatusChange({
      user,
      entity: "SESSION",
      entityId: id,
      entityRef: existing.refNumber,
      fromStatus: existing.status,
      toStatus: status,
      req,
    });
  } else {
    await audit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: id,
      entityRef: existing.refNumber,
      description: `Updated session ${existing.refNumber}`,
      descriptionAr: `تم تحديث جلسة ${existing.refNumber}`,
      req,
      oldValue: existing,
      newValue: updated,
    });
  }

  return ok(updated);
});

export const DELETE = withModuleAction("sessions", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.trainingSession.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Session not found");

  const certs = await db.certificate.count({ where: { sessionId: id, deletedAt: null } });
  if (certs > 0) return fail("Cannot delete a session with issued certificates", 400);

  await db.trainingSession.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  // Unlink request if any
  if (existing.requestId) {
    await db.trainingRequest.update({
      where: { id: existing.requestId },
      data: { status: "APPROVED", updatedBy: user.id },
    });
  }

  await audit({
    user,
    action: "DELETE",
    entity: "SESSION",
    entityId: id,
    entityRef: existing.refNumber,
    description: `Deleted session ${existing.refNumber}`,
    descriptionAr: `تم حذف جلسة ${existing.refNumber}`,
    req,
  });

  return ok({ success: true });
});
