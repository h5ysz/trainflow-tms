// /api/sessions/[id] — get / update / delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, auditLog } from "@/lib/auth/api";

export const GET = withModuleAction("sessions", "view", async ({ params, user }) => {
  const id = params.id as string;
  const session = await db.trainingSession.findUnique({
    where: { id },
    include: {
      course: true,
      trainer: true,
      request: { include: { company: true } },
      attendance: { orderBy: { createdAt: "asc" } },
      _count: { select: { attendance: true, certificates: true, testResults: true, evaluations: true } },
    },
  });
  if (!session) return notFound("Session not found");

  // Trainers see only their own
  if (user.role === "TRAINER" && user.trainerId && session.trainerId !== user.trainerId) {
    return fail("Forbidden", 403);
  }

  return ok(session);
});

export const PUT = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.trainingSession.findUnique({ where: { id } });
  if (!existing) return notFound("Session not found");

  if (user.role === "TRAINER" && user.trainerId && existing.trainerId !== user.trainerId) {
    return fail("Forbidden", 403);
  }

  const {
    trainerId, title, location, venue, language, startDate, endDate,
    expectedTrainees, actualTrainees, status, notes,
  } = body;

  const updated = await db.trainingSession.update({
    where: { id },
    data: {
      ...(trainerId !== undefined && { trainerId }),
      ...(title !== undefined && { title }),
      ...(location !== undefined && { location }),
      ...(venue !== undefined && { venue }),
      ...(language !== undefined && { language }),
      ...(startDate !== undefined && { startDate: new Date(startDate) }),
      ...(endDate !== undefined && { endDate: new Date(endDate) }),
      ...(expectedTrainees !== undefined && { expectedTrainees }),
      ...(actualTrainees !== undefined && { actualTrainees }),
      ...(status !== undefined && { status }),
      ...(notes !== undefined && { notes }),
    },
  });

  await auditLog({
    userId: user.id,
    action: "UPDATE",
    entity: "SESSION",
    entityId: id,
    description: `Updated session ${existing.sessionCode} (status=${updated.status})`,
    req,
  });

  return ok(updated);
});

export const DELETE = withModuleAction("sessions", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.trainingSession.findUnique({ where: { id } });
  if (!existing) return notFound("Session not found");

  // Don't delete sessions that have certificates
  const certs = await db.certificate.count({ where: { sessionId: id } });
  if (certs > 0) return fail("Cannot delete a session with issued certificates", 400);

  await db.trainingSession.delete({ where: { id } });

  // Unlink request if any
  if (existing.requestId) {
    await db.trainingRequest.update({
      where: { id: existing.requestId },
      data: { status: "APPROVED" },
    });
  }

  await auditLog({
    userId: user.id,
    action: "DELETE",
    entity: "SESSION",
    entityId: id,
    description: `Deleted session ${existing.sessionCode}`,
    req,
  });

  return ok({ success: true });
});
