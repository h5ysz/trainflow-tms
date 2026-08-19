// /api/sessions/[id]/qr — regenerate QR token for the session
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { trainerDeniedSession } from "@/lib/api/trainer-scope";
import { randomBytes } from "crypto";
import { buildCheckInUrl, buildPreTestUrl, buildFinalTestUrl, buildEvaluationUrl, resolveOrigin } from "@/lib/qr/urls";

export const POST = withModuleAction("qr-code", "create", async ({ params, user, req }) => {
  const id = params.id as string;
  const session = await db.trainingSession.findUnique({ where: { id } });
  if (!session || session.deletedAt) return notFound("Session not found");
  if (trainerDeniedSession(user, session.trainerId)) {
    return fail("Forbidden — you can only access your own sessions", 403);
  }

  const body = await req.json().catch(() => ({}));
  const tokenType = typeof body.tokenType === "string" ? body.tokenType : "checkIn";

  // Generate the appropriate token based on request type
  let updateData: Record<string, unknown> = { updatedBy: user.id };
  let description: string;
  let descriptionAr: string;
  let qrUrl: string | null = null;
  const origin = resolveOrigin(req);

  if (tokenType === "preTest") {
    const token = randomBytes(16).toString("hex");
    updateData.preTestQrToken = token;
    description = `Generated pre-test QR token for session ${session.refNumber}`;
    descriptionAr = `تم إنشاء رمز QR للاختبار القبلي للجلسة ${session.refNumber}`;
    qrUrl = buildPreTestUrl(origin, token);
  } else if (tokenType === "finalTest") {
    const token = randomBytes(16).toString("hex");
    updateData.finalTestQrToken = token;
    description = `Generated final-test QR token for session ${session.refNumber}`;
    descriptionAr = `تم إنشاء رمز QR للاختبار الختامي للجلسة ${session.refNumber}`;
    qrUrl = buildFinalTestUrl(origin, token);
  } else if (tokenType === "evaluation") {
    const token = randomBytes(16).toString("hex");
    updateData.evaluationQrToken = token;
    description = `Generated evaluation QR token for session ${session.refNumber}`;
    descriptionAr = `تم إنشاء رمز QR للتقييم للجلسة ${session.refNumber}`;
    qrUrl = buildEvaluationUrl(origin, token);
  } else {
    // Default: check-in token
    const newToken = randomBytes(16).toString("hex");
    updateData.qrCodeToken = newToken;
    updateData.qrCodeGeneratedAt = new Date();
    description = `Regenerated QR token for session ${session.refNumber}`;
    descriptionAr = `تم إعادة توليد رمز QR لجلسة ${session.refNumber}`;
    qrUrl = buildCheckInUrl(origin, newToken);
  }

  const updated = await db.trainingSession.update({
    where: { id },
    data: updateData,
  });

  await audit({
    user,
    action: "QR_REGENERATE",
    entity: "SESSION",
    entityId: id,
    entityRef: updated.refNumber,
    description,
    descriptionAr,
    req,
  });

  // Return the appropriate URL based on token type
  if (tokenType === "preTest") {
    return ok({
      sessionId: updated.id,
      sessionRef: updated.refNumber,
      preTestQrToken: updated.preTestQrToken,
      preTestUrl: qrUrl,
    });
  } else if (tokenType === "finalTest") {
    return ok({
      sessionId: updated.id,
      sessionRef: updated.refNumber,
      finalTestQrToken: updated.finalTestQrToken,
      finalTestUrl: qrUrl,
    });
  } else if (tokenType === "evaluation") {
    return ok({
      sessionId: updated.id,
      sessionRef: updated.refNumber,
      evaluationQrToken: updated.evaluationQrToken,
      evaluationUrl: qrUrl,
    });
  }

  return ok({
    sessionId: updated.id,
    sessionRef: updated.refNumber,
    sessionCode: updated.refNumber,
    qrCodeToken: updated.qrCodeToken,
    checkInUrl: qrUrl,
  });
});
