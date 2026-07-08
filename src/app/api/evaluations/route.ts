// /api/evaluations — list + create course evaluations
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { syncEvaluationStatus, recalcCertificateEligibility } from "@/lib/api/enrollment-sync";

const ALLOWED_SORT_FIELDS = ["submittedAt", "traineeName", "overallRating", "trainerRating"];

export const GET = withModuleAction("evaluation", "view", async ({ req }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.filters.sessionId) where.sessionId = q.filters.sessionId;
  if (q.filters.trainerId) where.trainerId = q.filters.trainerId;
  if (q.search) {
    where.OR = [
      { traineeName: { contains: q.search } },
      { comments: { contains: q.search } },
    ];
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "submittedAt");

  const [rows, total] = await Promise.all([
    db.courseEvaluation.findMany({
      where,
      include: {
        session: { select: { id: true, refNumber: true, title: true } },
        trainer: { select: { id: true, fullName: true, refNumber: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.courseEvaluation.count({ where }),
  ]);

  return list(
    rows.map((e) => ({
      id: e.id,
      sessionId: e.sessionId,
      sessionRef: e.session?.refNumber ?? null,
      sessionCode: e.session?.refNumber ?? null,
      sessionTitle: e.session?.title ?? null,
      trainerId: e.trainerId,
      trainerName: e.trainer?.fullName ?? null,
      trainerRef: e.trainer?.refNumber ?? null,
      traineeName: e.traineeName,
      traineeEmail: e.traineeEmail,
      trainerRating: e.trainerRating,
      contentRating: e.contentRating,
      venueRating: e.venueRating,
      materialsRating: e.materialsRating,
      overallRating: e.overallRating,
      comments: e.comments,
      wouldRecommend: e.wouldRecommend,
      submittedAt: e.submittedAt,
    })),
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("evaluation", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    sessionId, trainerId, traineeName, traineeEmail, traineeIdNational, attendanceId,
    companyId, trainerRating, contentRating, venueRating, materialsRating,
    overallRating, comments, suggestions, wouldRecommend,
  } = body;

  if (!sessionId || !traineeName) return fail("sessionId and traineeName are required", 422, "VALIDATION_ERROR");
  if ([trainerRating, contentRating, venueRating, materialsRating, overallRating].some((r) => r === undefined || r < 1 || r > 5)) {
    return fail("All ratings must be between 1 and 5", 422, "VALIDATION_ERROR");
  }

  const session = await db.trainingSession.findFirst({ where: { id: sessionId, deletedAt: null } });
  if (!session) return fail("Session not found", 404);

  // Prevent duplicate evaluations from same trainee
  const existing = await db.courseEvaluation.findFirst({
    where: {
      sessionId,
      traineeName: { equals: traineeName },
      deletedAt: null,
      ...(traineeIdNational ? { traineeIdNational } : {}),
    },
  });
  if (existing) {
    return fail("Evaluation already submitted by this trainee", 400, "DUPLICATE_EVALUATION");
  }

  const evaluation = await db.courseEvaluation.create({
    data: {
      sessionId,
      trainerId: trainerId ?? session.trainerId ?? null,
      traineeName,
      traineeEmail: traineeEmail ?? null,
      traineeIdNational: traineeIdNational ?? null,
      companyId: companyId ?? null, // trainee's original company — preserved
      attendanceId: attendanceId ?? null,
      trainerRating,
      contentRating,
      venueRating,
      materialsRating,
      overallRating,
      comments: comments ?? null,
      suggestions: suggestions ?? null,
      wouldRecommend: wouldRecommend ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  // Update attendance progress: mark evaluation as completed
  if (attendanceId) {
    const { updateAttendanceProgress } = await import("@/lib/api/certificate-eligibility");
    await updateAttendanceProgress({
      attendanceId,
      step: "evaluation",
      userId: user.id,
    });
  }

  // ── Sync SessionEnrollment: evaluation COMPLETED ──
  await syncEvaluationStatus({
    sessionId,
    traineeName,
    traineeIdNational: traineeIdNational ?? undefined,
    attendanceId: attendanceId ?? undefined,
    status: "COMPLETED",
    userId: user.id,
  });

  // ── Recalculate certificate eligibility ──
  await recalcCertificateEligibility({
    sessionId,
    traineeName,
    traineeIdNational: traineeIdNational ?? undefined,
    attendanceId: attendanceId ?? undefined,
    userId: user.id,
  });

  return created(evaluation);
});
