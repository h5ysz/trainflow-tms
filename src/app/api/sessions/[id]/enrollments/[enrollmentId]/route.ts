// /api/sessions/[id]/enrollments/[enrollmentId] — update / delete enrollment
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, audit } from "@/lib/auth/api";
import { recomputeSessionCounts } from "@/lib/sessions/session-management";

export const PUT = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const sessionId = params.id as string;
  const enrollmentId = params.enrollmentId as string;

  const existing = await db.sessionEnrollment.findUnique({
    where: { id: enrollmentId },
  });
  if (!existing || existing.deletedAt || existing.sessionId !== sessionId) {
    return notFound("Enrollment not found");
  }

  const body = await req.json().catch(() => ({}));
  const { enrollmentStatus, notes } = body;

  // Track whether the status transition affects the active enrollment count.
  // recomputeSessionCounts filters by `enrollmentStatus != "CANCELLED"`, so
  // any transition to/from CANCELLED changes the active count and requires
  // a SessionCompany recompute. Without this, the per-company breakdown and
  // `expectedTrainees` would drift out of sync.
  const statusAffectsActiveCount =
    enrollmentStatus !== undefined &&
    (enrollmentStatus === "CANCELLED" || existing.enrollmentStatus === "CANCELLED") &&
    enrollmentStatus !== existing.enrollmentStatus;

  const updated = await db.sessionEnrollment.update({
    where: { id: enrollmentId },
    data: {
      ...(enrollmentStatus !== undefined && { enrollmentStatus }),
      ...(notes !== undefined && { notes }),
      updatedBy: user.id,
    },
  });

  // Recompute SessionCompany + expectedTrainees if the active count changed.
  // This is the source of truth — the manual increment/decrement pattern used
  // by POST/DELETE is fragile and easy to desync; recompute is idempotent.
  if (statusAffectsActiveCount) {
    await recomputeSessionCounts(sessionId);
  }

  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: sessionId,
    description: `Updated enrollment ${enrollmentId} status to ${updated.enrollmentStatus}`,
    req,
    oldValue: { enrollmentStatus: existing.enrollmentStatus },
    newValue: { enrollmentStatus: updated.enrollmentStatus },
  });

  return ok(updated);
});

export const DELETE = withModuleAction("sessions", "edit", async ({ params, user, req }) => {
  const sessionId = params.id as string;
  const enrollmentId = params.enrollmentId as string;

  const existing = await db.sessionEnrollment.findUnique({
    where: { id: enrollmentId },
  });
  if (!existing || existing.deletedAt || existing.sessionId !== sessionId) {
    return notFound("Enrollment not found");
  }

  // Soft-delete the enrollment, then recompute SessionCompany + expectedTrainees
  // from the remaining active enrollments. This is more robust than the manual
  // decrement pattern (which can leave SessionCompany rows at 0 and doesn't
  // handle the case where the deleted enrollment was the last of its company).
  await db.$transaction(async (tx) => {
    await tx.sessionEnrollment.update({
      where: { id: enrollmentId },
      data: { deletedAt: new Date(), enrollmentStatus: "CANCELLED", updatedBy: user.id },
    });
    await recomputeSessionCounts(sessionId, tx);
  });

  await audit({
    user,
    action: "DELETE",
    entity: "SESSION",
    entityId: sessionId,
    description: `Removed enrollment ${enrollmentId} from session`,
    req,
    oldValue: { enrollmentId, traineeId: existing.traineeId, companyId: existing.companyId },
  });

  return ok({ success: true });
});
