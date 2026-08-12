// /api/exam-attempts/[id]/edit-result — edit the score + pass/fail status of a
// graded exam attempt. This is the ERP "edit results before certificate
// issuance" workflow.
//
// Business rules:
//   - The attempt must be in GRADED or SUBMITTED status (i.e. already scored).
//   - A certificate must NOT have been issued for this trainee in this session.
//     Once a certificate exists, results are permanently locked.
//   - The caller must hold the `finalTest.edit` or `preTest.edit` permission
//     (coordinators + trainers with the permission). Contractors are blocked.
//   - The audit log records old + new score, old + new passed, user, role,
//     timestamp, and the optional reason.
//
// Body:
//   { scorePercent: number, passed?: boolean, reason?: string }
//
// If `passed` is omitted, it's computed from scorePercent >= passScore.
import { db } from "@/lib/db";
import { withExamAction, ok, notFound, fail, type TestType } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";

export const PUT = withExamAction("edit", async ({ req, params, user, allowedTestTypes }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const { scorePercent, passed, reason } = body;

  // ── Validate input ──────────────────────────────────────────────────────
  if (scorePercent === undefined || scorePercent === null) {
    return fail("scorePercent is required", 422, "VALIDATION_ERROR");
  }
  const newScore = Number(scorePercent);
  if (Number.isNaN(newScore) || newScore < 0 || newScore > 100) {
    return fail("scorePercent must be a number between 0 and 100", 422, "VALIDATION_ERROR");
  }

  // ── Fetch the attempt ───────────────────────────────────────────────────
  const attempt = await db.examAttempt.findUnique({
    where: { id },
    include: {
      session: {
        select: { id: true, refNumber: true, courseId: true, trainerId: true, course: { select: { passScore: true } } },
      },
    },
  });
  if (!attempt || attempt.deletedAt) return notFound("Exam attempt not found");

  // A trainer may only edit results of attempts from their own sessions.
  if (trainerDeniedSession(user, attempt.session?.trainerId)) {
    return fail("Forbidden — you can only edit results of your own sessions", 403);
  }

  // Verify the test type is in the caller's allowed types (RBAC).
  if (!allowedTestTypes.includes(attempt.testType as TestType)) {
    return fail(`Forbidden — no access to ${attempt.testType} attempts`, 403);
  }

  // ── Status gate: only graded/submitted attempts can be edited ───────────
  if (attempt.status !== "GRADED" && attempt.status !== "SUBMITTED") {
    return fail(
      `Cannot edit result: attempt status is ${attempt.status}. Only GRADED or SUBMITTED attempts can be edited.`,
      422,
      "INVALID_STATUS",
    );
  }

  // ── Certificate lock: if a cert exists for this trainee+session, reject ─
  const existingCert = await db.certificate.findFirst({
    where: {
      sessionId: attempt.sessionId,
      traineeName: attempt.traineeName,
      traineeIdNational: attempt.traineeIdNational ?? undefined,
      deletedAt: null,
    },
    select: { id: true, refNumber: true, releaseStatus: true },
  });
  if (existingCert) {
    return fail(
      `Cannot edit result: certificate ${existingCert.refNumber} already issued for this trainee. Results are permanently locked once a certificate is issued.`,
      422,
      "CERTIFICATE_LOCKED",
      { certificateRef: existingCert.refNumber },
    );
  }

  // ── Compute new passed status ───────────────────────────────────────────
  const passScore = attempt.passScore ?? attempt.session.course.passScore ?? 70;
  const newPassed = passed !== undefined ? Boolean(passed) : newScore >= passScore;

  // ── Capture old values for audit ────────────────────────────────────────
  const oldScore = attempt.scorePercent;
  const oldPassed = attempt.passed;

  // ── Update the attempt ──────────────────────────────────────────────────
  const updated = await db.examAttempt.update({
    where: { id },
    data: {
      scorePercent: newScore,
      passed: newPassed,
      updatedBy: user.id,
      updatedAt: new Date(),
    },
  });

  // ── Sync the enrollment's finalTestStatus (PASSED/FAILED) ───────────────
  // The exam-engine's submit flow does this via syncFinalTestStatus; we need
  // to replicate it here so the enrollment reflects the edited result.
  if (attempt.testType === "FINAL_TEST") {
    const enrollment = await db.sessionEnrollment.findFirst({
      where: {
        sessionId: attempt.sessionId,
        deletedAt: null,
        // Match by trainee identity (name + national ID) since ExamAttempt
        // doesn't have a direct traineeId FK.
        trainee: {
          fullName: attempt.traineeName,
          ...(attempt.traineeIdNational ? { nationalId: attempt.traineeIdNational } : {}),
        },
      },
    });
    if (enrollment) {
      await db.sessionEnrollment.update({
        where: { id: enrollment.id },
        data: {
          finalTestStatus: newPassed ? "PASSED" : "FAILED",
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
    description: `Edited ${attempt.testType} result for ${attempt.traineeName}: score ${oldScore}% → ${newScore}%, passed ${oldPassed} → ${newPassed}${reason ? ` — ${reason}` : ""}`,
    descriptionAr: `تعديل نتيجة ${attempt.testType === "PRE_TEST" ? "الاختبار القبلي" : "الاختبار النهائي"} للمتدرب ${attempt.traineeName}: النتيجة ${oldScore}% ← ${newScore}%، النجاح ${oldPassed ? "ناجح" : "راسب"} ← ${newPassed ? "ناجح" : "راسب"}${reason ? ` — ${reason}` : ""}`,
    oldValue: {
      scorePercent: oldScore,
      passed: oldPassed,
      status: attempt.status,
    },
    newValue: {
      scorePercent: newScore,
      passed: newPassed,
      status: updated.status,
    },
    reason: reason ?? null,
    req,
    metadata: {
      action: "EDIT_EXAM_RESULT",
      attemptId: attempt.id,
      attemptRef: attempt.refNumber,
      testType: attempt.testType,
      traineeName: attempt.traineeName,
      traineeIdNational: attempt.traineeIdNational,
      sessionId: attempt.sessionId,
      sessionRef: attempt.session.refNumber,
      oldScore,
      newScore,
      oldPassed,
      newPassed,
      passScore,
      reason: reason ?? null,
    },
  });

  return ok({
    attemptId: attempt.id,
    refNumber: attempt.refNumber,
    oldScorePercent: oldScore,
    newScorePercent: newScore,
    oldPassed,
    newPassed,
    reason: reason ?? null,
  });
});
