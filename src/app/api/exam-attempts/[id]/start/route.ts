// /api/exam-attempts/[id]/start — start an exam (returns the randomized question set for display)
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { canPerformAction } from "@/lib/auth/permissions";
import { resolveExamVersion } from "@/lib/api/exam-engine";
import { syncPreTestStatus, syncFinalTestStatus } from "@/lib/api/enrollment-sync";

export const POST = withModuleAction("pre-test", "create", async ({ req, params, user }) => {
  const id = params.id as string;
  const attempt = await db.examAttempt.findUnique({ where: { id } });
  if (!attempt || attempt.deletedAt) return notFound("Exam attempt not found");

  // Final-test attempts require the "final-test" module, not "pre-test".
  if (attempt.testType === "FINAL_TEST" && !canPerformAction(user.role, "final-test", "create")) {
    return fail("Forbidden — cannot start a final test", 403);
  }

  // BUG FIX: Enforce maxAttempts — prevent starting if attempt is already GRADED/SUBMITTED
  // and the trainee has exhausted their max attempts
  if (attempt.status === "GRADED" || attempt.status === "SUBMITTED") {
    // Check if this trainee has remaining attempts
    const totalAttempts = await db.examAttempt.count({
      where: {
        sessionId: attempt.sessionId,
        testType: attempt.testType,
        traineeName: attempt.traineeName,
        status: { in: ["GRADED", "SUBMITTED", "IN_PROGRESS"] },
        deletedAt: null,
      },
    });
    if (totalAttempts >= attempt.maxAttempts) {
      return fail(
        `Maximum attempts (${attempt.maxAttempts}) reached for this exam`,
        400,
        "MAX_ATTEMPTS_REACHED",
        { attemptNumber: totalAttempts, maxAttempts: attempt.maxAttempts }
      );
    }
  }

  // Must be in ASSIGNED or IN_PROGRESS state to start
  if (!["ASSIGNED", "IN_PROGRESS"].includes(attempt.status)) {
    return fail(
      `Cannot start exam: current status is ${attempt.status}`,
      400,
      "INVALID_STATUS"
    );
  }

  // For FINAL_TEST: session must be COMPLETED
  if (attempt.testType === "FINAL_TEST") {
    const session = await db.trainingSession.findUnique({
      where: { id: attempt.sessionId },
    });
    if (!session || session.lifecycleStatus !== "COMPLETED") {
      return fail(
        "Final test is only available after the session is completed",
        400,
        "SESSION_NOT_COMPLETED",
        { lifecycleStatus: session?.lifecycleStatus ?? "UNKNOWN" }
      );
    }
  }

  // Check attempt count
  if (attempt.status === "ASSIGNED") {
    const now = new Date();
    await db.examAttempt.update({
      where: { id },
      data: {
        status: "IN_PROGRESS",
        startedAt: now,
        updatedBy: user.id,
      },
    });

    await audit({
      user,
      action: "UPDATE",
      entity: "EXAM",
      entityId: id,
      entityRef: attempt.refNumber,
      description: `Started ${attempt.testType} exam ${attempt.refNumber}`,
      descriptionAr: `بدء اختبار ${attempt.testType === "PRE_TEST" ? "قبلي" : "نهائي"} ${attempt.refNumber}`,
      req,
      metadata: { testType: attempt.testType, startedAt: now },
    });

    // ── Sync SessionEnrollment: exam IN_PROGRESS ──
    if (attempt.testType === "PRE_TEST") {
      await syncPreTestStatus({
        sessionId: attempt.sessionId,
        traineeName: attempt.traineeName,
        traineeIdNational: attempt.traineeIdNational ?? undefined,
        attendanceId: attempt.attendanceId ?? undefined,
        status: "IN_PROGRESS",
        userId: user.id,
      });
    } else {
      await syncFinalTestStatus({
        sessionId: attempt.sessionId,
        traineeName: attempt.traineeName,
        traineeIdNational: attempt.traineeIdNational ?? undefined,
        attendanceId: attempt.attendanceId ?? undefined,
        status: "IN_PROGRESS",
        userId: user.id,
      });
    }
  }

  // Resolve the exam version (randomized questions + shuffled options)
  const version = await resolveExamVersion(id);
  if (!version) return fail("Failed to resolve exam version", 500);

  return ok({
    attemptId: id,
    refNumber: attempt.refNumber,
    testType: attempt.testType,
    status: "IN_PROGRESS",
    passScore: version.passScore,
    questions: version.questions.map((q) => ({
      id: q.id,
      order: q.order,
      text: q.text,
      textAr: q.textAr,
      type: q.type,
      points: q.points,
      options: q.options, // shuffled — trainee sees reordered options
    })),
  });
});
