// /api/retests/[id] — get, schedule, reschedule, cancel a retest
//
// GET:    get a single retest by ID
// POST:   schedule or reschedule a retest (action in body)
// DELETE: cancel a retest
//
// The POST handler supports these actions via body.action:
//   "schedule"    → initial scheduling (PENDING_RETEST → SCHEDULED)
//   "reschedule"  → change the schedule (SCHEDULED/RESCHEDULED → RESCHEDULED)
//
// Body for schedule/reschedule:
//   {
//     action: "schedule" | "reschedule",
//     retestSessionId?: string,   // target session (same or different)
//     retestTrainerId?: string,   // assign a different trainer
//     retestDate?: string,        // ISO date
//     retestShift?: string,       // MORNING | EVENING
//     retestLocation?: string,
//     retestVenue?: string,
//     reason?: string,
//     moveTrainee?: boolean       // if true + retestSessionId differs, move enrollment
//   }
//
// RBAC: requires `sessions.edit` permission (coordinators + trainers).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
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

  const retest = await db.retestRequest.findUnique({
    where: { id },
  });
  if (!retest || retest.deletedAt) return notFound("Retest not found");

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
  // When the retest is in a different session AND moveTrainee is true, we
  // move the enrollment to the target session so the trainee appears in the
  // new session's roster. This uses the existing move-trainees logic.
  if (moveTrainee && retestSessionId && retestSessionId !== retest.sessionId) {
    // Fetch the enrollment to get the traineeId + companyId.
    const oldEnrollment = await db.sessionEnrollment.findUnique({
      where: { id: retest.enrollmentId },
    });
    if (oldEnrollment && !oldEnrollment.deletedAt) {
      await db.$transaction(async (tx) => {
        // Soft-delete old enrollment
        await tx.sessionEnrollment.update({
          where: { id: oldEnrollment.id },
          data: {
            deletedAt: now,
            enrollmentStatus: "MOVED",
            updatedBy: user.id,
          },
        });

        // Upsert enrollment in target session
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

        // Recompute counts on both sessions
        await recomputeSessionCounts(retest.sessionId, tx);
        await recomputeSessionCounts(retestSessionId, tx);
      });
    }
  }

  // ── Notify contractor ───────────────────────────────────────────────────
  if (retest.companyId) {
    await notifyContractors(
      {
        companyId: retest.companyId,
        traineeName: retest.traineeName,
        courseTitle: null, // could fetch but keep it simple
        sessionRef: null,
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

  // Cannot cancel a completed retest
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

  // Notify contractor
  if (retest.companyId) {
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
