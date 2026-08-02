// /api/retests/[id] — get, schedule, reschedule, cancel, record-result
//
// GET:    get a single retest by ID
// POST:   schedule or reschedule a retest (action in body)
// DELETE: cancel a retest
// PUT:    record the retest result (passed/failed) — called when the
//         retest exam attempt is graded.
//
// The POST handler supports these actions via body.action:
//   "schedule"    → initial scheduling (PENDING_RETEST → SCHEDULED)
//   "reschedule"  → change the schedule (SCHEDULED/RESCHEDULED → RESCHEDULED)
//
// RBAC:
//   - schedule/reschedule/cancel: Trainer + Coordinator (sessions.edit)
//   - retestTrainerId change: Coordinator ONLY (administrative decision).
//     If a Trainer tries to change the trainer, return 403.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit, ApiError } from "@/lib/auth/api";
import { notifyContractors } from "@/lib/retest/notifications";
import { recomputeSessionCounts } from "@/lib/sessions/session-management";
import { randomUUID } from "node:crypto";

export const GET = withModuleAction("sessions", "view", async ({ params }) => {
  const id = params.id as string;
  const retest = await db.retestRequest.findUnique({ where: { id } });
  if (!retest || retest.deletedAt) return notFound("Retest not found");
  return ok(retest);
});

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const { action } = body;

  if (action !== "schedule" && action !== "reschedule") {
    return fail("action must be 'schedule' or 'reschedule'", 422, "VALIDATION_ERROR");
  }

  const retest = await db.retestRequest.findUnique({ where: { id } });
  if (!retest || retest.deletedAt) return notFound("Retest not found");

  // Trainer Immediate Opportunities are auto-scheduled on creation and
  // cannot be rescheduled (they happen immediately in the same session).
  if (retest.retestType === "TRAINER_OPPORTUNITY") {
    return fail(
      "Trainer immediate opportunities cannot be scheduled or rescheduled. They happen immediately in the current session.",
      422,
      "CANNOT_RESCHEDULE_TRAINER_OPPORTUNITY",
    );
  }

  // ── Status gate ─────────────────────────────────────────────────────────
  if (action === "schedule" && retest.status !== "PENDING_RETEST") {
    return fail(
      `Cannot schedule: retest status is ${retest.status}. Only PENDING_RETEST retests can be scheduled.`,
      422,
      "INVALID_STATUS",
    );
  }
  if (action === "reschedule" && !["SCHEDULED", "RESCHEDULED"].includes(retest.status)) {
    return fail(
      `Cannot reschedule: retest status is ${retest.status}. Only SCHEDULED or RESCHEDULED retests can be rescheduled.`,
      422,
      "INVALID_STATUS",
    );
  }

  // ── Extract scheduling fields ───────────────────────────────────────────
  const {
    retestSessionId,
    retestTrainerId,
    retestDate,
    retestShift,
    retestLocation,
    retestVenue,
    reason,
    moveTrainee,
  } = body;

  // ── RBAC: Only Coordinator can change the trainer ───────────────────────
  // Changing the trainer is an administrative decision. Trainers can
  // schedule/reschedule everything EXCEPT the trainer assignment.
  if (retestTrainerId && retestTrainerId !== retest.retestTrainerId) {
    if (user.role !== "COORDINATOR" && user.role !== "SUPER_ADMIN") {
      return fail(
        "Forbidden — only coordinators can change the trainer. Trainers can schedule the session, date, time, and room, but not assign a different trainer.",
        403,
        "TRAINER_CHANGE_FORBIDDEN",
      );
    }
  }

  // Capture old values for audit
  const oldSchedule = {
    retestSessionId: retest.retestSessionId,
    retestTrainerId: retest.retestTrainerId,
    retestDate: retest.retestDate,
    retestShift: retest.retestShift,
    retestLocation: retest.retestLocation,
    retestVenue: retest.retestVenue,
  };

  const now = new Date();
  const newStatus = action === "schedule" ? "SCHEDULED" : "RESCHEDULED";

  // ── Update the retest ───────────────────────────────────────────────────
  const updated = await db.retestRequest.update({
    where: { id },
    data: {
      retestSessionId: retestSessionId ?? retest.retestSessionId,
      retestTrainerId: retestTrainerId ?? retest.retestTrainerId,
      retestDate: retestDate ? new Date(retestDate) : retest.retestDate,
      retestShift: retestShift ?? retest.retestShift,
      retestLocation: retestLocation ?? retest.retestLocation,
      retestVenue: retestVenue ?? retest.retestVenue,
      status: newStatus,
      scheduledBy: action === "schedule" ? user.id : retest.scheduledBy,
      scheduledAt: action === "schedule" ? now : retest.scheduledAt,
      reason: reason ?? retest.reason,
      updatedBy: user.id,
      updatedAt: now,
    },
  });

  // ── Move trainee to a different session if requested ────────────────────
  if (moveTrainee && retestSessionId && retestSessionId !== retest.sessionId) {
    const oldEnrollment = await db.sessionEnrollment.findUnique({
      where: { id: retest.enrollmentId },
    });
    if (oldEnrollment && !oldEnrollment.deletedAt) {
      await db.$transaction(async (tx) => {
        await tx.sessionEnrollment.update({
          where: { id: oldEnrollment.id },
          data: {
            deletedAt: now,
            enrollmentStatus: "MOVED",
            updatedBy: user.id,
          },
        });

        await tx.sessionEnrollment.upsert({
          where: {
            sessionId_traineeId: {
              sessionId: retestSessionId,
              traineeId: oldEnrollment.traineeId,
            },
          },
          update: {
            deletedAt: null,
            companyId: oldEnrollment.companyId,
            enrolledBy: oldEnrollment.enrolledBy,
            enrollmentStatus: "ENROLLED",
            updatedBy: user.id,
          },
          create: {
            id: randomUUID(),
            sessionId: retestSessionId,
            traineeId: oldEnrollment.traineeId,
            companyId: oldEnrollment.companyId,
            enrolledBy: oldEnrollment.enrolledBy,
            enrollmentStatus: "ENROLLED",
            createdBy: user.id,
            updatedBy: user.id,
            updatedAt: now,
          },
        });

        await recomputeSessionCounts(retest.sessionId, tx);
        await recomputeSessionCounts(retestSessionId, tx);
      });
    }
  }

  // ── Notify contractor (OFFICIAL retests only) ───────────────────────────
  if (retest.retestType === "OFFICIAL" && retest.companyId) {
    await notifyContractors(
      {
        companyId: retest.companyId,
        traineeName: retest.traineeName,
        retestRef: retest.refNumber,
        retestDate: updated.retestDate,
      },
      action === "schedule" ? "RETEST_SCHEDULED" : "RETEST_RESCHEDULED",
    );
  }

  // ── Audit log ───────────────────────────────────────────────────────────
  await audit({
    user,
    action: "UPDATE",
    entity: "RETEST",
    entityId: retest.id,
    entityRef: retest.refNumber,
    description: `${action === "schedule" ? "Scheduled" : "Rescheduled"} retest ${retest.refNumber} for ${retest.traineeName}${reason ? ` — ${reason}` : ""}`,
    descriptionAr: `${action === "schedule" ? "تمت جدولة" : "تمت إعادة جدولة"} إعادة الاختبار ${retest.refNumber} للمتدرب ${retest.traineeName}${reason ? ` — ${reason}` : ""}`,
    req,
    oldValue: oldSchedule,
    newValue: {
      retestSessionId: updated.retestSessionId,
      retestTrainerId: updated.retestTrainerId,
      retestDate: updated.retestDate,
      retestShift: updated.retestShift,
      retestLocation: updated.retestLocation,
      retestVenue: updated.retestVenue,
      status: updated.status,
    },
    metadata: {
      action: action === "schedule" ? "RETEST_SCHEDULED" : "RETEST_RESCHEDULED",
      retestId: retest.id,
      retestRef: retest.refNumber,
      traineeName: retest.traineeName,
      moveTrainee: moveTrainee ?? false,
      targetSessionId: retestSessionId ?? null,
      trainerChanged: retestTrainerId && retestTrainerId !== retest.retestTrainerId ? true : false,
      reason: reason ?? null,
    },
  });

  return ok(updated);
});

