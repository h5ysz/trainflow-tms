// /api/retests — list all retests + create a new retest request
//
// GET:  list retests (filterable by sessionId, enrollmentId, status, companyId, retestType)
// POST: create a new retest request — supports two types:
//   - retestType: "TRAINER_OPPORTUNITY" → Trainer Immediate Opportunity
//     (same session only, no contractor notification, no official retest)
//   - retestType: "OFFICIAL" → Official Retest
//     (full workflow with contractor notifications + scheduling)
//
// Business rules:
//   - TRAINER_OPPORTUNITY: max 1 per enrollment. Does NOT notify contractor.
//   - OFFICIAL: max 1 per enrollment (after trainer opportunity is used).
//     Notifies contractor "Assessment Failed" on creation.
//   - If an OFFICIAL retest already exists for this enrollment, reject.
//
// RBAC:
//   - TRAINER_OPPORTUNITY: Trainer + Coordinator (sessions.edit)
//   - OFFICIAL: Trainer + Coordinator (sessions.edit)
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { nextRefNumber } from "@/lib/api/ref-number";
import { notifyContractors } from "@/lib/retest/notifications";
import { randomUUID } from "node:crypto";

const ALLOWED_SORT_FIELDS = ["refNumber", "createdAt", "status", "retestDate"];

export const GET = withModuleAction("sessions", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.filters.sessionId) where.sessionId = q.filters.sessionId;
  if (q.filters.enrollmentId) where.enrollmentId = q.filters.enrollmentId;
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.companyId) where.companyId = q.filters.companyId;
  if (q.filters.retestType) where.retestType = q.filters.retestType;

  // Contractors see only their own company's retests
  if (user.role === "CONTRACTOR" && user.companyId) {
    where.companyId = user.companyId;
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "createdAt");

  const [rows, total] = await Promise.all([
    db.retestRequest.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.retestRequest.count({ where }),
  ]);

  return list(rows, buildListMeta(total, q));
});

