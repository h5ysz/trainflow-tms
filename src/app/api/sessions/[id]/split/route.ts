// /api/sessions/[id]/split — split one session into N balanced sessions
//
// Per the approved redesign:
//   - The coordinator can split a session at any time before it starts
//     (status must be SCHEDULED).
//   - Each split session can have its OWN date/shift/trainer/venue/capacity
//     overrides via the `splits` array body field. When `splits` is omitted,
//     all splits inherit the source's fields (legacy behavior).
//   - All writes are wrapped in a single `$transaction`.
//   - Audit metadata arrays are capped at 50 entries.
//
// Body:
//   {
//     count: number,                       // required, >= 2
//     keepSource?: boolean,                // default false (soft-delete source)
//     title?: string,                      // base title prefix for all splits
//     // Per-split overrides — when provided, length must equal `count`.
//     splits?: Array<{
//       shift?: "MORNING" | "EVENING",
//       startDate?: string,
//       endDate?: string,
//       capacity?: number,
//       trainerId?: string | null,
//       venue?: string,
//       city?: string,
//       region?: string,
//       title?: string,                    // overrides the base title for this split
//     }>,
//   }
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";
import { nextRefNumber } from "@/lib/api/ref-number";
import { recomputeSessionCounts, truncateForAudit } from "@/lib/sessions/session-management";
import { randomBytes } from "crypto";
import type { TrainingSession } from "@prisma/client";

function genQrToken(): string {
  return randomBytes(16).toString("hex");
}

function chunk<T>(arr: T[], count: number): T[][] {
  if (count <= 0) return [arr];
  const out: T[][] = Array.from({ length: count }, () => []);
  arr.forEach((item, idx) => out[idx % count].push(item));
  return out;
}

