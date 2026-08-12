// /api/sessions/[id]/qr — regenerate QR token for the session
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";
import { randomBytes } from "crypto";
import { buildCheckInUrl, resolveOrigin } from "@/lib/qr/urls";

export const POST = withModuleAction("qr-code", "create", async ({ params, user, req }) => {
  const id = params.id as string;
  const session = await db.trainingSession.findUnique({ where: { id } });
  if (!session || session.deletedAt) return notFound("Session not found");
  if (trainerDeniedSession(user, session.trainerId)) {
    return fail("Forbidden — you can only access your own sessions", 403);
  }

  const newToken = randomBytes(16).toString("hex");
  const updated = await db.trainingSession.update({
    where: { id },
    data: { qrCodeToken: newToken, qrCodeGeneratedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "QR_REGENERATE",
    entity: "SESSION",
    entityId: id,
    entityRef: updated.refNumber,
    description: `Regenerated QR token for session ${updated.refNumber}`,
    descriptionAr: `تم إعادة توليد رمز QR لجلسة ${updated.refNumber}`,
    req,
  });

  return ok({
    sessionId: updated.id,
    sessionRef: updated.refNumber,
    sessionCode: updated.refNumber,
    qrCodeToken: updated.qrCodeToken,
    // Absolute, so the value is usable in a QR code or a printed sheet.
    checkInUrl: buildCheckInUrl(resolveOrigin(req), updated.qrCodeToken!),
  });
});
