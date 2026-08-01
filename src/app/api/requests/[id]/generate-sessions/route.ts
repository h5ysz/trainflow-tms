// /api/requests/[id]/generate-sessions — turn an APPROVED request's courses into sessions
//
// This used to live at /api/sessions/[id]/generate-from-request, where `[id]` was in fact
// a request id. The only caller passed a *session* id and an empty body, so the handler
// looked up a training request by session id and 404'd on every single call. Moving it
// under /api/requests/[id] puts the path segment and its meaning back in agreement.
import type { TrainingSession } from "@prisma/client";
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { nextRefNumber } from "@/lib/api/ref-number";
import { validateTrainerAssignment, validationErrorToResponse } from "@/lib/api/trainer-assignment";
import { randomBytes } from "crypto";

const SHIFT_DURATION_HOURS = 6;

function genQrToken(): string {
  return randomBytes(16).toString("hex");
}

interface SessionSpec {
  requestCourseId: string;
  courseId: string;
  shift: "MORNING" | "EVENING";
  city?: string;
  region?: string;
  venue?: string;
  startDate: string;
  endDate: string;
  trainerId?: string;
  capacity?: number;
  title?: string;
}

async function loadRequest(requestId: string) {
  return db.trainingRequest.findUnique({
    where: { id: requestId },
    include: {
      company: true,
      requestCourses: {
        where: { deletedAt: null },
        include: { course: true },
      },
    },
  });
}

// GET — the data the "Generate sessions" dialog needs to build its form: which courses
// are on the request, how many trainees each expects, and which already have sessions.
export const GET = withModuleAction("sessions", "create", async ({ params }) => {
  const requestId = params.id as string;
  const request = await loadRequest(requestId);
  if (!request || request.deletedAt) return notFound("Request not found");

  const existing = await db.trainingSession.findMany({
    where: { requestId, deletedAt: null },
    select: { id: true, refNumber: true, requestCourseId: true, startDate: true, shift: true },
  });
  const generatedFor = new Set(existing.map((s) => s.requestCourseId).filter(Boolean) as string[]);

  return ok({
    requestId: request.id,
    requestRef: request.refNumber,
    status: request.status,
    canGenerate: request.status === "APPROVED",
    company: request.company
      ? { id: request.company.id, name: request.company.name, city: request.company.city }
      : null,
    preferredDateFrom: request.preferredDateFrom ?? null,
    preferredDateTo: request.preferredDateTo ?? null,
    preferredLocation: request.preferredLocation ?? null,
    courses: request.requestCourses.map((rc) => ({
      requestCourseId: rc.id,
      courseId: rc.courseId,
      courseTitle: rc.course?.title ?? null,
      courseCode: rc.course?.code ?? null,
      traineeCount: rc.traineeCount,
      defaultCapacity: rc.maxTrainees,
      alreadyGenerated: generatedFor.has(rc.id),
    })),
    existingSessions: existing,
  });
});