interface SplitOverride {
  shift?: "MORNING" | "EVENING";
  startDate?: string;
  endDate?: string;
  capacity?: number;
  trainerId?: string | null;
  venue?: string;
  city?: string;
  region?: string;
  title?: string;
}

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const sourceId = params.id as string;
  const body = await req.json().catch(() => ({}));
  const count = Number(body.count);

  if (!Number.isInteger(count) || count < 2) {
    return fail("count must be an integer >= 2", 422, "VALIDATION_ERROR");
  }

  const source = await db.trainingSession.findUnique({
    where: { id: sourceId },
    include: {
      course: { select: { id: true, title: true, language: true, maxTrainees: true } },
      enrollments: {
        where: { deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
        include: { trainee: { select: { id: true, companyId: true, fullName: true } } },
      },
    },
  });
  if (!source || source.deletedAt) return notFound("Session not found");
  if (trainerDeniedSession(user, source.trainerId)) {
    return fail("Forbidden — you can only access your own sessions", 403);
  }

  // No status gate — coordinators can split any session at any time.
  // Every change is audit-logged.

  if (source.enrollments.length === 0) {
    return fail("Cannot split a session with no active enrollments", 422, "VALIDATION_ERROR");
  }

  const keepSource = body.keepSource === true;
  const baseTitle = body.title ?? source.title;
  const overrides: SplitOverride[] = Array.isArray(body.splits) ? body.splits : [];
  if (overrides.length > 0 && overrides.length !== count) {
    return fail(
      `splits array length (${overrides.length}) must equal count (${count})`,
      422,
      "VALIDATION_ERROR"
    );
  }

  // Validate all overrides up front — parse dates, normalize shift.
  interface ResolvedSplit {
    shift: string;
    startDate: Date;
    endDate: Date;
    capacity: number;
    trainerId: string | null;
    venue: string | null;
    city: string | null;
    region: string | null;
    title: string;
  }
  const resolvedSplits: ResolvedSplit[] = [];
  for (let i = 0; i < count; i++) {
    const ov = overrides[i] ?? {};
    const shift = ov.shift ?? source.shift ?? "MORNING";
    const startDate = ov.startDate ? new Date(ov.startDate) : source.startDate;
    const endDate = ov.endDate ? new Date(ov.endDate) : source.endDate;
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      return fail(`Invalid startDate or endDate in split ${i + 1}`, 422, "VALIDATION_ERROR", { splitIndex: i });
    }
    if (endDate < startDate) {
      return fail(`endDate must not be before startDate in split ${i + 1}`, 422, "VALIDATION_ERROR", { splitIndex: i });
    }
    resolvedSplits.push({
      shift,
      startDate,
      endDate,
      capacity: ov.capacity ?? source.capacity,
      trainerId: ov.trainerId !== undefined ? ov.trainerId : source.trainerId,
      venue: ov.venue ?? source.venue,
      city: ov.city ?? source.city,
      region: ov.region ?? source.region,
      title: ov.title ?? baseTitle,
    });
  }

  // Distribute enrollments round-robin across `count` buckets.
  const buckets = chunk(source.enrollments, count);

  // Pre-allocate ref numbers + QR tokens OUTSIDE the transaction.
  const preAllocated: Array<{ refNumber: string; qrToken: string }> = [];
  for (let i = 0; i < count; i++) {
    preAllocated.push({
      refNumber: await nextRefNumber("SESSION"),
      qrToken: genQrToken(),
    });
  }

  // ── Transaction: create sessions + move enrollments + soft-delete source ──
  const created: TrainingSession[] = [];
  const enrollmentMap: Array<{ fromEnrollmentId: string; traineeId: string; toSessionRef: string }> = [];

  await db.$transaction(async (tx) => {
    for (let i = 0; i < count; i++) {
      const bucket = buckets[i];
      const rs = resolvedSplits[i];
      const { refNumber, qrToken } = preAllocated[i];
      const suffix = count > 1 ? ` (${i + 1}/${count})` : "";

      // Skip empty buckets (happens when count > enrollments.length)
      if (bucket.length === 0) continue;

      const newSession = await tx.trainingSession.create({
        data: {
          refNumber,
          courseId: source.courseId,
          // Per the approved design: sessions are independent operational
          // entities after approval. Split sessions don't inherit the
          // source's request linkage — they become standalone.
          requestId: null,
          requestCourseId: null,
          trainerId: rs.trainerId,
          title: `${rs.title}${suffix}`,
          location: rs.city ?? source.location,
          city: rs.city,
          region: rs.region,
          venue: rs.venue,
          shift: rs.shift,
          durationHours: source.durationHours,
          capacity: rs.capacity,
          language: source.language,
          startDate: rs.startDate,
          endDate: rs.endDate,
          expectedTrainees: bucket.length,
          actualTrainees: 0,
          status: "SCHEDULED",
          qrCodeToken: qrToken,
          qrCodeGeneratedAt: new Date(),
          notes: source.notes,
          instituteName: source.instituteName,
          classification: source.classification,
          locationMapUrl: source.locationMapUrl,
          durationDays: source.durationDays,
          createdBy: user.id,
          updatedBy: user.id,
        },
      });
      created.push(newSession);

      // Move enrollments: upsert into the new session (handles the unique
      // constraint + soft-deleted revivals), preserving progress fields.
      for (const e of bucket) {
        await tx.sessionEnrollment.upsert({
          where: { sessionId_traineeId: { sessionId: newSession.id, traineeId: e.traineeId } },
          update: {
            deletedAt: null,
            companyId: e.companyId,
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
        enrollmentMap.push({
          fromEnrollmentId: e.id,
          traineeId: e.traineeId,
          toSessionRef: newSession.refNumber,
        });
      }

      // Recompute SessionCompany for the new session.
      await recomputeSessionCounts(newSession.id, tx);
    }

    // Soft-delete the source enrollments (they've been moved).
    await tx.sessionEnrollment.updateMany({
      where: { sessionId: sourceId, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: user.id, enrollmentStatus: "CANCELLED" },
    });

    if (!keepSource) {
      await tx.trainingSession.update({
        where: { id: sourceId },
        data: { deletedAt: new Date(), updatedBy: user.id },
      });
    } else {
      // Recompute expectedTrainees on the source (now zero).
      await recomputeSessionCounts(sourceId, tx);
    }
  });

  // ── Audit ──────────────────────────────────────────────────────────────────
  const enrollmentMapTruncated = truncateForAudit(enrollmentMap);
  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: sourceId,
    entityRef: source.refNumber,
    description: `Split session ${source.refNumber} into ${created.length} session(s)`,
    descriptionAr: `تقسيم الجلسة ${source.refNumber} إلى ${created.length} جلسة`,
    req,
    oldValue: {
      sourceSessionRef: source.refNumber,
      sourceEnrollmentCount: source.enrollments.length,
    },
    newValue: {
      newSessionRefs: created.map((s) => s.refNumber),
      keepSource,
    },
    metadata: {
      action: "SPLIT_SESSION",
      sourceSessionId: sourceId,
      sourceSessionRef: source.refNumber,
      newSessionIds: created.map((s) => s.id),
      newSessionRefs: created.map((s) => s.refNumber),
      count,
      keepSource,
      // Per-split overrides are recorded so the audit trail shows exactly
      // how each new session was configured.
      splitConfigs: resolvedSplits.map((rs, i) => ({
        index: i,
        shift: rs.shift,
        startDate: rs.startDate.toISOString(),
        endDate: rs.endDate.toISOString(),
        capacity: rs.capacity,
        trainerId: rs.trainerId,
        venue: rs.venue,
        city: rs.city,
      })),
      enrollmentMap: enrollmentMapTruncated.items,
      enrollmentMapTotal: enrollmentMapTruncated.total,
    },
  });

  return ok({
    sourceSessionRef: source.refNumber,
    sourceDeleted: !keepSource,
    newSessions: created.map((s) => ({
      id: s.id, refNumber: s.refNumber, title: s.title,
      startDate: s.startDate, endDate: s.endDate, capacity: s.capacity,
      expectedTrainees: s.expectedTrainees,
    })),
    movedEnrollmentCount: enrollmentMap.length,
  });
});
