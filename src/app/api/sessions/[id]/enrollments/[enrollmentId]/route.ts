// /api/sessions/[id]/enrollments/[enrollmentId] — update / delete enrollment
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";

async function assertOwnedSession(user: any, sessionId: string) {
  const session = await db.trainingSession.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: { id: true, trainerId: true },
  });
  if (!session) return "SESSION_NOT_FOUND";
  if (trainerDeniedSession(user, session.trainerId)) return "FORBIDDEN";
  return null;
}

export const PUT = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const sessionId = params.id as string;
  const enrollmentId = params.enrollmentId as string;

  const ownerCheck = await assertOwnedSession(user, sessionId);
  if (ownerCheck === "SESSION_NOT_FOUND") return notFound("Session not found");
  if (ownerCheck === "FORBIDDEN") return fail("Forbidden — you can only access your own sessions", 403);

  const existing = await db.sessionEnrollment.findUnique({
    where: { id: enrollmentId },
  });
  if (!existing || existing.deletedAt || existing.sessionId !== sessionId) {
    return notFound("Enrollment not found");
  }

  const body = await req.json().catch(() => ({}));
  const { enrollmentStatus, notes } = body;

  const updated = await db.sessionEnrollment.update({
    where: { id: enrollmentId },
    data: {
      ...(enrollmentStatus !== undefined && { enrollmentStatus }),
      ...(notes !== undefined && { notes }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: sessionId,
    description: `Updated enrollment ${enrollmentId} status to ${updated.enrollmentStatus}`,
    req,
  });

  return ok(updated);
});

export const DELETE = withModuleAction("sessions", "edit", async ({ params, user, req }) => {
  const sessionId = params.id as string;
  const enrollmentId = params.enrollmentId as string;

  const ownerCheck = await assertOwnedSession(user, sessionId);
  if (ownerCheck === "SESSION_NOT_FOUND") return notFound("Session not found");
  if (ownerCheck === "FORBIDDEN") return fail("Forbidden — you can only access your own sessions", 403);

  const existing = await db.sessionEnrollment.findUnique({
    where: { id: enrollmentId },
  });
  if (!existing || existing.deletedAt || existing.sessionId !== sessionId) {
    return notFound("Enrollment not found");
  }

  // BUG-012: Reject removal when a certificate has already been issued for
  // this enrollment. Once a certificate exists, the trainee's result is
  // locked — removing them would orphan the certificate and corrupt audit
  // history. The UI already disables the Remove button in this state; the
  // API must enforce the same rule so a direct API call can't bypass it.
  if (existing.certificateStatus === "ISSUED") {
    return fail(
      "Cannot remove trainee: certificate already issued. Results are locked once certificates are issued.",
      422,
      "CERTIFICATE_LOCKED",
    );
  }

  await db.$transaction(async (tx) => {
    // Soft-delete the enrollment
    await tx.sessionEnrollment.update({
      where: { id: enrollmentId },
      data: { deletedAt: new Date(), enrollmentStatus: "CANCELLED", updatedBy: user.id },
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
