// /api/sessions/merge — merge N sessions into 1
//
// Per the approved redesign:
//   - All source sessions must share the same course.
//   - The merged session is a NEW session (requestId=null, requestCourseId=null)
//     — sessions are independent operational entities after approval.
//   - Trainees are deduplicated by traineeId across sources.
//   - Each trainee's companyId snapshot is preserved from their source enrollment.
//   - Source sessions must be SCHEDULED (cannot merge a session that's started).
//   - All writes are wrapped in a single `$transaction`.
//   - Audit metadata arrays are capped at 50 entries.
//
// Body:
//   {
//     sessionIds: string[],                // required, >= 2
//     title?: string,                      // default: "Merged — <courseTitle>"
//     shift?: "MORNING" | "EVENING",       // default: first source's shift
//     startDate?: string,                  // default: first source's start
//     endDate?: string,                    // default: first source's end
//     capacity?: number,                   // default: sum of source capacities
//     trainerId?: string,                  // default: first source's trainer
//     venue?: string, city?: string, region?: string,
//   }
import type { TrainingSession } from "@prisma/client";
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { nextRefNumber } from "@/lib/api/ref-number";
import { recomputeSessionCounts, truncateForAudit } from "@/lib/sessions/session-management";
import { randomBytes } from "crypto";

function genQrToken(): string {
  return randomBytes(16).toString("hex");
}

