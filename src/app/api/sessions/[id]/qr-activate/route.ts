// /api/sessions/[id]/qr-activate — set QR attendance time window
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";

export const POST = withModuleAction("qr-code", "create", async ({ req, params, user }) => {
  const id = params.id as string;
  const session = await db.trainingSession.findUnique({ where: { id } });
  if (!session || session.deletedAt) return notFound("Session not found");
  if (trainerDeniedSession(user, session.trainerId)) {
    return fail("Forbidden — you can only access your own sessions", 403);
  }

  const body = await req.json().catch(() => ({}));
  const { qrActiveFrom, qrActiveTo } = body;

  // Default: use session start/end times if not specified
  const from = qrActiveFrom ? new Date(qrActiveFrom) : session.startDate;
  const to = qrActiveTo ? new Date(qrActiveTo) : session.endDate;

  if (from >= to) {
    return fail("QR activation 'from' time must be before 'to' time", 400, "VALIDATION_ERROR");
  }

  const updated = await db.trainingSession.update({
    where: { id },
    data: {
      qrActiveFrom: from,
      qrActiveTo: to,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "QR_REGENERATE",
    entity: "SESSION",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Set QR attendance window for ${updated.refNumber}: ${from.toISOString()} → ${to.toISOString()}`,
    descriptionAr: `تحديد نافذة حضور QR لـ ${updated.refNumber}: ${from.toISOString()} → ${to.toISOString()}`,
    req,
    metadata: { qrActiveFrom: from, qrActiveTo: to },
  });

  return ok({
    sessionId: id,
    sessionRef: updated.refNumber,
    qrActiveFrom: from,
    qrActiveTo: to,
    qrCodeToken: updated.qrCodeToken,
  });
});
