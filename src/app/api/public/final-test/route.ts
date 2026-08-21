// /api/public/final-test — unauthenticated QR final-test access
import { ok, fail } from "@/lib/auth/api";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";
import { findActiveSet } from "@/lib/api/exam-sets";

/** GET ?token=… — returns session info + whether the trainee has an active attempt. */
export async function GET(req: Request) {
  const rl = checkRateLimit(req, "public:final-test:get", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return fail("Too many requests. Please wait a moment.", 429, "RATE_LIMITED");

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return fail("A final-test link token is required", 400, "VALIDATION_ERROR");

  const session = await db.trainingSession.findFirst({
    where: { finalTestQrToken: token, deletedAt: null },
    include: { course: { select: { id: true, title: true, code: true, hasFinalTest: true } } },
  });
  if (!session || !session.course) return fail("This final-test link is not valid.", 404, "INVALID_QR");
  if (!session.course.hasFinalTest) return fail("This course does not have a final test.", 400, "NO_FINAL_TEST");
  if (session.lifecycleStatus !== "COMPLETED") {
    return fail("The session must be completed before the final test is available.", 400, "SESSION_NOT_COMPLETED");
  }

  // Verify an approved exam set exists
  const approvedSet = await findActiveSet(session.id, "FINAL_TEST");
  if (!approvedSet) {
    return fail("The final test exam has not been prepared yet. Please ask your trainer to generate and approve the exam.", 400, "NO_EXAM_SET");
  }

  return ok({
    sessionTitle: session.title,
    courseTitle: session.course.title,
    courseCode: session.course.code,
    startDate: session.startDate,
    endDate: session.endDate,
    city: session.city,
    venue: session.venue,
    sessionId: session.id,
  });
}

/** POST ?token=… — trainee identifies themselves and starts/gets a final-test attempt. */
export async function POST(req: Request) {
  const rl = checkRateLimit(req, "public:final-test", { limit: 10, windowMs: 60_000 });
  if (!rl.ok) return fail("Too many attempts. Please wait a moment.", 429, "RATE_LIMITED");

  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const traineeName = typeof body.traineeName === "string" ? body.traineeName.trim() : "";
  const traineeIdNational = typeof body.traineeIdNational === "string" ? body.traineeIdNational.trim() : undefined;

  if (!token || !traineeName) return fail("Token and name are required", 422, "VALIDATION_ERROR");

  const session = await db.trainingSession.findFirst({
    where: { finalTestQrToken: token, deletedAt: null },
    include: { course: { select: { id: true, hasFinalTest: true, passScore: true } } },
  });
  if (!session || !session.course) return fail("This final-test link is not valid.", 404, "INVALID_QR");
  if (!session.course.hasFinalTest) return fail("This course does not have a final test.", 400, "NO_FINAL_TEST");
  if (session.lifecycleStatus !== "COMPLETED") {
    return fail("The session must be completed before the final test is available.", 400, "SESSION_NOT_COMPLETED");
  }

  // Verify an approved exam set exists
  const approvedSet = await findActiveSet(session.id, "FINAL_TEST");
  if (!approvedSet) {
    return fail("The final test exam has not been prepared yet. Please ask your trainer.", 400, "NO_EXAM_SET");
  }

  // Verify the trainee is enrolled and has attended
  const enrollment = await db.sessionEnrollment.findFirst({
    where: {
      sessionId: session.id,
      deletedAt: null,
      trainee: {
        fullName: traineeName,
        ...(traineeIdNational ? { nationalId: traineeIdNational } : {}),
      },
    },
    include: { trainee: { select: { id: true, fullName: true, nationalId: true } } },
  });
  if (!enrollment) return fail("You are not enrolled in this session.", 403, "NOT_ENROLLED");

  // Final test requires attendance (PRESENT or LATE)
  if (enrollment.attendanceStatus !== "PRESENT" && enrollment.attendanceStatus !== "LATE") {
    return fail("You must check in to the session before taking the final test.", 400, "NOT_ATTENDED");
  }

  // Check if already PASSED — no retake needed
  if (enrollment.finalTestStatus === "PASSED") {
    return fail("You have already passed the final test.", 400, "ALREADY_PASSED");
  }

  // Check for existing active attempt (ASSIGNED or IN_PROGRESS)
  const existingAttempt = await db.examAttempt.findFirst({
    where: {
      sessionId: session.id,
      testType: "FINAL_TEST",
      deletedAt: null,
      OR: [
        { traineeName },
        ...(traineeIdNational ? [{ traineeIdNational }] : []),
      ],
      status: { in: ["ASSIGNED", "IN_PROGRESS"] },
    },
  });

  if (existingAttempt) {
    return ok({
      attemptId: existingAttempt.id,
      refNumber: existingAttempt.refNumber,
      status: existingAttempt.status,
      passed: existingAttempt.passed ?? false,
      scorePercent: existingAttempt.scorePercent ?? null,
      traineeName,
      traineeIdNational: traineeIdNational ?? null,
    });
  }

  // Check if already completed (GRADED)
  const completedAttempt = await db.examAttempt.findFirst({
    where: {
      sessionId: session.id,
      testType: "FINAL_TEST",
      deletedAt: null,
      OR: [
        { traineeName },
        ...(traineeIdNational ? [{ traineeIdNational }] : []),
      ],
      status: "GRADED",
    },
  });

  if (completedAttempt) {
    return ok({
      attemptId: completedAttempt.id,
      refNumber: completedAttempt.refNumber,
      status: "GRADED",
      scorePercent: completedAttempt.scorePercent,
      passed: completedAttempt.passed,
      traineeName,
      traineeIdNational: traineeIdNational ?? null,
    });
  }

  // Create a new attempt
  const { createExamAttempt } = await import("@/lib/api/exam-engine");
  try {
    const result = await createExamAttempt({
      sessionId: session.id,
      testType: "FINAL_TEST",
      traineeName,
      traineeIdNational,
      companyId: enrollment.companyId,
      createdBy: null,
    });

    return ok({
      attemptId: result.attemptId,
      refNumber: result.refNumber,
      status: "ASSIGNED",
      passed: false,
      scorePercent: null,
      traineeName,
      traineeIdNational: traineeIdNational ?? null,
    });
  } catch (e) {
    return fail((e as Error).message || "Failed to create exam attempt", 500, "EXAM_ERROR");
  }
}
