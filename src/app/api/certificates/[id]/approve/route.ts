// /api/certificates/[id]/approve — coordinator approves a pending certificate
// =====================================================================
// Sprint 6: Certificate approval workflow.
//
// Flow: PENDING_APPROVAL → APPROVED (after coordinator review)
//
// After approval, the certificate is ready to be issued (PDF generated).
// Use POST /api/certificates/[id]/generate-pdf to issue.
//
// Permissions: SUPER_ADMIN or COORDINATOR
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, fail, notFound, audit } from "@/lib/auth/api";

export const POST = withErrorEnvelope(async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SUPER_ADMIN", "COORDINATOR");
  const { id } = await ctx.params;

  const cert = await db.certificate.findUnique({
    where: { id },
    include: { course: true, company: true },
  });
  if (!cert || cert.deletedAt) return notFound("Certificate not found");

  // State machine: only PENDING_APPROVAL can be approved
  if (cert.status !== "PENDING_APPROVAL") {
    return fail(
      `Certificate cannot be approved from status: ${cert.status}. Only PENDING_APPROVAL certificates can be approved.`,
      400,
      "INVALID_TRANSITION",
      { currentStatus: cert.status }
    );
  }

  const updated = await db.certificate.update({
    where: { id },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "APPROVE",
    entity: "CERTIFICATE",
    entityId: id,
    entityRef: cert.refNumber,
    description: `Approved certificate ${cert.refNumber} for ${cert.traineeName} (score: ${cert.finalScore}%)`,
    descriptionAr: `اعتماد شهادة ${cert.refNumber} لـ ${cert.traineeName} (النتيجة: ${cert.finalScore}%)`,
    req,
    metadata: {
      refNumber: cert.refNumber,
      traineeName: cert.traineeName,
      finalScore: cert.finalScore,
      courseCode: cert.course?.code,
    },
  });

  // ── Notify the trainee that their certificate has been approved ─────
  // We don't have a direct user.id for trainees (they're not always users),
  // so we create a broadcast notification that the trainee can see if/when
  // they sign in. The notification title includes the trainee name.
  try {
    await db.notification.create({
      data: {
        userId: null, // broadcast — visible to all (filtered by trainee name on the client)
        title: "Certificate Approved",
        titleAr: "تم اعتماد الشهادة",
        message: `Your certificate (${cert.refNumber}) for course "${cert.course?.title ?? ""}" has been approved. You can download it once it's issued.`,
        messageAr: `تم اعتماد شهادتك (${cert.refNumber}) للدورة "${cert.course?.titleAr ?? cert.course?.title ?? ""}". يمكنك تحميلها بمجرد إصدارها.`,
        type: "SUCCESS",
        category: "CERTIFICATE",
        link: `/certificates`,
      },
    });
  } catch {
    // notification failure shouldn't block the approval
  }

  return ok({
    id: updated.id,
    refNumber: updated.refNumber,
    status: updated.status,
    approvedAt: updated.approvedAt,
    approvedBy: updated.approvedBy,
  });
});
