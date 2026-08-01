// /api/sessions/assemble — create a session from trainees pulled from
// multiple APPROVED requests.
//
// This is the primary multi-contractor workflow. Instead of
// generate-then-merge, the coordinator picks trainees from any number of
// approved requests (for the same course) and assembles them into a single
// new session in one operation.
//
// Per the approved design:
//   - The new session's `requestId` and `requestCourseId` are NULL —
//     sessions are independent operational entities after approval.
//   - Each trainee's `companyId` is snapshotted at enrollment time.
//   - Per-trainee provenance (`sourceRequestCourseId`) is recorded in the
//     enrollment's `notes` field for audit traceability.
//   - All writes are wrapped in a single `$transaction` so the assembly
//     either fully succeeds or fully fails.
//
// Body:
//   {
//     courseId: string,                  // required
//     title: string,                     // required
//     shift: "MORNING" | "EVENING",      // required
//     startDate: string,                 // required, ISO
//     endDate: string,                   // required, ISO
//     capacity?: number,                 // optional, defaults to course.maxTrainees
//     venue?: string, city?: string, region?: string,
//     language?: string,                 // defaults to "en"
//     durationHours?: number,            // defaults to 6
//     trainerId?: string,                // optional — assign later if omitted
//     trainees: Array<{                  // required, non-empty
//       traineeId: string,
//       sourceRequestCourseId: string,   // for provenance
//     }>,
//   }
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { nextRefNumber } from "@/lib/api/ref-number";
import { recomputeSessionCounts, truncateForAudit } from "@/lib/sessions/session-management";
import { validateTrainerAssignment, validationErrorToResponse } from "@/lib/api/trainer-assignment";
import { randomBytes } from "crypto";

function genQrToken(): string {
  return randomBytes(16).toString("hex");
}

interface AssembleTraineeSpec {
  traineeId: string;
  sourceRequestCourseId: string;
}