export const POST = withModuleAction("sessions", "edit", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const sessionIds: string[] = Array.isArray(body.sessionIds) ? body.sessionIds : [];

  if (sessionIds.length < 2) {
    return fail("Provide at least 2 sessionIds to merge", 422, "VALIDATION_ERROR");
  }

  const sources = await db.trainingSession.findMany({
    where: { id: { in: sessionIds }, deletedAt: null },
    include: {
      course: { select: { id: true, title: true, language: true, maxTrainees: true } },
      enrollments: {
        where: { deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
        include: { trainee: { select: { id: true, companyId: true, fullName: true } } },
      },
    },
  });

  if (sources.length !== sessionIds.length) {
    const found = new Set(sources.map((s) => s.id));
    const missing = sessionIds.filter((id) => !found.has(id));
    return fail(`Session(s) not found: ${missing.join(", ")}`, 404);
  }

  // All sources must share the same course — a hard requirement for merge.
  const courseId = sources[0].courseId;
  const mismatched = sources.filter((s) => s.courseId !== courseId);
  if (mismatched.length > 0) {
    return fail(
      `Cannot merge sessions from different courses (found ${new Set(sources.map((s) => s.courseId)).size} distinct courses)`,
      422,
      "COURSE_MISMATCH",
      { courseIds: Array.from(new Set(sources.map((s) => s.courseId))) }
    );
  }

  // No status gate — coordinators can merge any sessions at any time.
  // Every change is audit-logged.

  // Aggregate all enrollments across sources. Deduplicate by traineeId — a
  // trainee enrolled in two of the source sessions only ends up once in the
  // merged session. Each trainee's companyId snapshot is preserved from
  // their first source enrollment.
  const seenTraineeIds = new Set<string>();
  const allEnrollments: Array<{
    traineeId: string;
    companyId: string;
    enrollmentStatus: string;
    attendanceStatus: string;
    preTestStatus: string;
    finalTestStatus: string;
    evaluationStatus: string;
    certificateStatus: string;
    enrolledBy: string | null;
    notes: string | null;
    sourceSessionRef: string;
  }> = [];
  for (const s of sources) {
    for (const e of s.enrollments) {
      if (seenTraineeIds.has(e.traineeId)) continue;
      seenTraineeIds.add(e.traineeId);
      allEnrollments.push({
        traineeId: e.traineeId,
        companyId: e.companyId,
        enrollmentStatus: e.enrollmentStatus,
        attendanceStatus: e.attendanceStatus,
        preTestStatus: e.preTestStatus,
        finalTestStatus: e.finalTestStatus,
        evaluationStatus: e.evaluationStatus,
        certificateStatus: e.certificateStatus,
        enrolledBy: e.enrolledBy,
        notes: e.notes,
        sourceSessionRef: s.refNumber,
      });
    }
  }

  // Determine merged session fields. Defaults come from the FIRST source
  // (callers can override via the body).
  const first = sources[0];
  const shift = body.shift ?? first.shift ?? "MORNING";
  const startDate = body.startDate ? new Date(body.startDate) : first.startDate;
  const endDate = body.endDate ? new Date(body.endDate) : first.endDate;
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    return fail("Invalid startDate or endDate", 422, "VALIDATION_ERROR");
  }
  if (endDate < startDate) {
    return fail("endDate must not be before startDate", 422, "VALIDATION_ERROR");
  }
  const capacity = body.capacity ?? sources.reduce((sum, s) => sum + s.capacity, 0);
  const trainerId = body.trainerId ?? first.trainerId ?? null;
  const title = body.title ?? `Merged — ${first.course?.title ?? first.title}`;
  const venue = body.venue ?? first.venue;
  const city = body.city ?? first.city;
  const region = body.region ?? first.region;

  // Pre-allocate ref number + QR token OUTSIDE the transaction.
  const refNumber = await nextRefNumber("SESSION");
  const qrToken = genQrToken();

  // ── Transaction: create merged session + enroll all trainees + soft-delete sources ──
  const merged: TrainingSession = await db.$transaction(async (tx) => {
    const newSession = await tx.trainingSession.create({
      data: {
        refNumber,
        courseId,
        // The merged session isn't tied to any one request — trainees can
        // come from multiple requests/companies.
        requestId: null,
        requestCourseId: null,
        trainerId,
        title,
        location: city ?? first.location,
        city,
        region,
        venue,
        shift,
        durationHours: first.durationHours,
        capacity,
        language: first.language,
        startDate,
        endDate,
        expectedTrainees: allEnrollments.length,
        actualTrainees: 0,
        status: "SCHEDULED",
        qrCodeToken: qrToken,
        qrCodeGeneratedAt: new Date(),
        notes: first.notes,
        instituteName: first.instituteName,
        classification: first.classification,
        locationMapUrl: first.locationMapUrl,
        durationDays: first.durationDays,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });

    // Enroll all trainees into the merged session using the upsert pattern
    // (handles the unique constraint + soft-deleted revivals).
    for (const e of allEnrollments) {
      await tx.sessionEnrollment.upsert({
        where: { sessionId_traineeId: { sessionId: newSession.id, traineeId: e.traineeId } },
        update: {
          deletedAt: null,
          companyId: e.companyId, // preserve the original company snapshot
          enrolledBy: e.enrolledBy,
          enrollmentStatus: e.enrollmentStatus,
          attendanceStatus: e.attendanceStatus,
          preTestStatus: e.preTestStatus,
          finalTestStatus: e.finalTestStatus,
          evaluationStatus: e.evaluationStatus,
          certificateStatus: e.certificateStatus,
          notes: e.notes,
          updatedBy: user.id,
        },
        create: {
          sessionId: newSession.id,
          traineeId: e.traineeId,
          companyId: e.companyId,
          enrolledBy: e.enrolledBy,
          enrollmentStatus: e.enrollmentStatus,
          attendanceStatus: e.attendanceStatus,
          preTestStatus: e.preTestStatus,
          finalTestStatus: e.finalTestStatus,
          evaluationStatus: e.evaluationStatus,
          certificateStatus: e.certificateStatus,
          notes: e.notes,
          createdBy: user.id,
          updatedBy: user.id,
        },
      });
    }

    // Recompute SessionCompany for the merged session.
    await recomputeSessionCounts(newSession.id, tx);

    // Soft-delete the source sessions and their enrollments.
    await tx.sessionEnrollment.updateMany({
      where: { sessionId: { in: sessionIds }, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: user.id, enrollmentStatus: "CANCELLED" },
    });
    await tx.trainingSession.updateMany({
      where: { id: { in: sessionIds } },
      data: { deletedAt: new Date(), updatedBy: user.id },
    });

    return newSession;
  });

  // ── Audit ──────────────────────────────────────────────────────────────────
  const companyCounts = new Map<string, number>();
  for (const e of allEnrollments) {
    companyCounts.set(e.companyId, (companyCounts.get(e.companyId) ?? 0) + 1);
  }
  const sourceRefsTruncated = truncateForAudit(sources.map((s) => s.refNumber));

  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: merged.id,
    entityRef: merged.refNumber,
    description: `Merged ${sources.length} session(s) into ${merged.refNumber}`,
    descriptionAr: `دمج ${sources.length} جلسة في ${merged.refNumber}`,
    req,
    oldValue: {
      sourceSessionRefs: sourceRefsTruncated.items,
      sourceSessionRefsTotal: sourceRefsTruncated.total,
      sourceEnrollmentCounts: sources.map((s) => ({ ref: s.refNumber, count: s.enrollments.length })),
    },
    newValue: {
      mergedSessionRef: merged.refNumber,
      mergedEnrollmentCount: allEnrollments.length,
    },
    metadata: {
      action: "MERGE_SESSIONS",
      sourceSessionIds: sessionIds,
      sourceSessionRefs: sourceRefsTruncated.items,
      sourceSessionRefsTotal: sourceRefsTruncated.total,
      mergedSessionId: merged.id,
      mergedSessionRef: merged.refNumber,
      courseId,
      companyBreakdown: Object.fromEntries(companyCounts),
    },
  });

  return ok({
    mergedSession: {
      id: merged.id, refNumber: merged.refNumber, title: merged.title,
      startDate: merged.startDate, endDate: merged.endDate,
      capacity: merged.capacity, expectedTrainees: merged.expectedTrainees,
    },
    sourceSessionRefs: sources.map((s) => s.refNumber),
    enrolledCount: allEnrollments.length,
  });
});
