// /api/sessions/[id]/enrollments/[enrollmentId] — update / delete enrollment
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

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
  const { status, notes } = body;

  const updated = await db.sessionEnrollment.update({
    where: { id: enrollmentId },
    data: {
      ...(status !== undefined && { status }),
      ...(notes !== undefined && { notes }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: sessionId,
    description: `Updated enrollment ${enrollmentId} status to ${status ?? updated.status}`,
    req,
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

  await db.$transaction(async (tx) => {
    // Soft-delete the enrollment
    await tx.sessionEnrollment.update({
      where: { id: enrollmentId },
      data: { deletedAt: new Date(), status: "CANCELLED", updatedBy: user.id },
    });

    // Decrement the SessionCompany trainee count
    const sc = await tx.sessionCompany.findUnique({
      where: { sessionId_companyId: { sessionId, companyId: existing.companyId } },
    });
    if (sc && sc.traineeCount > 0) {
      await tx.sessionCompany.update({
        where: { sessionId_companyId: { sessionId, companyId: existing.companyId } },
        data: { traineeCount: { decrement: 1 } },
      });
    }

    // Decrement session expectedTrainees
    await tx.trainingSession.update({
      where: { id: sessionId },
      data: { expectedTrainees: { decrement: 1 }, updatedBy: user.id },
    });
  });

  await audit({
    user,
    action: "DELETE",
    entity: "SESSION",
    entityId: sessionId,
    description: `Removed enrollment ${enrollmentId} from session`,
    req,
  });

  return ok({ success: true });
});
