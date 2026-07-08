// /api/sessions/[id]/qr — regenerate QR token for the session
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, audit } from "@/lib/auth/api";
import { randomBytes } from "crypto";

export const POST = withModuleAction("qr-code", "create", async ({ params, user, req }) => {
  const id = params.id as string;
  const session = await db.trainingSession.findUnique({ where: { id } });
  if (!session || session.deletedAt) return notFound("Session not found");

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
    checkInUrl: `/check-in?token=${updated.qrCodeToken}`,
  });
});
