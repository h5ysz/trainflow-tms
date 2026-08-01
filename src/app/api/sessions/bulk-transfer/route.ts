// /api/sessions/bulk-transfer — transfer multiple trainees between sessions at once
//
// Per the coordinator full-session-management requirements, the coordinator
// can transfer multiple trainees from one session to another in a single
// operation. This is equivalent to calling move-trainees for each, but
// atomic — either all transfers succeed or none do.
//
// Body:
//   {
//     sourceSessionId: string,      // required
//     targetSessionId: string,      // required
//     traineeIds: string[],         // required, non-empty
//   }
//
// Both sessions must:
//   - Exist and not be soft-deleted
//   - Share the same courseId (can't transfer between different courses)
//   - Be in SCHEDULED status (can't transfer after attendance starts)
//
// The target session must have capacity for all new trainees.
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { recomputeSessionCounts, truncateForAudit } from "@/lib/sessions/session-management";

export const POST = withModuleAction("sessions", "edit", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { sourceSessionId, targetSessionId, traineeIds } = body;

  if (!sourceSessionId || !targetSessionId) {
    return fail("sourceSessionId and targetSessionId are required", 422, "VALIDATION_ERROR");
  }
  if (sourceSessionId === targetSessionId) {
    return fail("sourceSessionId must differ from targetSessionId", 422, "VALIDATION_ERROR");
  }
  if (!Array.isArray(traineeIds) || traineeIds.length === 0) {
    return fail("traineeIds must be a non-empty array", 422, "VALIDATION_ERROR");
  }

  const [source, target] = await Promise.all([
    db.trainingSession.findUnique({
      where: { id: sourceSessionId },
      include: {
        enrollments: {
          where: { deletedAt: null, traineeId: { in: traineeIds } },
        },
      },
    }),
    db.trainingSession.findUnique({ where: { id: targetSessionId } }),
  ]);

  if (!source || source.deletedAt) return notFound("Source session not found");
  if (!target || target.deletedAt) return notFound("Target session not found");

  // No status gate — coordinators can transfer between any sessions.
  // Every change is audit-logged.

  // Must be the same course
  if (source.courseId !== target.courseId) {
    return fail(`Cannot transfer between sessions of different courses`, 422, "COURSE_MISMATCH", { sourceCourseId: source.courseId, targetCourseId: target.courseId });
  }

  // Find which trainees are actually enrolled in the source
  const foundTraineeIds = new Set(source.enrollments.map((e) => e.traineeId));
  const missingTraineeIds = traineeIds.filter((id: string) => !foundTraineeIds.has(id));
  const sourceEnrollments = source.enrollments;

  if (sourceEnrollments.length === 0) {
    return ok({
      movedCount: 0,
      skippedCount: traineeIds.length,
      skipped: missingTraineeIds.map((id: string) => ({ traineeId: id, reason: "not enrolled in source" })),
    });
  }

  // Capacity check on target — only count trainees that are NEW to the target
  const targetActiveCount = await db.sessionEnrollment.count({
    where: { sessionId: targetSessionId, deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
  });
  const targetExisting = await db.sessionEnrollment.findMany({
    where: { sessionId: targetSessionId, traineeId: { in: traineeIds }, deletedAt: null },
    select: { traineeId: true },
  });
  const targetExistingIds = new Set(targetExisting.map((e) => e.traineeId));
  const newToTarget = sourceEnrollments.filter((e) => !targetExistingIds.has(e.traineeId));
  if (targetActiveCount + newToTarget.length > target.capacity) {
    return fail(`Cannot transfer ${newToTarget.length} trainee(s): target session ${target.refNumber} would exceed capacity of ${target.capacity} (current: ${targetActiveCount})`, 422, "CAPACITY_EXCEEDED", { targetCurrent: targetActiveCount, adding: newToTarget.length, capacity: target.capacity });
  }

  // ── Transaction: upsert on target, soft-delete on source, recompute ──
  await db.$transaction(async (tx) => {
    for (const e of sourceEnrollments) {
      await tx.sessionEnrollment.upsert({
        where: { sessionId_traineeId: { sessionId: targetSessionId, traineeId: e.traineeId } },
        update: { deletedAt: null, companyId: e.companyId, enrollmentStatus: e.enrollmentStatus, attendanceStatus: e.attendanceStatus, preTestStatus: e.preTestStatus, finalTestStatus: e.finalTestStatus, evaluationStatus: e.evaluationStatus, certificateStatus: e.certificateStatus, notes: e.notes, updatedBy: user.id },
        create: { sessionId: targetSessionId, traineeId: e.traineeId, companyId: e.companyId, enrolledBy: e.enrolledBy, enrollmentStatus: e.enrollmentStatus, attendanceStatus: e.attendanceStatus, preTestStatus: e.preTestStatus, finalTestStatus: e.finalTestStatus, evaluationStatus: e.evaluationStatus, certificateStatus: e.certificateStatus, notes: e.notes, createdBy: user.id, updatedBy: user.id },
      });
    }
    await tx.sessionEnrollment.updateMany({
      where: { sessionId: sourceSessionId, traineeId: { in: traineeIds }, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: user.id, enrollmentStatus: "CANCELLED" },
    });
    await recomputeSessionCounts(sourceSessionId, tx);
    await recomputeSessionCounts(targetSessionId, tx);
  }, { timeout: 30000, maxWait: 60000 });

  const traineeIdsTruncated = truncateForAudit(traineeIds as string[]);
  const skippedTruncated = truncateForAudit(missingTraineeIds as string[]);

  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: targetSessionId,
    entityRef: target.refNumber,
    description: `Bulk-transferred ${sourceEnrollments.length} trainee(s) from ${source.refNumber} to ${target.refNumber}`,
    descriptionAr: `نقل جماعي لـ ${sourceEnrollments.length} متدرِّب من ${source.refNumber} إلى ${target.refNumber}`,
    req,
    oldValue: { sourceSessionRef: source.refNumber, movedTraineeIds: traineeIdsTruncated.items, movedTraineeIdsTotal: traineeIdsTruncated.total },
    newValue: { targetSessionRef: target.refNumber, movedCount: sourceEnrollments.length },
    metadata: {
      action: "BULK_TRANSFER",
      sourceSessionId,
      sourceSessionRef: source.refNumber,
      targetSessionId,
      targetSessionRef: target.refNumber,
      courseId: source.courseId,
      movedTraineeIds: traineeIdsTruncated.items,
      movedTraineeIdsTotal: traineeIdsTruncated.total,
      movedCount: sourceEnrollments.length,
      skippedTraineeIds: skippedTruncated.items,
      skippedTraineeIdsTotal: skippedTruncated.total,
    },
  });

  return ok({
    sourceSessionRef: source.refNumber,
    targetSessionRef: target.refNumber,
    movedCount: sourceEnrollments.length,
    skippedCount: missingTraineeIds.length,
    skipped: (missingTraineeIds as string[]).map((id) => ({ traineeId: id, reason: "not enrolled in source" })),
  });
});
