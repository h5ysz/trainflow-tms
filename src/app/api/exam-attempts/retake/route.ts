// /api/exam-attempts/retake — create a new exam attempt for a trainee who failed
// =====================================================================
// Sprint 6: configurable retake policy.
//
// Allows a trainee to take the final test again if:
//   1. Their previous attempt is GRADED with passed=false
//   2. They haven't exceeded the course's retakeAttempts limit
//
// Pre-tests don't have a pass/fail gate (mandatory but not pass-required),
// so retakes aren't applicable there.
//
// Body:
//   sessionId       — required
//   attendanceId    — optional (preferred lookup key)
//   testType        — "FINAL_TEST" (pre-test retakes are not supported)
//   traineeName     — required
//   traineeEmail    — optional
//   traineeIdNational — optional (preferred for identity matching)
//
// Returns: { attemptId, refNumber, questionSet, passScore, attemptNumber, maxAttempts }
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withErrorEnvelope, requireAuth, ok, fail, audit } from "@/lib/auth/api";
import { createExamAttempt, traineeIdentityWhere } from "@/lib/api/exam-engine";
import { syncFinalTestStatus } from "@/lib/api/enrollment-sync";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";

export const POST = withErrorEnvelope(async function POST(req: NextRequest) {
  const user = await requireAuth();

  const body = await req.json().catch(() => ({}));
  const {
    sessionId,
    attendanceId,
    testType,
    traineeName,
    traineeEmail,
    traineeIdNational,
  } = body as {
    sessionId?: string;
    attendanceId?: string;
    testType?: string;
    traineeName?: string;
    traineeEmail?: string;
    traineeIdNational?: string;
  };

  // ── Validate ──────────────────────────────────────────────────────
  if (!sessionId || !traineeName) {
    return fail("sessionId and traineeName are required", 422, "VALIDATION_ERROR");
  }
  if (testType !== "FINAL_TEST") {
    return fail(
      "Retakes are only supported for FINAL_TEST. Pre-test is mandatory but not pass-gated.",
      400,
      "RETAKE_NOT_APPLICABLE"
    );
  }

  // ── Fetch session + course ────────────────────────────────────────
  const session = await db.trainingSession.findUnique({
    where: { id: sessionId },
    include: { course: true },
  });
  if (!session || session.deletedAt) return fail("Session not found", 404, "NOT_FOUND");
  if (!session.course) return fail("Course not found", 404, "NOT_FOUND");

  // A trainer may only create retakes for their own sessions.
  if (trainerDeniedSession(user, session.trainerId)) {
    return fail("Forbidden — you can only access your own sessions", 403);
  }

  const course = session.course;
  const maxAttempts = Math.max(1, course.retakeAttempts ?? 1);

  // ── Count existing attempts for this trainee + session + testType ─
  const existingAttempts = await db.examAttempt.count({
    where: {
      sessionId,
      testType: "FINAL_TEST",
      ...traineeIdentityWhere({ traineeName, traineeIdNational }),
      deletedAt: null,
    },
  });

  if (existingAttempts >= maxAttempts) {
    return fail(
      `Maximum attempts (${maxAttempts}) reached. Course "${course.code}" allows ${maxAttempts} attempt(s) per trainee.`,
      400,
      "MAX_ATTEMPTS_REACHED",
      { attemptNumber: existingAttempts, maxAttempts, courseCode: course.code }
    );
  }

  // ── Verify the latest attempt was GRADED + failed (retakes only after a fail) ──
  const latestAttempt = await db.examAttempt.findFirst({
    where: {
      sessionId,
      testType: "FINAL_TEST",
      ...traineeIdentityWhere({ traineeName, traineeIdNational }),
      deletedAt: null,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, status: true, passed: true, scorePercent: true, attemptNumber: true },
  });

  if (!latestAttempt) {
    return fail(
      "No previous final test attempt found. Use the regular exam-attempts endpoint to start the first attempt.",
      400,
      "NO_PRIOR_ATTEMPT"
    );
  }

  if (latestAttempt.status !== "GRADED") {
    return fail(
      `Previous attempt is not yet graded (status: ${latestAttempt.status}). Wait for grading before requesting a retake.`,
      400,
      "PRIOR_ATTEMPT_NOT_GRADED",
      { status: latestAttempt.status }
    );
  }

  if (latestAttempt.passed === true) {
    return fail(
      "Previous attempt was PASSED — no retake needed. Certificate eligibility is now unlocked.",
      400,
      "ALREADY_PASSED",
      { scorePercent: latestAttempt.scorePercent }
    );
  }

  // ── Create the new attempt ────────────────────────────────────────
  const created = await createExamAttempt({
    sessionId,
    attendanceId,
    testType: "FINAL_TEST",
    traineeName,
    traineeEmail,
    traineeIdNational,
    companyId: undefined,
    createdBy: user.id,
  });

  // ── Sync enrollment: final test back to IN_PROGRESS ───────────────
  await syncFinalTestStatus({
    sessionId,
    traineeName,
    traineeIdNational,
    attendanceId,
    status: "IN_PROGRESS",
    userId: user.id,
  });

  await audit({
    user,
    action: "CREATE",
    entity: "EXAM",
    entityId: created.attemptId,
    entityRef: created.refNumber,
    description: `Retake attempt #${created.questionSet.length > 0 ? existingAttempts + 1 : 1} created for ${traineeName} (previous score: ${latestAttempt.scorePercent}%)`,
    descriptionAr: `إنشاء محاولة إعادة #${existingAttempts + 1} لـ ${traineeName} (النتيجة السابقة: ${latestAttempt.scorePercent}%)`,
    req,
    metadata: {
      sessionId,
      testType: "FINAL_TEST",
      traineeName,
      attemptNumber: existingAttempts + 1,
      maxAttempts,
      previousScore: latestAttempt.scorePercent,
      courseCode: course.code,
    },
  });

  return ok({
    attemptId: created.attemptId,
    refNumber: created.refNumber,
    testType: "FINAL_TEST",
    attemptNumber: existingAttempts + 1,
    maxAttempts,
    passScore: created.passScore,
    remainingAttempts: maxAttempts - (existingAttempts + 1),
    message: `Retake attempt created. This is attempt ${existingAttempts + 1} of ${maxAttempts} allowed.`,
  });
});
