// /api/sessions/[id]/qr — regenerate QR token for the session
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, auditLog } from "@/lib/auth/api";
import { randomBytes } from "crypto";

export const POST = withModuleAction("qr-code", "create", async ({ params, user, req }) => {
  const id = params.id as string;
  const session = await db.trainingSession.findUnique({ where: { id } });
  if (!session) return notFound("Session not found");

  const newToken = randomBytes(16).toString("hex");
  const updated = await db.trainingSession.update({
    where: { id },
    data: { qrCodeToken: newToken },
  });

  await auditLog({
    userId: user.id,
    action: "UPDATE",
    entity: "SESSION",
    entityId: id,
    description: `Regenerated QR token for session ${session.sessionCode}`,
    req,
  });

  return ok({
    sessionId: updated.id,
    sessionCode: updated.sessionCode,
    qrCodeToken: updated.qrCodeToken,
    checkInUrl: `/check-in?token=${updated.qrCodeToken}`,
  });
});