export const POST = withModuleAction("sessions", "create", async ({ req, params, user }) => {
  const requestId = params.id as string;

  const request = await loadRequest(requestId);
  if (!request || request.deletedAt) return notFound("Request not found");

  // Only allow session generation when request is APPROVED
  if (request.status !== "APPROVED") {
    return fail(
      `Cannot generate sessions: request status must be APPROVED (current: ${request.status})`,
      400,
      "INVALID_STATUS"
    );
  }

  const body = await req.json().catch(() => ({}));
  const sessions: SessionSpec[] = body.sessions ?? [];

  if (!Array.isArray(sessions) || sessions.length === 0) {
    return fail(
      "Provide { sessions: [{ requestCourseId, courseId, shift, startDate, endDate, ... }] }",
      422,
      "VALIDATION_ERROR"
    );
  }

  // ── Validate every spec before creating anything ──────────────────────────
  // Reference-number allocation writes to the database, so it cannot run inside a
  // transaction on SQLite without deadlocking the single writer. Validating up front
  // is what stops a bad spec halfway down the list from leaving a half-scheduled
  // request behind.
  const resolved: Array<{ spec: SessionSpec; traineeCount: number; courseTitle: string; courseLanguage: string; maxTrainees: number }> = [];

  for (const spec of sessions) {
    if (!spec.requestCourseId || !spec.courseId || !spec.shift || !spec.startDate || !spec.endDate) {
      return fail(`Invalid session spec: missing required fields`, 422, "VALIDATION_ERROR", { spec });
    }
    if (spec.shift !== "MORNING" && spec.shift !== "EVENING") {
      return fail(`Invalid shift "${spec.shift}": must be MORNING or EVENING`, 422, "VALIDATION_ERROR", { spec });
    }

    const start = new Date(spec.startDate);
    const end = new Date(spec.endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return fail(`Invalid startDate or endDate`, 422, "VALIDATION_ERROR", { spec });
    }
    if (end < start) {
      return fail(`endDate must not be before startDate`, 422, "VALIDATION_ERROR", { spec });
    }

    // Verify the requestCourseId belongs to this request
    const rc = await db.trainingRequestCourse.findFirst({
      where: { id: spec.requestCourseId, requestId, deletedAt: null },
    });
    if (!rc) {
      return fail(`requestCourseId ${spec.requestCourseId} not found in this request`, 404);
    }

    const course = await db.course.findFirst({ where: { id: spec.courseId, deletedAt: null } });
    if (!course) return fail(`Course ${spec.courseId} not found`, 404);

    // Validate trainer assignment if specified
    if (spec.trainerId) {
      const validation = await validateTrainerAssignment({
        user,
        trainerId: spec.trainerId,
        courseId: spec.courseId,
        startDate: start,
        endDate: end,
      });
      if (!validation.valid) {
        return validationErrorToResponse(validation);
      }
    }

    resolved.push({
      spec,
      traineeCount: rc.traineeCount,
      courseTitle: course.title,
      courseLanguage: course.language,
      maxTrainees: course.maxTrainees,
    });
  }

  // ── Create ────────────────────────────────────────────────────────────────
  const created: TrainingSession[] = [];

  for (const { spec, traineeCount, courseTitle, courseLanguage, maxTrainees } of resolved) {
    const refNumber = await nextRefNumber("SESSION");
    const qrToken = genQrToken();

    const session = await db.trainingSession.create({
      data: {
        refNumber,
        courseId: spec.courseId,
        requestId,
        requestCourseId: spec.requestCourseId,
        trainerId: spec.trainerId ?? null,
        title: spec.title ?? `${courseTitle} — ${spec.shift === "MORNING" ? "Morning" : "Evening"}`,
        location: request.company?.city ?? spec.city ?? null,
        city: spec.city ?? request.company?.city ?? null,
        region: spec.region ?? null,
        venue: spec.venue ?? null,
        shift: spec.shift,
        durationHours: SHIFT_DURATION_HOURS, // 6 hours for Morning/Evening
        capacity: spec.capacity ?? maxTrainees,
        language: courseLanguage,
        startDate: new Date(spec.startDate),
        endDate: new Date(spec.endDate),
        expectedTrainees: traineeCount,
        actualTrainees: 0,
        status: "SCHEDULED",
        qrCodeToken: qrToken,
        qrCodeGeneratedAt: new Date(),
        createdBy: user.id,
        updatedBy: user.id,
      },
    });

    created.push(session);
  }

  // Mark the request as SCHEDULED
  await db.trainingRequest.update({
    where: { id: requestId },
    data: { status: "SCHEDULED", scheduledAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "SESSION",
    entityId: requestId,
    entityRef: request.refNumber,
    description: `Generated ${created.length} session(s) from approved request ${request.refNumber}`,
    descriptionAr: `تم توليد ${created.length} جلسة من طلب معتمد ${request.refNumber}`,
    req,
    metadata: {
      sessionRefs: created.map((s) => s.refNumber),
      requestCourseIds: sessions.map((s) => s.requestCourseId),
    },
  });

  return ok({
    requestRef: request.refNumber,
    requestStatus: "SCHEDULED",
    generatedCount: created.length,
    sessions: created,
  });
});
