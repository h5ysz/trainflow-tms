// /api/sessions/[id]/restore-trainee — restore a soft-deleted enrollment
//
// Per the ERP-flexibility requirements, the coordinator can restore a
// previously-removed trainee to a session. The enrollment's soft-delete
// is reversed (deletedAt=null, enrollmentStatus=CONFIRMED), and
// SessionCompany + expectedTrainees are recomputed.
//
// Body:
//   { traineeId: string }   // the trainee to restore
//
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";
import { recomputeSessionCounts } from "@/lib/sessions/session-management";

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const sessionId = params.id as string;
  const body = await req.json().catch(() => ({}));
  const { traineeId } = body;

  if (!traineeId) return fail("traineeId is required", 422, "VALIDATION_ERROR");

  const session = await db.trainingSession.findFirst({ where: { id: sessionId, deletedAt: null } });
  if (!session) return fail("Session not found", 404);
  if (trainerDeniedSession(user, session.trainerId)) {
    return fail("Forbidden — you can only access your own sessions", 403);
  }

  // Find the soft-deleted enrollment
  const enrollment = await db.sessionEnrollment.findFirst({
    where: { sessionId, traineeId, deletedAt: { not: null } },
  });

  if (!enrollment) {
    // Check if the trainee is already active
    const active = await db.sessionEnrollment.findFirst({
      where: { sessionId, traineeId, deletedAt: null },
    });
    if (active) {
      return fail("Trainee is already enrolled in this session", 400, "ALREADY_ENROLLED");
    }
    return notFound("No removed enrollment found for this trainee in this session");
  }

  // Restore the enrollment
  await db.$transaction(async (tx) => {
    await tx.sessionEnrollment.update({
      where: { id: enrollment.id },
      data: {
        deletedAt: null,
        enrollmentStatus: "CONFIRMED",
        updatedBy: user.id,
      },
    });
    await recomputeSessionCounts(sessionId, tx);
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: sessionId,
    entityRef: session.refNumber,
    description: `Restored trainee ${traineeId} to session ${session.refNumber}`,
    descriptionAr: `إعادة متدرِّب ${traineeId} إلى الجلسة ${session.refNumber}`,
    req,
    oldValue: { enrollmentId: enrollment.id, enrollmentStatus: "CANCELLED", deletedAt: enrollment.deletedAt },
    newValue: { enrollmentId: enrollment.id, enrollmentStatus: "CONFIRMED", deletedAt: null },
    metadata: {
      action: "RESTORE_TRAINEE",
      sessionId,
      sessionRef: session.refNumber,
      traineeId,
      enrollmentId: enrollment.id,
    },
  });

  return ok({
    sessionId,
    sessionRef: session.refNumber,
    traineeId,
    enrollmentId: enrollment.id,
    restored: true,
  });
});