export const POST = withModuleAction("sessions", "edit", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { enrollmentId, sessionId, failedAttemptId, reason, retestType } = body;

  if (!enrollmentId || !sessionId) {
    return fail("enrollmentId and sessionId are required", 422, "VALIDATION_ERROR");
  }

  const type = (retestType === "TRAINER_OPPORTUNITY" ? "TRAINER_OPPORTUNITY" : "OFFICIAL") as
    "TRAINER_OPPORTUNITY" | "OFFICIAL";

  // Fetch the enrollment + session + course + trainee info
  const enrollment = await db.sessionEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      trainee: { select: { id: true, fullName: true, nationalId: true, companyId: true } },
      trainingSession: {
        select: {
          id: true, refNumber: true, courseId: true,
          course: { select: { id: true, title: true, titleAr: true } },
        },
      },
    },
  });

  if (!enrollment || enrollment.deletedAt) {
    return fail("Enrollment not found", 404);
  }

  const session = enrollment.trainingSession;
  const trainee = enrollment.trainee;

  // Verify there's a failed final test attempt
  const failedAttempt = failedAttemptId
    ? await db.examAttempt.findUnique({ where: { id: failedAttemptId } })
    : await db.examAttempt.findFirst({
        where: {
          sessionId,
          traineeName: trainee.fullName,
          testType: "FINAL_TEST",
          status: "GRADED",
          passed: false,
          deletedAt: null,
        },
        orderBy: { submittedAt: "desc" },
      });

  if (!failedAttempt) {
    return fail(
      "No failed final test attempt found for this trainee. A retest can only be created after a failed assessment.",
      422,
      "NO_FAILED_ATTEMPT",
    );
  }

  // ── Check existing retests for this enrollment ──────────────────────────
  const existingTrainerOpp = await db.retestRequest.findFirst({
    where: {
      enrollmentId,
      retestType: "TRAINER_OPPORTUNITY",
      deletedAt: null,
    },
  });
  const existingOfficial = await db.retestRequest.findFirst({
    where: {
      enrollmentId,
      retestType: "OFFICIAL",
      status: { in: ["PENDING_RETEST", "SCHEDULED", "RESCHEDULED", "COMPLETED"] },
      deletedAt: null,
    },
  });

  if (type === "TRAINER_OPPORTUNITY" && existingTrainerOpp) {
    return fail(
      "A trainer immediate opportunity has already been used for this enrollment. Only one is allowed.",
      422,
      "TRAINER_OPPORTUNITY_ALREADY_USED",
    );
  }

  if (type === "OFFICIAL" && existingOfficial) {
    return fail(
      `An official retest already exists for this enrollment (Ref: ${existingOfficial.refNumber}). Only one official retest is allowed.`,
      422,
      "OFFICIAL_RETEST_ALREADY_EXISTS",
      { existingRetestRef: existingOfficial.refNumber },
    );
  }

  // ── Official retest requires that the trainer opportunity was already used ──
  // Business rule: Attempt #1 → Trainer Opportunity → Official Retest.
  // The trainer opportunity must be exhausted before an official retest.
  if (type === "OFFICIAL" && !existingTrainerOpp) {
    return fail(
      "Cannot create an official retest before the trainer immediate opportunity has been used. The trainer must first give the trainee an immediate opportunity in the same session.",
      422,
      "TRAINER_OPPORTUNITY_REQUIRED_FIRST",
    );
  }

  // ── If the trainer opportunity was used and FAILED, allow official retest ──
  if (type === "OFFICIAL" && existingTrainerOpp && existingTrainerOpp.passed === true) {
    return fail(
      "Cannot create an official retest: the trainee already passed the trainer immediate opportunity.",
      422,
      "ALREADY_PASSED",
    );
  }

  // Create the retest request
  const refNumber = await nextRefNumber("RETEST");
  const now = new Date();
  const retest = await db.retestRequest.create({
    data: {
      id: randomUUID(),
      refNumber,
      enrollmentId,
      sessionId,
      courseId: session.courseId,
      traineeName: trainee.fullName,
      traineeIdNational: trainee.nationalId,
      companyId: trainee.companyId,
      retestType: type,
      status: type === "TRAINER_OPPORTUNITY" ? "SCHEDULED" : "PENDING_RETEST",
      failedAttemptId: failedAttempt.id,
      reason: reason ?? null,
      // For trainer opportunity, the retest happens in the SAME session —
      // no scheduling fields are set (the trainer just gives the opportunity
      // immediately during the current session).
      scheduledBy: type === "TRAINER_OPPORTUNITY" ? user.id : null,
      scheduledAt: type === "TRAINER_OPPORTUNITY" ? now : null,
      createdBy: user.id,
      updatedBy: user.id,
      updatedAt: now,
    },
  });

  // ── Notifications ───────────────────────────────────────────────────────
  // TRAINER_OPPORTUNITY: NO contractor notification (per business rules).
  // OFFICIAL: notify contractor "Assessment Failed".
  if (type === "OFFICIAL" && trainee.companyId) {
    await notifyContractors(
      {
        companyId: trainee.companyId,
        traineeName: trainee.fullName,
        courseTitle: session.course.title,
        sessionRef: session.refNumber,
        retestRef: retest.refNumber,
        scorePercent: failedAttempt.scorePercent,
      },
      "FAILED_ASSESSMENT",
    );
  }

  await audit({
    user,
    action: "CREATE",
    entity: "RETEST",
    entityId: retest.id,
    entityRef: retest.refNumber,
    description: `${type === "TRAINER_OPPORTUNITY" ? "Trainer immediate opportunity" : "Official retest"} created for ${trainee.fullName} (failed with ${failedAttempt.scorePercent}%)`,
    descriptionAr: `${type === "TRAINER_OPPORTUNITY" ? "فرصة المدرّب الفورية" : "إعادة الاختبار الرسمية"} للمتدرب ${trainee.fullName} (راسب بنسبة ${failedAttempt.scorePercent}%)`,
    req,
    metadata: {
      action: type === "TRAINER_OPPORTUNITY" ? "TRAINER_OPPORTUNITY_USED" : "OFFICIAL_RETEST_CREATED",
      enrollmentId,
      sessionId,
      sessionRef: session.refNumber,
      traineeName: trainee.fullName,
      failedScore: failedAttempt.scorePercent,
      reason: reason ?? null,
    },
  });

  return created(retest);
});
