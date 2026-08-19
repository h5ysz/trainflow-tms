// /api/public/evaluation — unauthenticated QR evaluation access
import { ok, fail, created } from "@/lib/auth/api";
import { checkRateLimit } from "@/lib/api/rate-limit";
import { db } from "@/lib/db";
import { syncEvaluationStatus, recalcCertificateEligibility } from "@/lib/api/enrollment-sync";

/** GET ?token=… — returns session info for the evaluation form. */
export async function GET(req: Request) {
  const rl = checkRateLimit(req, "public:evaluation:get", { limit: 30, windowMs: 60_000 });
  if (!rl.ok) return fail("Too many requests. Please wait a moment.", 429, "RATE_LIMITED");

  const token = new URL(req.url).searchParams.get("token");
  if (!token) return fail("An evaluation link token is required", 400, "VALIDATION_ERROR");

  const session = await db.trainingSession.findFirst({
    where: { evaluationQrToken: token, deletedAt: null },
    include: {
      course: { select: { title: true, code: true } },
      trainer: { select: { nameEn: true, nameAr: true } },
    },
  });
  if (!session) return fail("This evaluation link is not valid.", 404, "INVALID_QR");

  return ok({
    sessionTitle: session.title,
    courseTitle: session.course?.title ?? null,
    courseCode: session.course?.code ?? null,
    trainerName: session.trainer?.nameEn ?? null,
    sessionId: session.id,
  });
}

/** POST ?token=… — submit evaluation. */
export async function POST(req: Request) {
  const rl = checkRateLimit(req, "public:evaluation", { limit: 10, windowMs: 60_000 });
  if (!rl.ok) return fail("Too many attempts. Please wait a moment.", 429, "RATE_LIMITED");

  const body = await req.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const traineeName = typeof body.traineeName === "string" ? body.traineeName.trim() : "";
  const traineeIdNational = typeof body.traineeIdNational === "string" ? body.traineeIdNational.trim() : undefined;

  if (!token || !traineeName) return fail("Token and name are required", 422, "VALIDATION_ERROR");

  const {
    trainerRating, contentRating, venueRating, materialsRating,
    overallRating, comments, suggestions, wouldRecommend,
  } = body;

  if ([trainerRating, contentRating, venueRating, materialsRating, overallRating].some((r: unknown) => r === undefined || typeof r !== "number" || r < 1 || r > 5)) {
    return fail("All ratings must be between 1 and 5", 422, "VALIDATION_ERROR");
  }

  const session = await db.trainingSession.findFirst({
    where: { evaluationQrToken: token, deletedAt: null },
    include: { course: { select: { title: true } } },
  });
  if (!session) return fail("This evaluation link is not valid.", 404, "INVALID_QR");

  // Verify enrollment
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

  // Prevent duplicate
  const existing = await db.courseEvaluation.findFirst({
    where: {
      sessionId: session.id,
      traineeName,
      deletedAt: null,
      ...(traineeIdNational ? { traineeIdNational } : {}),
    },
  });
  if (existing) return fail("Evaluation already submitted by this trainee", 400, "DUPLICATE_EVALUATION");

  const evaluation = await db.courseEvaluation.create({
    data: {
      sessionId: session.id,
      trainerId: session.trainerId ?? null,
      traineeName,
      traineeEmail: typeof body.traineeEmail === "string" ? body.traineeEmail : null,
      traineeIdNational: traineeIdNational ?? null,
      companyId: enrollment.companyId,
      attendanceId: enrollment.attendanceId ?? null,
      trainerRating,
      contentRating,
      venueRating,
      materialsRating,
      overallRating,
      comments: typeof comments === "string" ? comments : null,
      suggestions: typeof suggestions === "string" ? suggestions : null,
      wouldRecommend: typeof wouldRecommend === "boolean" ? wouldRecommend : null,
      createdBy: null,
      updatedBy: null,
    },
  });

  // Sync enrollment status
  await syncEvaluationStatus({
    sessionId: session.id,
    traineeName,
    traineeIdNational,
    attendanceId: enrollment.attendanceId ?? undefined,
    status: "COMPLETED",
    userId: null,
  });

  // Recalc certificate eligibility
  await recalcCertificateEligibility({
    sessionId: session.id,
    traineeName,
    traineeIdNational,
    attendanceId: enrollment.attendanceId ?? undefined,
    userId: null,
  });

  return created({ id: evaluation.id, submittedAt: evaluation.submittedAt });
}