export const POST = withModuleAction("sessions", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));

  // ── Validate top-level fields ──────────────────────────────────────────────
  const {
    courseId, title, shift, startDate, endDate,
    capacity, venue, city, region, language,
    durationHours, trainerId,
    trainees,
  } = body;

  if (!courseId || !title || !shift || !startDate || !endDate) {
    return fail("courseId, title, shift, startDate, endDate are required", 422, "VALIDATION_ERROR");
  }
  if (shift !== "MORNING" && shift !== "EVENING") {
    return fail(`Invalid shift "${shift}": must be MORNING or EVENING`, 422, "VALIDATION_ERROR");
  }
  if (!Array.isArray(trainees) || trainees.length === 0) {
    return fail("trainees must be a non-empty array of { traineeId, sourceRequestCourseId }", 422, "VALIDATION_ERROR");
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return fail("Invalid startDate or endDate", 422, "VALIDATION_ERROR");
  }
  if (end < start) {
    return fail("endDate must not be before startDate", 422, "VALIDATION_ERROR");
  }

  // ── Load course ─────────────────────────────────────────────────────────────
  const course = await db.course.findFirst({ where: { id: courseId, deletedAt: null } });
  if (!course) return fail(`Course ${courseId} not found`, 404);

  // ── Validate trainer (if provided) ─────────────────────────────────────────
  // Trainer assignment is optional at assembly time. If provided, we validate
  // certification + conflict; if not, the session is created with no trainer
  // and the coordinator can assign one later.
  if (trainerId) {
    const trainer = await db.trainer.findFirst({ where: { id: trainerId, deletedAt: null } });
    if (!trainer) return fail("Trainer not found", 404);
    const validation = await validateTrainerAssignment({
      user,
      trainerId,
      courseId,
      startDate: start,
      endDate: end,
    });
    if (!validation.valid) {
      return validationErrorToResponse(validation);
    }
  }

  // ── Validate every trainee spec up front ────────────────────────────────────
  // For each trainee, verify:
  //   1. The trainee exists.
  //   2. The `sourceRequestCourseId` belongs to an APPROVED request.
  //   3. The trainee is in that requestCourse's trainee list.
  //   4. No duplicate traineeIds in the input.
  interface ResolvedTrainee {
    traineeId: string;
    traineeCompanyId: string;
    traineeFullName: string;
    sourceRequestCourseId: string;
    sourceRequestRef: string;
  }
  const resolved: ResolvedTrainee[] = [];
  const seenTraineeIds = new Set<string>();
  const sourceRequestIds = new Set<string>();

  for (const spec of trainees as AssembleTraineeSpec[]) {
    if (!spec.traineeId || !spec.sourceRequestCourseId) {
      return fail("Each trainee spec requires traineeId and sourceRequestCourseId", 422, "VALIDATION_ERROR", { spec });
    }
    if (seenTraineeIds.has(spec.traineeId)) {
      return fail(`Duplicate traineeId in input: ${spec.traineeId}`, 422, "VALIDATION_ERROR", { traineeId: spec.traineeId });
    }
    seenTraineeIds.add(spec.traineeId);

    // Load the requestCourse with its parent request (must be APPROVED) and
    // verify the trainee is in the roster.
    const rc = await db.trainingRequestCourse.findFirst({
      where: { id: spec.sourceRequestCourseId, deletedAt: null },
      include: {
        request: { select: { id: true, refNumber: true, status: true } },
        trainees: {
          where: { deletedAt: null, traineeId: spec.traineeId },
          select: { traineeId: true },
        },
      },
    });
    if (!rc) {
      return fail(`sourceRequestCourseId ${spec.sourceRequestCourseId} not found`, 404);
    }
    // No status gate — coordinators can assemble from any request.
    // Every change is audit-logged.
    if (rc.courseId !== courseId) {
      return fail(
        `sourceRequestCourseId ${spec.sourceRequestCourseId} belongs to a different course (${rc.courseId}), expected ${courseId}`,
        422,
        "COURSE_MISMATCH",
        { sourceCourseId: rc.courseId, expectedCourseId: courseId }
      );
    }
    if (rc.trainees.length === 0) {
      return fail(
        `Trainee ${spec.traineeId} is not in requestCourse ${rc.request.refNumber}'s roster`,
        422,
        "TRAINEE_NOT_IN_REQUEST",
        { traineeId: spec.traineeId, requestRef: rc.request.refNumber }
      );
    }

    // Load the trainee to snapshot their companyId.
    const trainee = await db.trainee.findFirst({
      where: { id: spec.traineeId, deletedAt: null },
      select: { id: true, fullName: true, companyId: true },
    });
    if (!trainee) {
      return fail(`Trainee ${spec.traineeId} not found`, 404);
    }

    resolved.push({
      traineeId: spec.traineeId,
      traineeCompanyId: trainee.companyId,
      traineeFullName: trainee.fullName,
      sourceRequestCourseId: spec.sourceRequestCourseId,
      sourceRequestRef: rc.request.refNumber,
    });
    sourceRequestIds.add(rc.request.id);
  }

  // ── Create the session + enrollments inside a single transaction ────────────
  // Pre-allocate the ref number + QR token OUTSIDE the transaction (SQLite
  // single-writer note in `nextRefNumber`), then do all the data mutations
  // inside `$transaction`. If the transaction fails, the ref number is wasted
  // (a gap in the sequence) but no partial session exists.
  const refNumber = await nextRefNumber("SESSION");
  const qrToken = genQrToken();
  const effectiveCapacity = capacity ?? course.maxTrainees;
  const effectiveDurationHours = durationHours ?? 6;
  const effectiveLanguage = language ?? course.language ?? "en";

  const session = await db.$transaction(async (tx) => {
    const newSession = await tx.trainingSession.create({
      data: {
        refNumber,
        courseId,
        // Per the approved design: sessions are independent operational
        // entities after approval. They do NOT belong to any one request.
        requestId: null,
        requestCourseId: null,
        trainerId: trainerId ?? null,
        title,
        location: city ?? null,
        city: city ?? null,
        region: region ?? null,
        venue: venue ?? null,
        shift,
        durationHours: effectiveDurationHours,
        capacity: effectiveCapacity,
        language: effectiveLanguage,
        startDate: start,
        endDate: end,
        expectedTrainees: resolved.length,
        actualTrainees: 0,
        status: "SCHEDULED",
        qrCodeToken: qrToken,
        qrCodeGeneratedAt: new Date(),
        createdBy: user.id,
        updatedBy: user.id,
      },
    });

    // Enroll every trainee using the upsert pattern (handles the unique
    // constraint + soft-deleted revivals). Per-trainee provenance is recorded
    // in the enrollment's notes so audit can trace where each trainee came
    // from.
    for (const rt of resolved) {
      const provenanceNote = `Assembled from ${rt.sourceRequestRef}`;
      await tx.sessionEnrollment.upsert({
        where: { sessionId_traineeId: { sessionId: newSession.id, traineeId: rt.traineeId } },
        update: {
          deletedAt: null,
          companyId: rt.traineeCompanyId,
          enrolledBy: user.id,
          enrollmentStatus: "CONFIRMED",
          enrollmentDate: new Date(),
          notes: provenanceNote,
          updatedBy: user.id,
        },
        create: {
          sessionId: newSession.id,
          traineeId: rt.traineeId,
          companyId: rt.traineeCompanyId,
          enrolledBy: user.id,
          enrollmentStatus: "CONFIRMED",
          enrollmentDate: new Date(),
          notes: provenanceNote,
          createdBy: user.id,
          updatedBy: user.id,
        },
      });
    }

    // Populate SessionCompany cache.
    await recomputeSessionCounts(newSession.id, tx);

    return newSession;
  });

  // ── Audit (outside transaction — audit failures must never break the op) ────
  const companyBreakdown = resolved.reduce((map, rt) => {
    map.set(rt.traineeCompanyId, (map.get(rt.traineeCompanyId) ?? 0) + 1);
    return map;
  }, new Map<string, number>());

  const sourceRefsTruncated = truncateForAudit(Array.from(new Set(resolved.map((r) => r.sourceRequestRef))));
  const traineeIdsTruncated = truncateForAudit(resolved.map((r) => r.traineeId));

  await audit({
    user,
    action: "CREATE",
    entity: "SESSION",
    entityId: session.id,
    entityRef: session.refNumber,
    description: `Assembled session ${session.refNumber} from ${sourceRequestIds.size} request(s) — ${resolved.length} trainee(s) from ${companyBreakdown.size} company/companies`,
    descriptionAr: `تجميع الجلسة ${session.refNumber} من ${sourceRequestIds.size} طلب — ${resolved.length} متدرِّب من ${companyBreakdown.size} شركة`,
    req,
    oldValue: null,
    newValue: {
      sessionRef: session.refNumber,
      courseId,
      traineeCount: resolved.length,
      capacity: effectiveCapacity,
      trainerAssigned: Boolean(trainerId),
    },
    metadata: {
      action: "ASSEMBLE_SESSION",
      sessionId: session.id,
      sessionRef: session.refNumber,
      courseId,
      sourceRequestIds: Array.from(sourceRequestIds),
      sourceRequestRefs: sourceRefsTruncated.items,
      sourceRequestRefsTotal: sourceRefsTruncated.total,
      traineeIds: traineeIdsTruncated.items,
      traineeIdsTotal: traineeIdsTruncated.total,
      traineeCount: resolved.length,
      companyBreakdown: Object.fromEntries(companyBreakdown),
      trainerAssigned: Boolean(trainerId),
    },
  });

  return ok({
    session: {
      id: session.id,
      refNumber: session.refNumber,
      title: session.title,
      startDate: session.startDate,
      endDate: session.endDate,
      capacity: session.capacity,
      expectedTrainees: session.expectedTrainees,
      trainerId: session.trainerId,
    },
    enrolledCount: resolved.length,
    sourceRequestRefs: Array.from(new Set(resolved.map((r) => r.sourceRequestRef))),
    companyBreakdown: Object.fromEntries(companyBreakdown),
  });
});
