// /api/session-payments/[id]/release-printing — coordinator grants
// certificate printing permission to the contractor after full payment.
//
// POST: sets printingReleased=true on the SessionPayment. This is the final
//      gate — contractors can only download/print certificates after this
//      flag is set AND the release-certificates flow has run.
//
// RBAC: Coordinator + SUPER_ADMIN only.
// Business rule: printingReleased can only be set when verificationStatus
// = "VERIFIED" (i.e. paidAmount >= totalAmount).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const id = params.id as string;

  // Only coordinators and admins
  if (user.role !== "COORDINATOR" && user.role !== "SUPER_ADMIN") {
    return fail("Forbidden — only coordinators can release certificate printing", 403, "FORBIDDEN");
  }

  const body = await req.json().catch(() => ({}));
  const { notes } = body;

  const sp = await db.sessionPayment.findUnique({
    where: { id },
    include: {
      company: { select: { name: true } },
      trainingSession: { select: { refNumber: true } },
    },
  });
  if (!sp || sp.deletedAt) return fail("Session payment not found", 404);

  // Must be fully verified
  if (sp.verificationStatus !== "VERIFIED") {
    return fail(
      `Cannot release printing: payment verification status is ${sp.verificationStatus}. Payment must be fully verified (VERIFIED) before printing can be released.`,
      422,
      "PAYMENT_NOT_VERIFIED",
      { verificationStatus: sp.verificationStatus, paidAmount: sp.paidAmount, totalAmount: sp.totalAmount },
    );
  }

  if (sp.printingReleased) {
    return fail("Printing permission is already released", 422, "ALREADY_RELEASED");
  }

  const now = new Date();
  const updated = await db.sessionPayment.update({
    where: { id },
    data: {
      printingReleased: true,
      printingReleasedBy: user.id,
      printingReleasedAt: now,
      verificationNotes: notes ?? sp.verificationNotes,
      updatedBy: user.id,
      updatedAt: now,
    },
  });

  // ── Notify the contractor ───────────────────────────────────────────────
  const contractors = await db.user.findMany({
    where: { role: "CONTRACTOR", companyId: sp.companyId, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (contractors.length > 0) {
    await db.notification.createMany({
      data: contractors.map((c) => ({
        id: crypto.randomUUID(),
        userId: c.id,
        title: "Certificate Printing Released",
        titleAr: "تم السماح بطباعة الشهادات",
        message: `Certificate printing has been released for session ${sp.trainingSession.refNumber}. You can now download certificates.`,
        messageAr: `تم السماح بطباعة الشهادات لجلسة ${sp.trainingSession.refNumber}. يمكنك الآن تنزيل الشهادات.`,
        type: "SUCCESS",
        category: "FINANCIAL",
        updatedAt: now,
      })),
    });
  }

  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: sp.sessionId,
    entityRef: sp.trainingSession.refNumber,
    description: `Certificate printing released for ${sp.company?.name} (Session ${sp.trainingSession.refNumber}) — full payment verified`,
    descriptionAr: `تم السماح بطباعة الشهادات لـ ${sp.company?.name} (جلسة ${sp.trainingSession.refNumber}) — تم التحقق من الدفع الكامل`,
    req,
    oldValue: { printingReleased: false },
    newValue: { printingReleased: true, printingReleasedBy: user.id, printingReleasedAt: now },
    metadata: {
      action: "CERTIFICATE_PRINTING_RELEASED",
      sessionPaymentId: id,
      companyId: sp.companyId,
      companyName: sp.company?.name ?? null,
      paidAmount: sp.paidAmount,
      totalAmount: sp.totalAmount,
    },
  });

  return ok({
    sessionPaymentId: id,
    printingReleased: true,
    printingReleasedBy: user.id,
    printingReleasedAt: now,
  });
});