export const DELETE = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const { cancellationReason } = body;

  const retest = await db.retestRequest.findUnique({ where: { id } });
  if (!retest || retest.deletedAt) return notFound("Retest not found");

  if (retest.status === "COMPLETED") {
    return fail("Cannot cancel a completed retest", 422, "INVALID_STATUS");
  }
  if (retest.status === "CANCELLED") {
    return fail("Retest is already cancelled", 422, "ALREADY_CANCELLED");
  }

  const now = new Date();
  const updated = await db.retestRequest.update({
    where: { id },
    data: {
      status: "CANCELLED",
      cancelledBy: user.id,
      cancelledAt: now,
      cancellationReason: cancellationReason ?? null,
      updatedBy: user.id,
      updatedAt: now,
    },
  });

  // Notify contractor (OFFICIAL retests only)
  if (retest.retestType === "OFFICIAL" && retest.companyId) {
    await notifyContractors(
      {
        companyId: retest.companyId,
        traineeName: retest.traineeName,
        retestRef: retest.refNumber,
      },
      "RETEST_CANCELLED",
    );
  }

  await audit({
    user,
    action: "DELETE",
    entity: "RETEST",
    entityId: retest.id,
    entityRef: retest.refNumber,
    description: `Cancelled retest ${retest.refNumber} for ${retest.traineeName}${cancellationReason ? ` — ${cancellationReason}` : ""}`,
    descriptionAr: `تم إلغاء إعادة الاختبار ${retest.refNumber} للمتدرب ${retest.traineeName}${cancellationReason ? ` — ${cancellationReason}` : ""}`,
    req,
    oldValue: { status: retest.status },
    newValue: { status: "CANCELLED", cancellationReason: cancellationReason ?? null },
    metadata: {
      action: "RETEST_CANCELLED",
      retestId: retest.id,
      retestRef: retest.refNumber,
      traineeName: retest.traineeName,
      cancellationReason: cancellationReason ?? null,
    },
  });

  return ok(updated);
});

