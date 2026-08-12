// /api/sessions/[id]/recompute-counts — drift-recovery utility
//
// Recomputes `TrainingSession.expectedTrainees` and the entire
// `SessionCompany` cache from the current active enrollments. Idempotent.
//
// Per the approved design, SessionCompany is a cached table. Every
// enrollment-changing endpoint calls `recomputeSessionCounts` automatically,
// but this endpoint exists as a manual safety net for fixing drift caused
// by bugs, manual DB edits, or partial-failure recovery.
//
// Returns the recomputed values so the caller can verify the fix.
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail } from "@/lib/auth/api";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";
import { recomputeSessionCounts } from "@/lib/sessions/session-management";

export const POST = withModuleAction("sessions", "edit", async ({ params, user }) => {
  const id = params.id as string;
  const session = await db.trainingSession.findUnique({ where: { id } });
  if (!session || session.deletedAt) return notFound("Session not found");
  if (trainerDeniedSession(user, session.trainerId)) {
    return fail("Forbidden — you can only access your own sessions", 403);
  }

  await recomputeSessionCounts(id);

  // Re-read to return the recomputed values.
  const refreshed = await db.trainingSession.findUnique({
    where: { id },
    select: { id: true, refNumber: true, expectedTrainees: true, capacity: true },
  });
  const companies = await db.sessionCompany.findMany({
    where: { sessionId: id },
    include: { company: { select: { id: true, name: true, refNumber: true } } },
  });

  return ok({
    session: refreshed,
    companies: companies.map((sc) => ({
      companyId: sc.companyId,
      companyName: sc.company?.name ?? null,
      companyRef: sc.company?.refNumber ?? null,
      traineeCount: sc.traineeCount,
    })),
    recomputedAt: new Date().toISOString(),
  });
});
