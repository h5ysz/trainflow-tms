// /api/exam-attempts/[id]/start — start an exam (returns the randomized question set for display)
import { db } from "@/lib/db";
import { withExamAction, ok, notFound, fail, audit, type TestType } from "@/lib/auth/api";
import { resolveExamVersion, traineeIdentityWhere } from "@/lib/api/exam-engine";
import { syncPreTestStatus, syncFinalTestStatus } from "@/lib/api/enrollment-sync";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";

export const POST = withExamAction("create", async ({ req, params, user, allowedTestTypes }) => {
  const id = params.id as string;
  const attempt = await db.examAttempt.findUnique({ where: { id } });
  if (!attempt || attempt.deletedAt) return notFound("Exam attempt not found");

  // A trainer may only run exams for their own sessions.
  if (user.role === "TRAINER") {
    const session = await db.trainingSession.findUnique({
      where: { id: attempt.sessionId },
      select: { trainerId: true },
    });
    if (trainerDeniedSession(user, session?.trainerId)) {
      return fail("Forbidden — you can only run exams for your own sessions", 403);
    }
  }

  // The guard admits anyone holding `create` on pre-test OR final-test; this narrows
  // it to the module the attempt actually belongs to.
  if (!allowedTestTypes.includes(attempt.testType as TestType)) {
    return fail(`Forbidden — cannot start a ${attempt.testType === "FINAL_TEST" ? "final" : "pre"} test`, 403);
  }

  // A submitted or graded attempt cannot be reopened. Report it as an exhausted
  // attempt budget rather than a bare status error, since that is what it means to
  // the trainee. (This used to be a separate block that counted sibling attempts,
  // but the count always included the current one and `maxAttempts` is fixed at 1,
  // so it could never allow a retake — the status check below rejected it anyway.)
  if (attempt.status === "GRADED" || attempt.status === "SUBMITTED") {
    const usedAttempts = await db.examAttempt.count({
      where: {
        sessionId: attempt.sessionId,
        testType: attempt.testType,
        ...traineeIdentityWhere({
          traineeName: attempt.traineeName,
          traineeIdNational: attempt.traineeIdNational,
        }),
        status: { in: ["GRADED", "SUBMITTED", "IN_PROGRESS"] },
        deletedAt: null,
      },
    });
    return fail(
      `Maximum attempts (${attempt.maxAttempts}) reached for this exam`,
      400,
      "MAX_ATTEMPTS_REACHED",
      { attemptNumber: usedAttempts, maxAttempts: attempt.maxAttempts }
    );
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
      imageUrl: q.imageUrl,
      type: q.type,
      points: q.points,
      options: q.options, // shuffled — trainee sees reordered options
    })),
  });
});