// ── PUT: record the retest result ──────────────────────────────────────────
// Called when the retest exam attempt is graded. Updates the retest's
// passed field and status. If the official retest FAILED, closes the
// training request (status=CLOSED) and notifies the contractor.
export const PUT = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const { passed, scorePercent, attemptId } = body;

  if (passed === undefined) {
    return fail("passed is required (true/false)", 422, "VALIDATION_ERROR");
  }

  const retest = await db.retestRequest.findUnique({ where: { id } });
  if (!retest || retest.deletedAt) return notFound("Retest not found");
  if (retest.status === "COMPLETED") {
    return fail("Retest is already completed", 422, "ALREADY_COMPLETED");
  }

  const now = new Date();
  const oldValues = { status: retest.status, passed: retest.passed };

  // Update the retest with the result
  const updated = await db.retestRequest.update({
    where: { id },
    data: {
      status: "COMPLETED",
      passed: Boolean(passed),
      retestAttemptId: attemptId ?? retest.retestAttemptId,
      updatedBy: user.id,
      updatedAt: now,
    },
  });

  // ── If OFFICIAL retest FAILED → close the training request ──────────────
  // Business rule: only 1 official retest is allowed. If it fails, the
  // training request is closed. Contractor must create a NEW request.
  if (retest.retestType === "OFFICIAL" && !passed) {
    // Find the training request linked to this session
    const session = await db.trainingSession.findUnique({
      where: { id: retest.sessionId },
      select: { id: true, requestId: true, refNumber: true },
    });

    if (session?.requestId) {
      await db.trainingRequest.update({
        where: { id: session.requestId },
        data: {
          status: "CLOSED",
          updatedBy: user.id,
          updatedAt: now,
        },
      });

      // Audit the closure
      await audit({
        user,
        action: "UPDATE",
        entity: "REQUEST",
        entityId: session.requestId,
        description: `Training request closed — official retest failed for ${retest.traineeName}`,
        descriptionAr: `تم إغلاق طلب التدريب — رسوب في إعادة الاختبار الرسمي للمتدرب ${retest.traineeName}`,
        req,
        oldValue: { status: "APPROVED" },
        newValue: { status: "CLOSED" },
        metadata: {
          action: "TRAINING_REQUEST_CLOSED",
          retestId: retest.id,
          retestRef: retest.refNumber,
          traineeName: retest.traineeName,
        },
      });
    }

    // Notify contractor: retest failed + training request closed
    if (retest.companyId) {
      await notifyContractors(
        {
          companyId: retest.companyId,
          traineeName: retest.traineeName,
          retestRef: retest.refNumber,
          scorePercent: scorePercent ?? null,
        },
        "RETEST_FAILED",
      );
    }
  }

  // ── If PASSED → notify contractor (OFFICIAL only) ───────────────────────
  if (retest.retestType === "OFFICIAL" && passed && retest.companyId) {
    await notifyContractors(
      {
        companyId: retest.companyId,
        traineeName: retest.traineeName,
        retestRef: retest.refNumber,
        scorePercent: scorePercent ?? null,
      },
      "RETEST_PASSED",
    );
  }

  // ── Audit log ───────────────────────────────────────────────────────────
  await audit({
    user,
    action: "UPDATE",
    entity: "RETEST",
    entityId: retest.id,
    entityRef: retest.refNumber,
    description: `Retest ${retest.refNumber} result recorded for ${retest.traineeName}: ${passed ? "PASSED" : "FAILED"}${scorePercent !== undefined ? ` (${scorePercent}%)` : ""}`,
    descriptionAr: `تم تسجيل نتيجة إعادة الاختبار ${retest.refNumber} للمتدرب ${retest.traineeName}: ${passed ? "ناجح" : "راسب"}${scorePercent !== undefined ? ` (${scorePercent}%)` : ""}`,
    req,
    oldValue: oldValues,
    newValue: { status: "COMPLETED", passed: Boolean(passed) },
    metadata: {
      action: passed ? "RETEST_PASSED" : "RETEST_FAILED",
      retestId: retest.id,
      retestRef: retest.refNumber,
      retestType: retest.retestType,
      traineeName: retest.traineeName,
      scorePercent: scorePercent ?? null,
    },
  });

  return ok(updated);
});
