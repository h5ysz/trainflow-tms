// /api/sessions/[id]/enrollments/bulk-remove — remove multiple trainees at once
//
// Per the coordinator full-flexibility requirements, the coordinator can
// remove multiple trainees from a session in a single operation.
//
// Body:
//   { enrollmentIds: string[] }   // the SessionEnrollment IDs to remove
//
// Soft-deletes each enrollment (sets deletedAt + CANCELLED), then recomputes
// SessionCompany + expectedTrainees. Full audit with before/after.
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";
import { recomputeSessionCounts, truncateForAudit } from "@/lib/sessions/session-management";

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const sessionId = params.id as string;
  const body = await req.json().catch(() => ({}));
  const { enrollmentIds } = body;

  if (!Array.isArray(enrollmentIds) || enrollmentIds.length === 0) {
    return fail("enrollmentIds must be a non-empty array", 422, "VALIDATION_ERROR");
  }

  const session = await db.trainingSession.findFirst({ where: { id: sessionId, deletedAt: null } });
  if (!session) return fail("Session not found", 404);
  if (trainerDeniedSession(user, session.trainerId)) {
    return fail("Forbidden — you can only access your own sessions", 403);
  }

  // Load the enrollments to be removed (for audit before/after)
  const enrollments = await db.sessionEnrollment.findMany({
    where: { id: { in: enrollmentIds }, sessionId, deletedAt: null },
    select: { id: true, traineeId: true, companyId: true, enrollmentStatus: true },
  });

  if (enrollments.length === 0) {
    return fail("No active enrollments found for the given IDs", 404, "NOT_FOUND");
  }

  // Soft-delete + recompute in a transaction
  await db.$transaction(async (tx) => {
    await tx.sessionEnrollment.updateMany({
      where: { id: { in: enrollmentIds }, sessionId, deletedAt: null },
      data: { deletedAt: new Date(), enrollmentStatus: "CANCELLED", updatedBy: user.id },
    });
    await recomputeSessionCounts(sessionId, tx);
  });

  const removedIdsTruncated = truncateForAudit(enrollments.map((e) => e.id));

  await audit({
    user,
    action: "DELETE",
    entity: "SESSION",
    entityId: sessionId,
    entityRef: session.refNumber,
    description: `Bulk-removed ${enrollments.length} trainee(s) from session ${session.refNumber}`,
    descriptionAr: `إزالة جماعية لـ ${enrollments.length} متدرِّب من الجلسة ${session.refNumber}`,
    req,
    oldValue: { removedEnrollmentIds: removedIdsTruncated.items, removedEnrollmentIdsTotal: removedIdsTruncated.total },
    metadata: {
      action: "BULK_REMOVE_TRAINEES",
      sessionId,
      sessionRef: session.refNumber,
      removedEnrollmentIds: removedIdsTruncated.items,
      removedEnrollmentIdsTotal: removedIdsTruncated.total,
      removedCount: enrollments.length,
    },
  });

  return ok({
    removedCount: enrollments.length,
    skippedCount: enrollmentIds.length - enrollments.length,
  });
});
