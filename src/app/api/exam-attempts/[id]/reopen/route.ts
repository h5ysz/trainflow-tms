// /api/exam-attempts/[id]/reopen — reopen a graded/submitted exam attempt
// back to IN_PROGRESS so the trainee can re-take or re-submit.
//
// Business rules:
//   - The attempt must be in GRADED or SUBMITTED status.
//   - A certificate must NOT have been issued for this trainee in this session.
//   - The caller must hold the `finalTest.edit` or `preTest.edit` permission.
//   - Reopening clears the score + passed + answers so the attempt is a clean
//     slate. The trainee (or trainer on their behalf) can then re-submit.
//   - The audit log records the old score/passed, user, role, timestamp,
//     and the required reason.
//
// Body:
//   { reason: string }  (required — reopening must always have a reason)
import { db } from "@/lib/db";
import { withExamAction, ok, notFound, fail, type TestType } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";

export const POST = withExamAction("edit", async ({ req, params, user, allowedTestTypes }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const { reason } = body;

  // ── Validate input ──────────────────────────────────────────────────────
  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    return fail("A reason is required to reopen an exam attempt", 422, "VALIDATION_ERROR");
  }

  // ── Fetch the attempt ───────────────────────────────────────────────────
  const attempt = await db.examAttempt.findUnique({
    where: { id },
    include: {
      trainingSession: {
        select: { id: true, refNumber: true },
      },
    },
  });
  if (!attempt || attempt.deletedAt) return notFound("Exam attempt not found");

  // RBAC: verify test type.
  if (!allowedTestTypes.includes(attempt.testType as TestType)) {
    return fail(`Forbidden — no access to ${attempt.testType} attempts`, 403);
  }

  // ── Status gate ─────────────────────────────────────────────────────────
  if (attempt.status !== "GRADED" && attempt.status !== "SUBMITTED") {
    return fail(
      `Cannot reopen: attempt status is ${attempt.status}. Only GRADED or SUBMITTED attempts can be reopened.`,
      422,
      "INVALID_STATUS",
    );
  }

  // ── Certificate lock ────────────────────────────────────────────────────
  const existingCert = await db.certificate.findFirst({
    where: {
      sessionId: attempt.sessionId,
      traineeName: attempt.traineeName,
      traineeIdNational: attempt.traineeIdNational ?? undefined,
      deletedAt: null,
    },
    select: { id: true, refNumber: true },
  });
  if (existingCert) {
    return fail(
      `Cannot reopen: certificate ${existingCert.refNumber} already issued for this trainee. Results are permanently locked once a certificate is issued.`,
      422,
      "CERTIFICATE_LOCKED",
      { certificateRef: existingCert.refNumber },
    );
  }

  // ── Capture old values for audit ────────────────────────────────────────
  const oldScore = attempt.scorePercent;
  const oldPassed = attempt.passed;
  const oldStatus = attempt.status;

  // ── Reopen: reset to IN_PROGRESS, clear score/answers ───────────────────
  const updated = await db.examAttempt.update({
    where: { id },
    data: {
      status: "IN_PROGRESS",
      scorePercent: null,
      passed: null,
      answers: null,
      submittedAt: null,
      updatedBy: user.id,
      updatedAt: new Date(),
    },
  });

  // ── Sync the enrollment's test status back to IN_PROGRESS ───────────────
  if (attempt.testType === "FINAL_TEST" || attempt.testType === "PRE_TEST") {
    const enrollment = await db.sessionEnrollment.findFirst({
      where: {
        sessionId: attempt.sessionId,
        deletedAt: null,
        trainee: {
          fullName: attempt.traineeName,
          ...(attempt.traineeIdNational ? { nationalId: attempt.traineeIdNational } : {}),
        },
      },
    });
    if (enrollment) {
      const statusField = attempt.testType === "FINAL_TEST" ? "finalTestStatus" : "preTestStatus";
      await db.sessionEnrollment.update({
        where: { id: enrollment.id },
        data: {
          [statusField]: "IN_PROGRESS",
          updatedBy: user.id,
        },
      });
    }
  }

  // ── Audit log ───────────────────────────────────────────────────────────
  await recordAudit({
    userId: user.id,
    action: "UPDATE",
    entity: "EXAM_ATTEMPT",
    entityId: attempt.id,
    entityRef: attempt.refNumber,
    description: `Reopened ${attempt.testType} attempt for ${attempt.traineeName}: score ${oldScore}% → cleared, status ${oldStatus} → IN_PROGRESS — ${reason}`,
    descriptionAr: `إعادة فتح محاولة ${attempt.testType === "PRE_TEST" ? "الاختبار القبلي" : "الاختبار النهائي"} للمتدرب ${attempt.traineeName}: النتيجة ${oldScore}% ← مُسحت، الحالة ${oldStatus} ← قيد التقدم — ${reason}`,
    oldValue: {
      scorePercent: oldScore,
      passed: oldPassed,
      status: oldStatus,
    },
    newValue: {
      scorePercent: null,
      passed: null,
      status: "IN_PROGRESS",
    },
    reason,
    req,
    metadata: {
      action: "REOPEN_EXAM_ATTEMPT",
      attemptId: attempt.id,
      attemptRef: attempt.refNumber,
      testType: attempt.testType,
      traineeName: attempt.traineeName,
      traineeIdNational: attempt.traineeIdNational,
      sessionId: attempt.sessionId,
      sessionRef: attempt.trainingSession.refNumber,
      oldScore,
      oldPassed,
      oldStatus,
      newStatus: "IN_PROGRESS",
      reason,
    },
  });

  return ok({
    attemptId: attempt.id,
    refNumber: attempt.refNumber,
    oldStatus,
    newStatus: "IN_PROGRESS",
    oldScorePercent: oldScore,
    reason,
  });
});
