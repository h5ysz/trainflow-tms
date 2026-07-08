// /api/sessions/[id]/lifecycle — track session lifecycle: STARTED → BREAK → RESUMED → COMPLETED
// POST: record a lifecycle event + update session.lifecycleStatus
// GET: list all lifecycle events for the session
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { recordStatusChange } from "@/lib/auth/audit";

const VALID_EVENTS = ["STARTED", "BREAK", "RESUMED", "COMPLETED"];

// Valid lifecycle transitions
const LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
  NOT_STARTED: ["STARTED"],
  STARTED: ["BREAK", "COMPLETED"],
  ON_BREAK: ["RESUMED", "COMPLETED"],
  COMPLETED: [],
};

function getLifecycleStatus(eventType: string): string {
  switch (eventType) {
    case "STARTED": return "STARTED";
    case "BREAK": return "ON_BREAK";
    case "RESUMED": return "STARTED";
    case "COMPLETED": return "COMPLETED";
    default: return "NOT_STARTED";
  }
}

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const { eventType, notes } = body;

  if (!eventType || !VALID_EVENTS.includes(eventType)) {
    return fail(`eventType must be one of: ${VALID_EVENTS.join(", ")}`, 422, "VALIDATION_ERROR");
  }

  const session = await db.trainingSession.findUnique({ where: { id } });
  if (!session || session.deletedAt) return fail("Session not found", 404);

  // Validate transition
  const currentStatus = session.lifecycleStatus ?? "NOT_STARTED";
  const allowed = LIFECYCLE_TRANSITIONS[currentStatus] ?? [];
  if (!allowed.includes(eventType)) {
    return fail(
      `Invalid lifecycle transition: ${currentStatus} → ${eventType}. Allowed: ${allowed.join(", ") || "none"}`,
      400,
      "INVALID_TRANSITION",
      { from: currentStatus, to: eventType, allowed }
    );
  }

  const now = new Date();
  const newLifecycleStatus = getLifecycleStatus(eventType);

  // Create lifecycle event
  const event = await db.sessionLifecycleEvent.create({
    data: {
      sessionId: id,
      eventType,
      eventTime: now,
      notes: notes ?? null,
      createdBy: user.id,
    },
  });

  // Update session lifecycle status + relevant timestamps
  const updates: Record<string, unknown> = {
    lifecycleStatus: newLifecycleStatus,
    updatedBy: user.id,
  };

  if (eventType === "STARTED") {
    updates.startedAt = now;
    // Also set session status to IN_PROGRESS if currently SCHEDULED
    if (session.status === "SCHEDULED") {
      updates.status = "IN_PROGRESS";
    }
  } else if (eventType === "COMPLETED") {
    updates.completedAt = now;
    // Set session status to COMPLETED
    updates.status = "COMPLETED";
  }

  await db.trainingSession.update({
    where: { id },
    data: updates,
  });

  // If session is COMPLETED, auto-assign Final Test to all PRESENT trainees
  let finalTestsAssigned = 0;
  if (eventType === "COMPLETED" && session.courseId) {
    const course = await db.course.findUnique({ where: { id: session.courseId } });
    if (course?.hasFinalTest) {
      const presentTrainees = await db.attendance.findMany({
        where: {
          sessionId: id,
          status: "PRESENT",
          deletedAt: null,
          finalTestAssignedAt: null, // only assign if not already assigned
        },
      });

      for (const trainee of presentTrainees) {
        try {
          // Dynamically import to avoid circular dependency
          const { createExamAttempt } = await import("@/lib/api/exam-engine");
          await createExamAttempt({
            sessionId: id,
            attendanceId: trainee.id,
            testType: "FINAL_TEST",
            traineeName: trainee.traineeName,
            traineeEmail: trainee.traineeEmail ?? undefined,
            traineeIdNational: trainee.traineeIdNational ?? undefined,
            createdBy: user.id,
          });

          await db.attendance.update({
            where: { id: trainee.id },
            data: { finalTestAssignedAt: now },
          });

          finalTestsAssigned++;
        } catch (e) {
          // Skip if no questions in bank
          console.error(`[Final test auto-assign error for ${trainee.traineeName}]`, e);
        }
      }
    }
  }

  await recordStatusChange({
    user,
    entity: "SESSION",
    entityId: id,
    entityRef: session.refNumber,
    fromStatus: currentStatus,
    toStatus: newLifecycleStatus,
    req,
  });

  return ok({
    event,
    sessionRef: session.refNumber,
    lifecycleStatus: newLifecycleStatus,
    finalTestsAssigned,
  });
});

export const GET = withModuleAction("sessions", "view", async ({ params }) => {
  const id = params.id as string;
  const session = await db.trainingSession.findUnique({ where: { id } });
  if (!session || session.deletedAt) return fail("Session not found", 404);

  const events = await db.sessionLifecycleEvent.findMany({
    where: { sessionId: id },
    orderBy: { eventTime: "asc" },
  });

  return ok({
    lifecycleStatus: session.lifecycleStatus,
    startedAt: session.startedAt,
    completedAt: session.completedAt,
    events,
  });
});
