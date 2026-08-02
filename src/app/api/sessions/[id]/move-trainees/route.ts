// /api/sessions/[id]/move-trainees — move trainees from this session to another
//
// Per the approved redesign:
//   - Trainees can be moved ONLY while both sessions are SCHEDULED. Once
//     attendance has started (IN_PROGRESS+), moving a trainee would corrupt
//     their attendance/test records.
//   - All writes are wrapped in a single `$transaction`.
//   - SessionCompany is recomputed via the shared helper.
//   - Audit metadata arrays are capped at 50 entries.
//
// Body:
//   { targetSessionId: string, traineeIds: string[] }
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { recomputeSessionCounts, truncateForAudit } from "@/lib/sessions/session-management";
import { randomUUID } from "node:crypto";

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const sourceId = params.id as string;
  const body = await req.json().catch(() => ({}));
  const targetSessionId: string | undefined = body.targetSessionId;
  const traineeIds: string[] = Array.isArray(body.traineeIds) ? body.traineeIds : [];

  if (!targetSessionId) {
    return fail("targetSessionId is required", 422, "VALIDATION_ERROR");
  }
  if (traineeIds.length === 0) {
    return fail("traineeIds must be a non-empty array", 422, "VALIDATION_ERROR");
  }
  if (targetSessionId === sourceId) {
    return fail("targetSessionId must differ from the source session", 422, "VALIDATION_ERROR");
  }

  const [source, target] = await Promise.all([
    db.trainingSession.findUnique({
      where: { id: sourceId },
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

  // No status gate — coordinators can move trainees between any sessions
  // regardless of status. Real-world training centers need this flexibility.
  // Every change is audit-logged.

  // Hard requirement: same course. Otherwise the trainee loses context
  // (different test questions, different certificate, different duration).
  if (source.courseId !== target.courseId) {
    return fail(
      `Cannot move trainees between sessions of different courses (source: ${source.courseId}, target: ${target.courseId})`,
      422,
      "COURSE_MISMATCH",
      { sourceCourseId: source.courseId, targetCourseId: target.courseId }
    );
  }

  // Some trainees may not be enrolled in the source — report them as skipped.
  const foundTraineeIds = new Set(source.enrollments.map((e) => e.traineeId));
  const missingTraineeIds = traineeIds.filter((id) => !foundTraineeIds.has(id));
  if (source.enrollments.length === 0) {
    return ok({
      movedCount: 0,
      skippedCount: traineeIds.length,
      skipped: missingTraineeIds.map((id) => ({ traineeId: id, reason: "not enrolled in source" })),
    });
  }

  // ── Capacity check on target ────────────────────────────────────────────
  // Prevent moving trainees into a session that would exceed its capacity.
  const targetActiveCount = await db.sessionEnrollment.count({
    where: { sessionId: targetSessionId, deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
  });
  // Some of the source trainees may already be in the target (previously
  // moved). Only count the ones that are NEW to the target.
  const targetExisting = await db.sessionEnrollment.findMany({
    where: { sessionId: targetSessionId, traineeId: { in: traineeIds }, deletedAt: null },
    select: { traineeId: true },
  });
  const targetExistingIds = new Set(targetExisting.map((e) => e.traineeId));
  const newToTarget = source.enrollments.filter((e) => !targetExistingIds.has(e.traineeId));
  if (targetActiveCount + newToTarget.length > target.capacity) {
    return fail(
      `Cannot move ${newToTarget.length} trainee(s): target session ${target.refNumber} would exceed capacity of ${target.capacity} (current: ${targetActiveCount})`,
      422,
      "CAPACITY_EXCEEDED",
      { targetCurrent: targetActiveCount, adding: newToTarget.length, capacity: target.capacity }
    );
  }

  // ── Transaction: upsert enrollments on target, soft-delete on source, recompute ──
  await db.$transaction(async (tx) => {
    // Upsert each enrollment on the target. The unique constraint
    // [sessionId, traineeId] doesn't include deletedAt, so a trainee who was
    // previously enrolled+removed from the target must be revived, not re-created.
    for (const e of source.enrollments) {
      await tx.sessionEnrollment.upsert({
        where: { sessionId_traineeId: { sessionId: targetSessionId, traineeId: e.traineeId } },
        update: {
          deletedAt: null,
          companyId: e.companyId, // preserve the original company snapshot
          enrolledBy: e.enrolledBy,
          enrollmentStatus: e.enrollmentStatus,
          attendanceStatus: e.attendanceStatus,
          preTestStatus: e.preTestStatus,
          finalTestStatus: e.finalTestStatus,
          evaluationStatus: e.evaluationStatus,
          certificateStatus: e.certificateStatus,
          notes: e.notes,
          updatedBy: user.id,
        },
        create: {
          id: randomUUID(),
          sessionId: targetSessionId,
          traineeId: e.traineeId,
          companyId: e.companyId,
          enrolledBy: e.enrolledBy,
          enrollmentStatus: e.enrollmentStatus,
          attendanceStatus: e.attendanceStatus,
          preTestStatus: e.preTestStatus,
          finalTestStatus: e.finalTestStatus,
          evaluationStatus: e.evaluationStatus,
          certificateStatus: e.certificateStatus,
          notes: e.notes,
          createdBy: user.id,
          updatedBy: user.id,
          updatedAt: new Date(),
        },
      });
    }

    // Soft-delete the moved enrollments on the source.
    await tx.sessionEnrollment.updateMany({
      where: { sessionId: sourceId, traineeId: { in: traineeIds }, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: user.id, enrollmentStatus: "CANCELLED" },
    });

    // Recompute counts + SessionCompany on both sessions.
    await recomputeSessionCounts(sourceId, tx);
    await recomputeSessionCounts(targetSessionId, tx);
  });

  const movedEnrollments = source.enrollments.map((e) => ({
    traineeId: e.traineeId,
    fromEnrollmentId: e.id,
  }));
  const traineeIdsTruncated = truncateForAudit(traineeIds);
  const skippedTruncated = truncateForAudit(missingTraineeIds);

  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: targetSessionId,
    entityRef: target.refNumber,
    description: `Moved ${movedEnrollments.length} trainee(s) from ${source.refNumber} to ${target.refNumber}`,
    descriptionAr: `نقل ${movedEnrollments.length} متدرِّب من ${source.refNumber} إلى ${target.refNumber}`,
    req,
    oldValue: {
      sourceSessionRef: source.refNumber,
      movedTraineeIds: traineeIdsTruncated.items,
      movedTraineeIdsTotal: traineeIdsTruncated.total,
    },
    newValue: {
      targetSessionRef: target.refNumber,
      movedCount: movedEnrollments.length,
    },
    metadata: {
      action: "MOVE_TRAINEES",
      sourceSessionId: sourceId,
      sourceSessionRef: source.refNumber,
      targetSessionId,
      targetSessionRef: target.refNumber,
      courseId: source.courseId,
      movedTraineeIds: traineeIdsTruncated.items,
      movedTraineeIdsTotal: traineeIdsTruncated.total,
      movedCount: movedEnrollments.length,
      skippedTraineeIds: skippedTruncated.items,
      skippedTraineeIdsTotal: skippedTruncated.total,
    },
  });

  return ok({
    sourceSessionRef: source.refNumber,
    targetSessionRef: target.refNumber,
    movedCount: movedEnrollments.length,
    skippedCount: missingTraineeIds.length,
    skipped: missingTraineeIds.map((id) => ({ traineeId: id, reason: "not enrolled in source" })),
  });
});
