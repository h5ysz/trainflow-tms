// /api/requests/[id]/generate-sessions — turn an APPROVED request's courses
// into scheduled sessions, with automatic session splitting when the
// trainee count exceeds the course capacity.
//
// Redesigned workflow (worklog entry "workflow-redesign-v2"):
//   - Approval is NEVER blocked by trainee count.
//   - At scheduling time, if a course has more trainees than its capacity,
//     the auto-splitter creates N balanced sessions and enrolls trainees
//     into them round-robin.
//   - Trainees are auto-enrolled as `SessionEnrollment` rows so the trainer
//     sees the full roster immediately. `SessionCompany` rows are also
//     populated so the per-company breakdown renders correctly.
//   - Trainer assignment is NOT done here — it happens later via
//     POST /api/sessions/[id]/assign-trainer.
import type { TrainingSession } from "@prisma/client";
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { nextRefNumber } from "@/lib/api/ref-number";
import { suggestSessionSplit, MAX_TRAINEES_PER_COURSE } from "@/lib/api/request-validation";
import { recomputeSessionCounts, truncateForAudit } from "@/lib/sessions/session-management";
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
        include: {
          course: true,
          trainees: {
            where: { deletedAt: null },
            include: { trainee: { select: { id: true, companyId: true } } },
          },
        },
      },
    },
  });
}

// GET — the data the "Generate sessions" dialog needs to build its form:
// which courses are on the request, how many trainees each expects, which
// already have sessions, AND a suggested split preview for courses that
// exceed their capacity.
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
    courses: request.requestCourses.map((rc) => {
      const courseMax = rc.course?.maxTrainees ?? rc.maxTrainees ?? MAX_TRAINEES_PER_COURSE;
      const realTraineeCount = rc.trainees.length;
      const suggestedSplit = suggestSessionSplit(realTraineeCount, courseMax);
      return {
        requestCourseId: rc.id,
        courseId: rc.courseId,
        courseTitle: rc.course?.title ?? null,
        courseCode: rc.course?.code ?? null,
        traineeCount: realTraineeCount,
        defaultCapacity: courseMax,
        alreadyGenerated: generatedFor.has(rc.id),
        // When trainees > capacity, this is the suggested split preview.
        // E.g. 37 trainees / 20 capacity → [20, 17] → 2 sessions.
        suggestedSplit,
        suggestedSessionCount: suggestedSplit.length,
      };
    }),
    existingSessions: existing,
  });
});

