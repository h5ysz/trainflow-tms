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
import { recomputeSessionCounts, upsertEnrollment } from "@/lib/sessions/session-management";
import { notifySessionScheduled } from "@/lib/notifications/session-events";
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
  notes?: string;
  // ── Trainer qualification exception ──
  waiveCertification?: boolean;
  waiverReason?: string;
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
    courses: await Promise.all(request.requestCourses.map(async (rc) => {
      // If the original course was deleted (catalog rebuild), find the active
      // replacement with the same title so trainer certifications still match.
      let effectiveCourseId = rc.courseId;
      let courseTitle = rc.course?.title ?? null;
      let courseCode = rc.course?.code ?? null;

      if (rc.course?.deletedAt) {
        // Search by exact title first, then by partial title match (the catalog
        // rebuild may have renamed or re-titled a course).
        const active = await db.course.findFirst({
          where: {
            OR: [
              { title: rc.course.title, deletedAt: null },
              { title: { contains: rc.course.title }, deletedAt: null },
              { title: { contains: rc.course.title.split(" ")[0] }, deletedAt: null },
            ],
          },
          select: { id: true, code: true, title: true },
        });
        if (active) {
          effectiveCourseId = active.id;
          courseTitle = active.title;
          courseCode = active.code;
        }
      }

      return {
        requestCourseId: rc.id,
        courseId: effectiveCourseId,
        courseTitle,
        courseCode,
        traineeCount: rc.traineeCount,
        defaultCapacity: rc.maxTrainees,
        alreadyGenerated: generatedFor.has(rc.id),
      };
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

    // Look up the course — if it was deleted (catalog rebuild), find the
    // active replacement by matching title (exact, contains, or first word).
    let course = await db.course.findFirst({ where: { id: spec.courseId, deletedAt: null } });
    if (!course) {
      const deletedCourse = await db.course.findFirst({ where: { id: spec.courseId } });
      if (deletedCourse) {
        const active = await db.course.findFirst({
          where: {
            OR: [
              { title: deletedCourse.title, deletedAt: null },
              { title: { contains: deletedCourse.title }, deletedAt: null },
              { title: { contains: deletedCourse.title.split(" ")[0] }, deletedAt: null },
            ],
          },
        });
        if (active) {
          course = active;
          spec.courseId = active.id;
        }
      }
    }
    if (!course) return fail(`Course ${spec.courseId} not found`, 404);

    // Validate trainer assignment if specified — uses the effective (active) courseId
    if (spec.trainerId) {
      const validation = await validateTrainerAssignment({
        user,
        trainerId: spec.trainerId,
        courseId: spec.courseId,
        startDate: start,
        endDate: end,
        allowCertificationWaiver: spec.waiveCertification === true,
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
  // Never create a duplicate: if a non-deleted session already exists for a
  // requestCourseId, skip it instead of generating a second one.
  const existingForRequestCourse = await db.trainingSession.findMany({
    where: { requestId, deletedAt: null },
    select: { requestCourseId: true },
  });
  const existingRequestCourseIds = new Set(
    existingForRequestCourse.map((s) => s.requestCourseId).filter(Boolean) as string[]
  );

  const created: TrainingSession[] = [];

  for (const { spec, traineeCount, courseTitle, courseLanguage, maxTrainees } of resolved) {
    if (existingRequestCourseIds.has(spec.requestCourseId)) continue;

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
        durationHours: SHIFT_DURATION_HOURS,
        capacity: spec.capacity ?? maxTrainees,
        language: courseLanguage,
        startDate: new Date(spec.startDate),
        endDate: new Date(spec.endDate),
        expectedTrainees: traineeCount,
        actualTrainees: 0,
        notes: spec.notes ?? null,
        status: "SCHEDULED",
        qrCodeToken: qrToken,
        qrCodeGeneratedAt: new Date(),
        // ── Record qualification exception if applicable ──
        ...(spec.waiveCertification && spec.trainerId ? {
          trainerCertWaivedAt: new Date(),
          trainerCertWaivedBy: user.id,
          trainerCertWaiverReason: spec.waiverReason ?? "Coordinator override",
        } : {}),
        createdBy: user.id,
        updatedBy: user.id,
      },
    });

    // Auto-enroll the request course's trainees into the generated session so
    // the assigned trainer sees their names, national IDs, and nationalities
    // on the session detail page (enrollments + contact-directory tabs). A
    // generated session that silently ships with an empty roster looks like a
    // scheduling bug to the trainer, so enrollment mirrors the request roster.
    await db.$transaction(async (tx) => {
      const roster = await tx.trainingRequestCourseTrainee.findMany({
        where: { requestCourseId: spec.requestCourseId, deletedAt: null },
        select: {
          trainee: { select: { id: true, companyId: true, fullName: true } },
        },
      });
      for (const row of roster) {
        await upsertEnrollment(
          session.id,
          row.trainee.id,
          row.trainee.companyId,
          user.id,
          {
            tx,
            notes: `Auto-enrolled from request ${request.refNumber}`,
          }
        );
      }
      // Keep expectedTrainees + SessionCompany cache in sync with the roster.
      await recomputeSessionCounts(session.id, tx);
    });

    created.push(session);
  }

  // Mark the request as SCHEDULED
  await db.trainingRequest.update({
    where: { id: requestId },
    data: { status: "SCHEDULED", scheduledAt: new Date(), updatedBy: user.id },
  });

  // ── Notify the assigned trainer(s) that they've been scheduled ──────────
  const assignedTrainerIds = Array.from(
    new Set(created.map((s) => s.trainerId).filter(Boolean) as string[])
  );
  if (assignedTrainerIds.length > 0) {
    const trainerUsers = await db.user.findMany({
      where: { trainerId: { in: assignedTrainerIds }, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (trainerUsers.length > 0) {
      await db.notification.createMany({
        data: trainerUsers.map((tu) => ({
          id: randomBytes(12).toString("hex"),
          userId: tu.id,
          title: "Training Session Scheduled",
          titleAr: "تم جدولة جلسة تدريبية",
          message: `You have been scheduled for training request ${request.refNumber} (${created.length} session(s)).`,
          messageAr: `تمت جدولتك لطلب التدريب ${request.refNumber} (${created.length} جلسة).`,
          type: "SUCCESS",
          category: "SESSION",
          link: `/sessions`,
          updatedAt: new Date(),
        })),
      });
    }
  }

  // ── SESSION_SCHEDULED per generated session: the enrolled company's
  //    contractor gets channels + in-app. The trainer is already told by the
  //    aggregated in-app notification above, so `notifyTrainer: false` avoids a
  //    duplicate trainer message. A notification failure never fails the flow. ──
  for (const s of created) {
    try {
      await notifySessionScheduled(s.id, { notifyTrainer: false });
    } catch (e) {
      console.error(`SESSION_SCHEDULED failed for session ${s.refNumber}:`, (e as Error).message);
    }
  }

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
