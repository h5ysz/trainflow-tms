// /api/sessions/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { recordStatusChange } from "@/lib/auth/audit";

export const GET = withModuleAction("sessions", "view", async ({ params, user }) => {
  const id = params.id as string;
  const session = await db.trainingSession.findUnique({
    where: { id },
    include: {
      course: true,
      trainer: true,
      request: { include: { company: true } },
      attendance: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
      _count: { select: { attendance: true, certificates: true, testResults: true, evaluations: true } },
    },
  });
  if (!session || session.deletedAt) return notFound("Session not found");

  if (user.role === "TRAINER" && user.trainerId && session.trainerId !== user.trainerId) {
    return fail("Forbidden", 403);
  }

  return ok(session);
});

export const PUT = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.trainingSession.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Session not found");

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
      updatedBy: user.id,
    },
  });

  if (status && status !== existing.status) {
    await recordStatusChange({
      user,
      entity: "SESSION",
      entityId: id,
      entityRef: existing.refNumber,
      fromStatus: existing.status,
      toStatus: status,
      req,
    });
  } else {
    await audit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: id,
      entityRef: existing.refNumber,
      description: `Updated session ${existing.refNumber}`,
      descriptionAr: `تم تحديث جلسة ${existing.refNumber}`,
      req,
      metadata: { before: existing, after: updated },
    });
  }

  return ok(updated);
});

export const DELETE = withModuleAction("sessions", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.trainingSession.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Session not found");

  const certs = await db.certificate.count({ where: { sessionId: id, deletedAt: null } });
  if (certs > 0) return fail("Cannot delete a session with issued certificates", 400);

  await db.trainingSession.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  // Unlink request if any
  if (existing.requestId) {
    await db.trainingRequest.update({
      where: { id: existing.requestId },
      data: { status: "APPROVED", updatedBy: user.id },
    });
  }

  await audit({
    user,
    action: "DELETE",
    entity: "SESSION",
    entityId: id,
    entityRef: existing.refNumber,
    description: `Deleted session ${existing.refNumber}`,
    descriptionAr: `تم حذف جلسة ${existing.refNumber}`,
    req,
  });

  return ok({ success: true });
});
