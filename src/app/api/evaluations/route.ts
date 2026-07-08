// /api/evaluations — list + create course evaluations
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, auditLog } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";

export const GET = withModuleAction("evaluation", "view", async ({ req }) => {
  const params = parseListParams(req);
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const trainerId = url.searchParams.get("trainerId");

  const where: Record<string, unknown> = {};
  if (sessionId) where.sessionId = sessionId;
  if (trainerId) where.trainerId = trainerId;

  if (params.search) {
    where.OR = [
      { traineeName: { contains: params.search } },
      { comments: { contains: params.search } },
    ];
  }

  const [rows, total] = await Promise.all([
    db.courseEvaluation.findMany({
      where,
      include: {
        session: { select: { id: true, sessionCode: true, title: true } },
        trainer: { select: { id: true, fullName: true } },
      },
      orderBy: { submittedAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.courseEvaluation.count({ where }),
  ]);

  return ok(
    listResponse(
      rows.map((e) => ({
        id: e.id,
        sessionId: e.sessionId,
        sessionCode: e.session?.sessionCode ?? null,
        sessionTitle: e.session?.title ?? null,
        trainerId: e.trainerId,
        trainerName: e.trainer?.fullName ?? null,
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
      total,
      params
    )
  );
});

export const POST = withModuleAction("evaluation", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    sessionId, trainerId, traineeName, traineeEmail,
    trainerRating, contentRating, venueRating, materialsRating,
    overallRating, comments, wouldRecommend,
  } = body;

  if (!sessionId || !traineeName) return fail("sessionId and traineeName are required", 400);
  if ([trainerRating, contentRating, venueRating, materialsRating, overallRating].some((r) => r === undefined || r < 1 || r > 5)) {
    return fail("All ratings must be between 1 and 5", 400);
  }

  const session = await db.trainingSession.findUnique({ where: { id: sessionId } });
  if (!session) return fail("Session not found", 404);

  const evaluation = await db.courseEvaluation.create({
    data: {
      sessionId,
      trainerId: trainerId ?? session.trainerId ?? null,
      traineeName,
      traineeEmail: traineeEmail ?? null,
      trainerRating,
      contentRating,
      venueRating,
      materialsRating,
      overallRating,
      comments: comments ?? null,
      wouldRecommend: wouldRecommend ?? null,
    },
  });

  return created(evaluation);
});