export const POST = withModuleAction("sessions", "create", async ({ req, params, user }) => {
  const requestId = params.id as string;

  const request = await loadRequest(requestId);
  if (!request || request.deletedAt) return notFound("Request not found");

  const body = await req.json().catch(() => ({}));

  // No status gate — coordinators can generate sessions from any request
  // regardless of status. Every change is audit-logged.

  const sessions: SessionSpec[] = body.sessions ?? [];
  // autoSplit defaults to true — when a course has more trainees than its
  // capacity, the endpoint creates multiple sessions and distributes the
  // trainees across them. The coordinator can override by passing
  // `autoSplit: false` to create exactly one session per spec (the legacy
  // behavior) and handle enrollment manually.
  const autoSplit = body.autoSplit !== false;
  // autoEnroll defaults to true — created sessions get their trainees
  // pre-enrolled as SessionEnrollment rows so the trainer sees the roster
  // immediately. Set to false to create empty sessions and enroll later.
  const autoEnroll = body.autoEnroll !== false;

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
  interface ResolvedSpec {
    spec: SessionSpec;
    traineeIds: string[];
    traineeCompanyIds: string[]; // parallel array of companyIds for each trainee
    courseTitle: string;
    courseLanguage: string;
    maxTrainees: number;
    capacity: number;
    splitSizes: number[];
  }
  const resolved: ResolvedSpec[] = [];

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

    // Verify the requestCourseId belongs to this request — load with trainees
    // so we can auto-enroll them below.
    const rc = await db.trainingRequestCourse.findFirst({
      where: { id: spec.requestCourseId, requestId, deletedAt: null },
      include: {
        trainees: {
          where: { deletedAt: null },
          include: { trainee: { select: { id: true, companyId: true } } },
        },
      },
    });
    if (!rc) {
      return fail(`requestCourseId ${spec.requestCourseId} not found in this request`, 404);
    }

    const course = await db.course.findFirst({ where: { id: spec.courseId, deletedAt: null } });
    if (!course) return fail(`Course ${spec.courseId} not found`, 404);

    // Trainer assignment is intentionally NOT validated here — per the
    // redesigned workflow, trainer assignment happens AFTER scheduling.
    // If a trainerId is supplied we still accept it, but the dedicated
    // POST /api/sessions/[id]/assign-trainer endpoint is the canonical path.

    const traineeIds = rc.trainees.map((t) => t.trainee.id);
    const traineeCompanyIds = rc.trainees.map((t) => t.trainee.companyId);
    const courseMax = course.maxTrainees;
    const capacity = spec.capacity ?? courseMax;

    // Compute the split sizes for this course. When autoSplit is disabled
    // OR the trainees fit in one session, this is a single-element array.
    const splitSizes = autoSplit
      ? suggestSessionSplit(traineeIds.length, capacity)
      : [traineeIds.length];

    resolved.push({
      spec,
      traineeIds,
      traineeCompanyIds,
      courseTitle: course.title,
      courseLanguage: course.language,
      maxTrainees: courseMax,
      capacity,
      splitSizes,
    });
  }

  // ── Validate: reject if any course has zero trainees ────────────────────
  // suggestSessionSplit(0, capacity) returns [], which would create zero
  // sessions for that course but still mark the request as SCHEDULED,
  // leaving it stuck (no way to re-trigger generate because status != APPROVED).
  const zeroTraineeCourses = resolved.filter((r) => r.splitSizes.length === 0);
  if (zeroTraineeCourses.length > 0) {
    return fail(
      `Cannot generate sessions: ${zeroTraineeCourses.length} course(s) have zero trainees. Add trainees before scheduling.`,
      422,
      "NO_TRAINEES",
      { courses: zeroTraineeCourses.map((r) => r.courseTitle) }
    );
  }

  // ── Create sessions + enroll trainees inside a single transaction ──────────
  // Pre-allocate all ref numbers + QR tokens OUTSIDE the transaction (SQLite
  // single-writer note in `nextRefNumber`), then do all the data mutations
  // inside `$transaction`. If the transaction fails, the ref numbers are
  // wasted (gaps in the sequence) but no partial sessions exist.
  const created: TrainingSession[] = [];
  const auditEnrollmentSummary: Array<{ sessionRef: string; enrolled: number }> = [];

  // Pre-allocate ref numbers + QR tokens for every session we'll create.
  const totalSessionsToCreate = resolved.reduce((sum, r) => sum + r.splitSizes.length, 0);
  const preAllocated: Array<{ refNumber: string; qrToken: string }> = [];
  for (let i = 0; i < totalSessionsToCreate; i++) {
    preAllocated.push({
      refNumber: await nextRefNumber("SESSION"),
      qrToken: genQrToken(),
    });
  }

  await db.$transaction(async (tx) => {
    let allocCursor = 0;
    for (const r of resolved) {
      // Distribute trainees across the split sessions round-robin so each
      // session gets a balanced mix (preserves any ordering the request had).
      let traineeCursor = 0;
      for (let i = 0; i < r.splitSizes.length; i++) {
        const size = r.splitSizes[i];
        const slice = r.traineeIds.slice(traineeCursor, traineeCursor + size);
        const companySlice = r.traineeCompanyIds.slice(traineeCursor, traineeCursor + size);
        traineeCursor += size;

        const { refNumber, qrToken } = preAllocated[allocCursor++];
        const sessionIndex = r.splitSizes.length > 1 ? ` (${i + 1}/${r.splitSizes.length})` : "";

        const session = await tx.trainingSession.create({
          data: {
            refNumber,
            courseId: r.spec.courseId,
            requestId,
            requestCourseId: r.spec.requestCourseId,
            trainerId: r.spec.trainerId ?? null,
            title: r.spec.title
              ? (r.splitSizes.length > 1 ? `${r.spec.title}${sessionIndex}` : r.spec.title)
              : `${r.courseTitle} — ${r.spec.shift === "MORNING" ? "Morning" : "Evening"}${sessionIndex}`,
            location: request.company?.city ?? r.spec.city ?? null,
            city: r.spec.city ?? request.company?.city ?? null,
            region: r.spec.region ?? null,
            venue: r.spec.venue ?? null,
            shift: r.spec.shift,
            durationHours: SHIFT_DURATION_HOURS,
            capacity: r.capacity,
            language: r.courseLanguage,
            startDate: new Date(r.spec.startDate),
            endDate: new Date(r.spec.endDate),
            expectedTrainees: slice.length,
            actualTrainees: 0,
            status: "SCHEDULED",
            qrCodeToken: qrToken,
            qrCodeGeneratedAt: new Date(),
            createdBy: user.id,
            updatedBy: user.id,
          },
        });
        created.push(session);

        // Auto-enroll trainees into this session using the upsert pattern.
        // Even though these are fresh sessions, using upsert keeps the code
        // path consistent with split/merge/move and handles the edge case
        // where a trainee was previously enrolled+removed in a deleted
        // session that happened to reuse the same id (extremely unlikely
        // but defensive).
        if (autoEnroll && slice.length > 0) {
          for (let j = 0; j < slice.length; j++) {
            const traineeId = slice[j];
            const companyId = companySlice[j];
            await tx.sessionEnrollment.upsert({
              where: { sessionId_traineeId: { sessionId: session.id, traineeId } },
              update: {
                deletedAt: null,
                companyId,
                enrolledBy: user.id,
                enrollmentStatus: "CONFIRMED",
                enrollmentDate: new Date(),
                updatedBy: user.id,
              },
              create: {
                sessionId: session.id,
                traineeId,
                companyId,
                enrolledBy: user.id,
                enrollmentStatus: "CONFIRMED",
                enrollmentDate: new Date(),
                createdBy: user.id,
                updatedBy: user.id,
              },
            });
          }

          // Recompute SessionCompany cache for this session.
          await recomputeSessionCounts(session.id, tx);

          auditEnrollmentSummary.push({ sessionRef: session.refNumber, enrolled: slice.length });
        } else {
          auditEnrollmentSummary.push({ sessionRef: session.refNumber, enrolled: 0 });
        }
      }
    }

    // Mark the request as SCHEDULED
    await tx.trainingRequest.update({
      where: { id: requestId },
      data: { status: "SCHEDULED", scheduledAt: new Date(), updatedBy: user.id },
    });
  });

  // ── Audit (outside transaction) ────────────────────────────────────────────
  const sessionRefsTruncated = truncateForAudit(created.map((s) => s.refNumber));
  await audit({
    user,
    action: "CREATE",
    entity: "SESSION",
    entityId: requestId,
    entityRef: request.refNumber,
    description: `Generated ${created.length} session(s) from approved request ${request.refNumber} (autoSplit=${autoSplit}, autoEnroll=${autoEnroll})`,
    descriptionAr: `تم توليد ${created.length} جلسة من طلب معتمد ${request.refNumber}`,
    req,
    oldValue: null,
    newValue: {
      sessionRefs: sessionRefsTruncated.items,
      sessionRefsTotal: sessionRefsTruncated.total,
      requestStatus: "SCHEDULED",
    },
    metadata: {
      action: "GENERATE_SESSIONS",
      sessionRefs: sessionRefsTruncated.items,
      sessionRefsTotal: sessionRefsTruncated.total,
      requestCourseIds: sessions.map((s) => s.requestCourseId),
      autoSplit,
      autoEnroll,
      enrollmentSummary: auditEnrollmentSummary,
      splitPlan: resolved.map((r) => ({
        requestCourseId: r.spec.requestCourseId,
        courseTitle: r.courseTitle,
        traineeCount: r.traineeIds.length,
        capacity: r.capacity,
        splitSizes: r.splitSizes,
      })),
    },
  });

  return ok({
    requestRef: request.refNumber,
    requestStatus: "SCHEDULED",
    generatedCount: created.length,
    sessions: created,
    enrollmentSummary: auditEnrollmentSummary,
    splitPlan: resolved.map((r) => ({
      requestCourseId: r.spec.requestCourseId,
      courseTitle: r.courseTitle,
      traineeCount: r.traineeIds.length,
      capacity: r.capacity,
      splitSizes: r.splitSizes,
    })),
  });
});
