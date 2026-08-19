// /api/public/pre-test — unauthenticated QR pre-test access
import { ok, fail } from "@/lib/auth/api";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";

/** GET ?token=… — returns session info + whether the trainee has an active attempt. */
export async function GET(req: Request) {
  const rl = checkRateLimit(req, "public:pre-test:get", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return fail("Too many requests. Please wait a moment.", 429, "RATE_LIMITED");

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return fail("A pre-test link token is required", 400, "VALIDATION_ERROR");

  const session = await db.trainingSession.findFirst({
    where: { preTestQrToken: token, deletedAt: null },
    include: { course: { select: { id: true, title: true, code: true, hasPreTest: true } } },
  });
  if (!session || !session.course) return fail("This pre-test link is not valid.", 404, "INVALID_QR");
  if (!session.course.hasPreTest) return fail("This course does not have a pre-test.", 400, "NO_PRE_TEST");

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

/** POST ?token=… — trainee identifies themselves and starts/gets a pre-test attempt. */
export async function POST(req: Request) {
  const rl = checkRateLimit(req, "public:pre-test", { limit: 10, windowMs: 60_000 });
  if (!rl.ok) return fail("Too many attempts. Please wait a moment.", 429, "RATE_LIMITED");

  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const traineeName = typeof body.traineeName === "string" ? body.traineeName.trim() : "";
  const traineeIdNational = typeof body.traineeIdNational === "string" ? body.traineeIdNational.trim() : undefined;

  if (!token || !traineeName) return fail("Token and name are required", 422, "VALIDATION_ERROR");

  const session = await db.trainingSession.findFirst({
    where: { preTestQrToken: token, deletedAt: null },
    include: { course: { select: { id: true, hasPreTest: true, passScore: true } } },
  });
  if (!session || !session.course) return fail("This pre-test link is not valid.", 404, "INVALID_QR");
  if (!session.course.hasPreTest) return fail("This course does not have a pre-test.", 400, "NO_PRE_TEST");

  // Verify the trainee is enrolled in this session
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

  // Check for existing active attempt (ASSIGNED or IN_PROGRESS)
  const existingAttempt = await db.examAttempt.findFirst({
    where: {
      sessionId: session.id,
      testType: "PRE_TEST",
      deletedAt: null,
      OR: [
        { traineeName },
        ...(traineeIdNational ? [{ traineeIdNational }] : []),
      ],
      status: { in: ["ASSIGNED", "IN_PROGRESS"] },
    },
  });

  if (existingAttempt) {
    // Return the existing attempt
    return ok({
      attemptId: existingAttempt.id,
      refNumber: existingAttempt.refNumber,
      status: existingAttempt.status,
      traineeName,
      traineeIdNational: traineeIdNational ?? null,
    });
  }

  // Check if already completed
  const completedAttempt = await db.examAttempt.findFirst({
    where: {
      sessionId: session.id,
      testType: "PRE_TEST",
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
      traineeName,
      traineeIdNational: traineeIdNational ?? null,
    });
  }

  // Create a new attempt using the exam engine
  const { createExamAttempt } = await import("@/lib/api/exam-engine");
  try {
    const result = await createExamAttempt({
      sessionId: session.id,
      testType: "PRE_TEST",
      traineeName,
      traineeIdNational,
      companyId: enrollment.companyId,
      createdBy: null,
    });

    return ok({
      attemptId: result.attemptId,
      refNumber: result.refNumber,
      status: "ASSIGNED",
      traineeName,
      traineeIdNational: traineeIdNational ?? null,
    });
  } catch (e) {
    return fail((e as Error).message || "Failed to create exam attempt", 500, "EXAM_ERROR");
  }
}
