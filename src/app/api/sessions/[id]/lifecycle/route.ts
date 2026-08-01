// /api/sessions/[id]/lifecycle — track session lifecycle: STARTED → BREAK → RESUMED → COMPLETED
// POST: record a lifecycle event + update session.lifecycleStatus
// GET: list all lifecycle events for the session
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { recordStatusChange } from "@/lib/auth/audit";
import { syncFinalTestStatus } from "@/lib/api/enrollment-sync";

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

  // No lifecycle transition validation — coordinators can fire any lifecycle
  // event at any time. Every change is audit-logged.
  const currentStatus = session.lifecycleStatus ?? "NOT_STARTED";

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
            companyId: trainee.companyId ?? undefined, // trainee's original company
            createdBy: user.id,
          });

          await db.attendance.update({
            where: { id: trainee.id },
            data: { finalTestAssignedAt: now },
          });

          // ── Sync SessionEnrollment: final-test PENDING ──
          await syncFinalTestStatus({
            sessionId: id,
            traineeName: trainee.traineeName,
            traineeIdNational: trainee.traineeIdNational ?? undefined,
            attendanceId: trainee.id,
            status: "PENDING",
            userId: user.id,
          });

          finalTestsAssigned++;
        } catch (e) {
          // Skip if no questions in bank
          console.error(`[Final test auto-assign error for ${trainee.traineeName}]`, e);

          // If final-test can't be assigned (no questions), mark as NOT_REQUIRED
          await syncFinalTestStatus({
            sessionId: id,
            traineeName: trainee.traineeName,
            traineeIdNational: trainee.traineeIdNational ?? undefined,
            attendanceId: trainee.id,
            status: "NOT_REQUIRED",
            userId: user.id,
          });
        }
      }
    }
  }

  // BUG FIX: On COMPLETED, mark absent trainees as NO_SHOW on their SessionEnrollment
  let noShowCount = 0;
  if (eventType === "COMPLETED") {
    // Find all enrollments that were never checked in
    const absentEnrollments = await db.sessionEnrollment.findMany({
      where: {
        sessionId: id,
        deletedAt: null,
        attendanceStatus: "NOT_STARTED",
        enrollmentStatus: { in: ["PENDING", "CONFIRMED"] },
      },
    });
    for (const enrollment of absentEnrollments) {
      await db.sessionEnrollment.update({
        where: { id: enrollment.id },
        data: {
          enrollmentStatus: "NO_SHOW",
          attendanceStatus: "ABSENT",
          updatedBy: user.id,
        },
      });
      noShowCount++;
    }

    // Also mark attendance records that never checked in as ABSENT
    await db.attendance.updateMany({
      where: {
        sessionId: id,
        status: "REGISTERED",
        checkInAt: null,
        deletedAt: null,
      },
      data: { status: "ABSENT", updatedBy: user.id },
    });
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
    noShowCount,
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
