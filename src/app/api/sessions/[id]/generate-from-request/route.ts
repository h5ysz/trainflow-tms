// /api/sessions/[id]/generate-from-request — auto-generate sessions from approved request courses
// POST /api/sessions/generate-from-request?requestId=... with body specifying shift/city/dates per course
// OR POST /api/requests/[id]/generate-sessions — alternative path
//
// This endpoint is mounted at /api/sessions/[id]/generate-from-request but the [id]
// here is the REQUEST ID (a small abuse of routing). For clarity, we treat [id] as requestId.

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

export const POST = withModuleAction("sessions", "create", async ({ req, params, user }) => {
  const requestId = params.id as string;

  const request = await db.trainingRequest.findUnique({
    where: { id: requestId },
    include: {
      company: true,
      requestCourses: {
        where: { deletedAt: null },
        include: { course: true },
      },
    },
  });
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

  // Untyped [] infers never[], so pushing a session fails and .refNumber below
  // reads off never.
  const created: TrainingSession[] = [];

  for (const spec of sessions) {
    if (!spec.requestCourseId || !spec.courseId || !spec.shift || !spec.startDate || !spec.endDate) {
      return fail(`Invalid session spec: missing required fields`, 422, "VALIDATION_ERROR", { spec });
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
        startDate: new Date(spec.startDate),
        endDate: new Date(spec.endDate),
      });
      if (!validation.valid) {
        return validationErrorToResponse(validation);
      }
    }

    const refNumber = await nextRefNumber("SESSION");
    const qrToken = genQrToken();

    const session = await db.trainingSession.create({
      data: {
        refNumber,
        courseId: spec.courseId,
        requestId,
        requestCourseId: spec.requestCourseId,
        trainerId: spec.trainerId ?? null,
        title: spec.title ?? `${course.title} — ${spec.shift === "MORNING" ? "Morning" : "Evening"}`,
        location: request.company?.city ?? spec.city ?? null,
        city: spec.city ?? request.company?.city ?? null,
        region: spec.region ?? null,
        venue: spec.venue ?? null,
        shift: spec.shift,
        durationHours: SHIFT_DURATION_HOURS, // 6 hours for Morning/Evening
        capacity: spec.capacity ?? course.maxTrainees,
        language: course.language,
        startDate: new Date(spec.startDate),
        endDate: new Date(spec.endDate),
        expectedTrainees: rc.traineeCount,
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
