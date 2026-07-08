// /api/exam-attempts/[id]/start — start an exam (returns the randomized question set for display)
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { resolveExamVersion } from "@/lib/api/exam-engine";

export const POST = withModuleAction("pre-test", "view", async ({ req, params, user }) => {
  const id = params.id as string;
  const attempt = await db.examAttempt.findUnique({ where: { id } });
  if (!attempt || attempt.deletedAt) return notFound("Exam attempt not found");

  // Must be in ASSIGNED or IN_PROGRESS state
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
