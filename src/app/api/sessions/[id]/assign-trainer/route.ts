// /api/sessions/[id]/assign-trainer — dedicated endpoint for trainer assignment
// Validates: role (Coordinator/SuperAdmin), certification, scheduling conflicts.
//
// Per the redesigned workflow, the coordinator can also REMOVE a trainer
// (set trainerId to null) so the session becomes unassigned again. The
// body shape is `{ trainerId: string | null }`. Sending `null` or omitting
// `trainerId` is interpreted as "remove the current trainer".
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { validateTrainerAssignment, validationErrorToResponse, findTrainerConflicts } from "@/lib/api/trainer-assignment";

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const trainerId: string | null = body.trainerId ?? null;

  const session = await db.trainingSession.findUnique({ where: { id } });
  if (!session || session.deletedAt) return notFound("Session not found");

  const previousTrainerId = session.trainerId;

  // ── Remove path ───────────────────────────────────────────────────────────
  // trainerId is null (or omitted) → clear the trainer. We do NOT validate
  // anything for removal — the coordinator is always allowed to unassign.
  if (!trainerId) {
    if (!previousTrainerId) {
      // Already unassigned — no-op, but return success so the UI doesn't
      // surface a confusing error.
      return ok({
        sessionId: session.id,
        sessionRef: session.refNumber,
        trainerId: null,
        trainerName: null,
        trainerRef: null,
      });
    }
    const previousTrainer = await db.trainer.findUnique({
      where: { id: previousTrainerId },
      select: { fullName: true, refNumber: true },
    });
    const updated = await db.trainingSession.update({
      where: { id },
      data: { trainerId: null, updatedBy: user.id },
      include: {
        trainer: { select: { id: true, fullName: true, refNumber: true } },
        course: { select: { id: true, title: true, code: true } },
      },
    });
    await audit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: id,
      entityRef: updated.refNumber,
      description: `Removed trainer ${previousTrainer?.fullName ?? previousTrainerId} from session ${updated.refNumber}`,
      descriptionAr: `إزالة المدرب ${previousTrainer?.fullName ?? previousTrainerId} من الجلسة ${updated.refNumber}`,
      req,
      oldValue: { trainerId: previousTrainerId },
      newValue: { trainerId: null },
      metadata: {
        action: "REMOVE_TRAINER",
        previousTrainerId,
        newTrainerId: null,
        courseId: session.courseId,
        startDate: session.startDate,
        endDate: session.endDate,
      },
    });
    return ok({
      sessionId: updated.id,
      sessionRef: updated.refNumber,
      trainerId: null,
      trainerName: null,
      trainerRef: null,
    });
  }

  // ── Assign path ───────────────────────────────────────────────────────────
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

  const updated = await db.trainingSession.update({
    where: { id },
    data: { trainerId, updatedBy: user.id },
    include: {
      trainer: { select: { id: true, fullName: true, refNumber: true } },
      course: { select: { id: true, title: true, code: true } },
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Assigned trainer ${trainer.fullName} (${trainer.refNumber}) to session ${updated.refNumber}`,
    descriptionAr: `تعيين المدرب ${trainer.fullName} (${trainer.refNumber}) للجلسة ${updated.refNumber}`,
    req,
    oldValue: previousTrainerId ? { trainerId: previousTrainerId } : null,
    newValue: { trainerId },
    metadata: {
      action: previousTrainerId ? "REPLACE_TRAINER" : "ASSIGN_TRAINER",
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
    trainerName: updated.trainer?.fullName ?? null,
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
