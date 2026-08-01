// /api/sessions/[id]/duplicate — clone a session with its trainees
//
// Per the ERP-flexibility requirements, the coordinator can duplicate a
// session: creates a new session with the same course, trainer, dates,
// venue, capacity, etc., AND copies all active enrollments.
//
// The original session is left unchanged (this is a copy, not a move).
// Each copied enrollment starts fresh (PENDING status, no attendance/exam).
//
// Body:
//   {
//     title?: string,         // override the title (default: "Copy of <original>")
//     startDate?: string,     // override dates
//     endDate?: string,
//     shift?: string,
//     trainerId?: string,
//     copyTrainees?: boolean, // default true — copy active enrollments
//   }
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { nextRefNumber } from "@/lib/api/ref-number";
import { recomputeSessionCounts, truncateForAudit } from "@/lib/sessions/session-management";
import { randomBytes } from "crypto";

function genQrToken(): string {
  return randomBytes(16).toString("hex");
}

export const POST = withModuleAction("sessions", "create", async ({ req, params, user }) => {
  const sourceId = params.id as string;
  const body = await req.json().catch(() => ({}));

  const source = await db.trainingSession.findUnique({
    where: { id: sourceId },
    include: {
      course: { select: { id: true, title: true, language: true } },
      enrollments: {
        where: { deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
        select: { traineeId: true, companyId: true },
      },
    },
  });
  if (!source || source.deletedAt) return notFound("Source session not found");

  const copyTrainees = body.copyTrainees !== false;

  // Pre-allocate ref number + QR token
  const refNumber = await nextRefNumber("SESSION");
  const qrToken = genQrToken();

  // Determine field values
  const title = body.title ?? `Copy of ${source.title}`;
  const startDate = body.startDate ? new Date(body.startDate) : source.startDate;
  const endDate = body.endDate ? new Date(body.endDate) : source.endDate;
  const shift = body.shift ?? source.shift;
  const trainerId = body.trainerId !== undefined ? body.trainerId : source.trainerId;

  // Create the duplicated session + copy enrollments in a transaction
  const newSession = await db.$transaction(async (tx) => {
    const session = await tx.trainingSession.create({
      data: {
        refNumber,
        courseId: source.courseId,
        requestId: null,
        requestCourseId: null,
        trainerId: trainerId ?? null,
        title,
        location: source.location,
        city: source.city,
        region: source.region,
        venue: source.venue,
        shift,
        durationHours: source.durationHours,
        capacity: source.capacity,
        language: source.language,
        startDate,
        endDate,
        expectedTrainees: copyTrainees ? source.enrollments.length : 0,
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

    if (copyTrainees && source.enrollments.length > 0) {
      for (const e of source.enrollments) {
        await tx.sessionEnrollment.upsert({
          where: { sessionId_traineeId: { sessionId: session.id, traineeId: e.traineeId } },
          update: {
            deletedAt: null,
            companyId: e.companyId,
            enrolledBy: user.id,
            enrollmentStatus: "PENDING",
            enrollmentDate: new Date(),
            enrollmentSource: "MANUAL",
            isReExam: false,
            addedByTrainer: false,
            pendingReview: false,
            updatedBy: user.id,
          },
          create: {
            sessionId: session.id,
            traineeId: e.traineeId,
            companyId: e.companyId,
            enrolledBy: user.id,
            enrollmentStatus: "PENDING",
            enrollmentDate: new Date(),
            enrollmentSource: "MANUAL",
            createdBy: user.id,
            updatedBy: user.id,
          },
        });
      }
      await recomputeSessionCounts(session.id, tx);
    }

    return session;
  }, { timeout: 30000, maxWait: 60000 });

  const copiedTraineeIds = copyTrainees ? source.enrollments.map((e) => e.traineeId) : [];
  const truncatedIds = truncateForAudit(copiedTraineeIds);

  await audit({
    user,
    action: "CREATE",
    entity: "SESSION",
    entityId: newSession.id,
    entityRef: newSession.refNumber,
    description: `Duplicated session ${source.refNumber} → ${newSession.refNumber} (${copyTrainees ? source.enrollments.length : 0} trainees copied)`,
    descriptionAr: `تكرار الجلسة ${source.refNumber} ← ${newSession.refNumber} (${copyTrainees ? source.enrollments.length : 0} متدرِّب منسوخ)`,
    req,
    oldValue: { sourceSessionRef: source.refNumber },
    newValue: { newSessionRef: newSession.refNumber, copiedTraineeCount: source.enrollments.length },
    metadata: {
      action: "DUPLICATE_SESSION",
      sourceSessionId: sourceId,
      sourceSessionRef: source.refNumber,
      newSessionId: newSession.id,
      newSessionRef: newSession.refNumber,
      copyTrainees,
      copiedTraineeIds: truncatedIds.items,
      copiedTraineeIdsTotal: truncatedIds.total,
    },
  });

  return ok({
    sourceSessionRef: source.refNumber,
    newSession: {
      id: newSession.id,
      refNumber: newSession.refNumber,
      title: newSession.title,
      startDate: newSession.startDate,
      endDate: newSession.endDate,
      capacity: newSession.capacity,
      expectedTrainees: newSession.expectedTrainees,
    },
    copiedTraineeCount: copyTrainees ? source.enrollments.length : 0,
  });
});
