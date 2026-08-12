// /api/sessions/[id]/replace-trainee — replace one trainee with another in a
// single atomic operation. The old enrollment is soft-deleted (CANCELLED) and
// the new trainee is enrolled in the same session, preserving the session
// capacity and counts.
//
// Body:
//   { oldTraineeId: string, newTraineeId: string, reason?: string }
//
// RBAC: requires `sessions.edit` permission (coordinators + trainers with the
// permission). Contractors are blocked by withModuleAction.
//
// Audit: logged as action "REPLACE_TRAINEE" with old + new trainee IDs.
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";
import { recomputeSessionCounts, truncateForAudit } from "@/lib/sessions/session-management";
import { randomUUID } from "node:crypto";

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const sessionId = params.id as string;
  const body = await req.json().catch(() => ({}));
  const oldTraineeId: string | undefined = body.oldTraineeId;
  const newTraineeId: string | undefined = body.newTraineeId;
  const reason: string | undefined = body.reason;

  if (!oldTraineeId || !newTraineeId) {
    return fail("oldTraineeId and newTraineeId are required", 422, "VALIDATION_ERROR");
  }
  if (oldTraineeId === newTraineeId) {
    return fail("oldTraineeId and newTraineeId must differ", 422, "VALIDATION_ERROR");
  }

  // Fetch the session + old enrollment + new trainee in parallel.
  const [session, oldEnrollment, newTrainee] = await Promise.all([
    db.trainingSession.findFirst({ where: { id: sessionId, deletedAt: null } }),
    db.sessionEnrollment.findFirst({
      where: { sessionId, traineeId: oldTraineeId, deletedAt: null },
    }),
    db.trainee.findFirst({
      where: { id: newTraineeId, deletedAt: null },
      include: { company: { select: { id: true, name: true, refNumber: true } } },
    }),
  ]);

  if (!session) return notFound("Session not found");
  if (trainerDeniedSession(user, session.trainerId)) {
    return fail("Forbidden — you can only access your own sessions", 403);
  }
  if (!oldEnrollment) return notFound("Trainee is not enrolled in this session");
  if (!newTrainee) return fail("New trainee not found", 404);

  // Block replacement if certificates have already been issued for the old
  // trainee — once a certificate exists, the result is locked.
  if (oldEnrollment.certificateStatus === "ISSUED") {
    return fail(
      "Cannot replace trainee: certificate already issued for this enrollment. Results are locked once certificates are issued.",
      422,
      "CERTIFICATE_LOCKED",
    );
  }

  // Check if the new trainee is already enrolled in this session (active).
  const existingNew = await db.sessionEnrollment.findFirst({
    where: { sessionId, traineeId: newTraineeId, deletedAt: null },
  });
  if (existingNew) {
    return fail(
      "New trainee is already enrolled in this session",
      422,
      "ALREADY_ENROLLED",
    );
  }

  // Atomic transaction: soft-delete old enrollment, upsert new enrollment,
  // recompute session counts.
  await db.$transaction(async (tx) => {
    // 1. Soft-delete the old enrollment.
    await tx.sessionEnrollment.update({
      where: { id: oldEnrollment.id },
      data: {
        deletedAt: new Date(),
        enrollmentStatus: "REPLACED",
        updatedBy: user.id,
      },
    });

    // 2. Upsert the new trainee's enrollment. The unique constraint
    // [sessionId, traineeId] doesn't include deletedAt, so a trainee who was
    // previously enrolled+removed must be revived, not re-created.
    const now = new Date();
    await tx.sessionEnrollment.upsert({
      where: { sessionId_traineeId: { sessionId, traineeId: newTraineeId } },
      update: {
        deletedAt: null,
        companyId: newTrainee.companyId,
        enrolledBy: user.id,
        enrollmentStatus: "ENROLLED",
        attendanceStatus: "NOT_STARTED",
        preTestStatus: "NOT_STARTED",
        finalTestStatus: "NOT_STARTED",
        evaluationStatus: "NOT_STARTED",
        certificateStatus: "NOT_ISSUED",
        notes: reason ? `Replaced ${oldEnrollment.traineeId} — ${reason}` : null,
        updatedBy: user.id,
      },
      create: {
        id: randomUUID(),
        sessionId,
        traineeId: newTraineeId,
        companyId: newTrainee.companyId,
        enrolledBy: user.id,
        enrollmentStatus: "ENROLLED",
        attendanceStatus: "NOT_STARTED",
        preTestStatus: "NOT_STARTED",
        finalTestStatus: "NOT_STARTED",
        evaluationStatus: "NOT_STARTED",
        certificateStatus: "NOT_ISSUED",
        notes: reason ? `Replaced ${oldEnrollment.traineeId} — ${reason}` : null,
        createdBy: user.id,
        updatedBy: user.id,
        updatedAt: now,
      },
    });

    // 3. Recompute session counts + SessionCompany rows.
    await recomputeSessionCounts(sessionId, tx);
  });

  // Fetch trainee names for the audit log.
  const [oldTrainee, _] = await Promise.all([
    db.trainee.findUnique({ where: { id: oldTraineeId }, select: { fullName: true, nationalId: true } }),
    Promise.resolve(),
  ]);

  const auditOld = truncateForAudit([oldTraineeId]);
  const auditNew = truncateForAudit([newTraineeId]);

  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: sessionId,
    entityRef: session.refNumber,
    description: `Replaced trainee ${oldTrainee?.fullName ?? oldTraineeId} with ${newTrainee.fullName} in session ${session.refNumber}`,
    descriptionAr: `استبدال المتدرب ${oldTrainee?.fullName ?? oldTraineeId} بـ ${newTrainee.fullName} في الجلسة ${session.refNumber}`,
    req,
    oldValue: {
      traineeId: oldTraineeId,
      traineeName: oldTrainee?.fullName ?? null,
      traineeNationalId: oldTrainee?.nationalId ?? null,
      enrollmentId: oldEnrollment.id,
    },
    newValue: {
      traineeId: newTraineeId,
      traineeName: newTrainee.fullName,
      traineeNationalId: newTrainee.nationalId,
      companyId: newTrainee.companyId,
      companyName: newTrainee.company?.name ?? null,
    },
    metadata: {
      action: "REPLACE_TRAINEE",
      sessionId,
      sessionRef: session.refNumber,
      oldTraineeId: auditOld.items[0],
      newTraineeId: auditNew.items[0],
      reason: reason ?? null,
    },
  });

  return ok({
    sessionId,
    sessionRef: session.refNumber,
    oldTraineeId,
    oldTraineeName: oldTrainee?.fullName ?? null,
    newTraineeId,
    newTraineeName: newTrainee.fullName,
    reason: reason ?? null,
  });
});
