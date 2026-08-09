// /api/sessions/[id]/assign-trainer — dedicated endpoint for trainer assignment
// Validates: role (Coordinator/SuperAdmin), certification, scheduling conflicts
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { validateTrainerAssignment, validationErrorToResponse, findTrainerConflicts } from "@/lib/api/trainer-assignment";

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const { trainerId } = body;

  if (!trainerId) return fail("trainerId is required", 422, "VALIDATION_ERROR");

  const session = await db.trainingSession.findUnique({ where: { id } });
  if (!session || session.deletedAt) return notFound("Session not found");

  const trainer = await db.trainer.findFirst({ where: { id: trainerId, deletedAt: null } });
  if (!trainer) return fail("Trainer not found", 404);

  // Run full validation: role + certification + conflict
  const validation = await validateTrainerAssignment({
    user,
    trainerId,
    courseId: session.courseId,
    startDate: session.startDate,
    endDate: session.endDate,
    excludeSessionId: id, // exclude this session from conflict check (it's being assigned)
  });
  if (!validation.valid) {
    return validationErrorToResponse(validation);
  }

  const previousTrainerId = session.trainerId;
  const updated = await db.trainingSession.update({
    where: { id },
    data: { trainerId, updatedBy: user.id },
    include: {
      trainer: { select: { id: true, nameEn: true, refNumber: true } },
      course: { select: { id: true, title: true, code: true } },
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Assigned trainer ${trainer.nameEn} (${trainer.refNumber}) to session ${updated.refNumber}`,
    descriptionAr: `تعيين المدرب ${trainer.nameEn} (${trainer.refNumber}) للجلسة ${updated.refNumber}`,
    req,
    metadata: {
      previousTrainerId,
      newTrainerId: trainerId,
      courseId: session.courseId,
      startDate: session.startDate,
      endDate: session.endDate,
    },
  });

  return ok({
    sessionId: updated.id,
    sessionRef: updated.refNumber,
    trainerId: updated.trainerId,
    trainerName: updated.trainer?.nameEn ?? null,
    trainerRef: updated.trainer?.refNumber ?? null,
  });
});

// GET endpoint — preview conflicts for a trainer on this session's timeslot
export const GET = withModuleAction("sessions", "view", async ({ req, params }) => {
  const id = params.id as string;
  const session = await db.trainingSession.findUnique({ where: { id } });
  if (!session || session.deletedAt) return notFound("Session not found");

  const url = new URL(req.url);
  const trainerId = url.searchParams.get("trainerId");
  if (!trainerId) return fail("trainerId query parameter is required", 422, "VALIDATION_ERROR");

  const conflicts = await findTrainerConflicts(
    trainerId,
    session.startDate,
    session.endDate,
    id // exclude this session
  );

  return ok({
    trainerId,
    sessionId: id,
    sessionRef: session.refNumber,
    startDate: session.startDate,
    endDate: session.endDate,
    hasConflicts: conflicts.length > 0,
    conflicts,
  });
});
