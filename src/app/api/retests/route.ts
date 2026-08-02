// /api/retests — list all retests + create a new Official Retest
//
// GET:  list retests (filterable by sessionId, enrollmentId, status, companyId)
// POST: create a new Official Retest
//
// Business rules (final version):
//   - Only OFFICIAL retests are stored here. Trainer opportunities are
//     tracked on the enrollment (trainerOpportunityUsed field), NOT as
//     RetestRequest records.
//   - Official Retest requires that the trainer opportunity has been
//     used AND failed (trainerOpportunityUsed=true, trainerOpportunityPassed=false).
//   - Max 1 Official Retest per enrollment.
//   - Contractor is notified "Failed Final Assessment" on creation.
//
// RBAC: Trainer + Coordinator (sessions.edit). Contractors are blocked.
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
  const { enrollmentId, sessionId, failedAttemptId, reason } = body;

  if (!enrollmentId || !sessionId) {
    return fail("enrollmentId and sessionId are required", 422, "VALIDATION_ERROR");
  }

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

  // ── Rule: trainer opportunity must be used AND failed first ─────────────
  if (!enrollment.trainerOpportunityUsed) {
    return fail(
      "Cannot create an official retest before the trainer opportunity has been used. The trainer must first give the trainee an immediate opportunity in the same session.",
      422,
      "TRAINER_OPPORTUNITY_REQUIRED_FIRST",
    );
  }
  if (enrollment.trainerOpportunityPassed === true) {
    return fail(
      "Cannot create an official retest: the trainee already passed the trainer opportunity.",
      422,
      "ALREADY_PASSED",
    );
  }

  // ── Check if an official retest already exists ──────────────────────────
  const existingOfficial = await db.retestRequest.findFirst({
    where: {
      enrollmentId,
      retestType: "OFFICIAL",
      status: { in: ["PENDING_RETEST", "SCHEDULED", "RESCHEDULED", "COMPLETED"] },
      deletedAt: null,
    },
  });
  if (existingOfficial) {
    return fail(
      `An official retest already exists for this enrollment (Ref: ${existingOfficial.refNumber}). Only one official retest is allowed.`,
      422,
      "OFFICIAL_RETEST_ALREADY_EXISTS",
      { existingRetestRef: existingOfficial.refNumber },
    );
  }

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
      "No failed final test attempt found for this trainee.",
      422,
      "NO_FAILED_ATTEMPT",
    );
  }

  // Create the official retest request
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
      retestType: "OFFICIAL",
      status: "PENDING_RETEST",
      failedAttemptId: failedAttempt.id,
      reason: reason ?? null,
      createdBy: user.id,
      updatedBy: user.id,
      updatedAt: now,
    },
  });

  // ── Notify contractor: "Failed Final Assessment" ────────────────────────
  if (trainee.companyId) {
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
    description: `Official retest created for ${trainee.fullName} (failed with ${failedAttempt.scorePercent}%)`,
    descriptionAr: `تم إنشاء إعادة الاختبار الرسمية للمتدرب ${trainee.fullName} (راسب بنسبة ${failedAttempt.scorePercent}%)`,
    req,
    metadata: {
      action: "OFFICIAL_RETEST_CREATED",
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
