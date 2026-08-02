// /api/session-payments/[id]/verify — coordinator verifies a payment receipt
//
// PUT: verify or reject a specific receipt. When verified, the receipt's
//      amount is added to the SessionPayment's paidAmount. When all receipts
//      are verified and paidAmount >= totalAmount, the verificationStatus
//      becomes VERIFIED.
//
// Body: {
//   receiptId: string,
//   action: "verify" | "reject",
//   rejectionReason?: string,   // required if action=reject
//   notes?: string,
// }
//
// RBAC: Coordinator + SUPER_ADMIN only. Contractors and trainers are blocked.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const PUT = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const { receiptId, action, rejectionReason, notes } = body;

  if (!receiptId || !action) {
    return fail("receiptId and action are required", 422, "VALIDATION_ERROR");
  }
  if (action !== "verify" && action !== "reject") {
    return fail("action must be 'verify' or 'reject'", 422, "VALIDATION_ERROR");
  }
  if (action === "reject" && !rejectionReason) {
    return fail("rejectionReason is required when rejecting", 422, "VALIDATION_ERROR");
  }

  // Only coordinators and admins can verify
  if (user.role !== "COORDINATOR" && user.role !== "SUPER_ADMIN") {
    return fail("Forbidden — only coordinators can verify payment receipts", 403, "FORBIDDEN");
  }

  const sp = await db.sessionPayment.findUnique({
    where: { id },
    include: {
      company: { select: { name: true } },
      trainingSession: { select: { refNumber: true } },
      receipts: true,
    },
  });
  if (!sp || sp.deletedAt) return fail("Session payment not found", 404);

  const receipt = sp.receipts.find((r) => r.id === receiptId);
  if (!receipt) return notFound("Receipt not found");
  if (receipt.status !== "PENDING") {
    return fail(`Receipt is already ${receipt.status}`, 422, "ALREADY_PROCESSED");
  }

  const now = new Date();

  if (action === "reject") {
    // ── Reject the receipt ──────────────────────────────────────────────
    await db.paymentReceipt.update({
      where: { id: receiptId },
      data: {
        status: "REJECTED",
        verifiedById: user.id,
        verifiedAt: now,
        rejectionReason,
        notes: notes ?? null,
        updatedAt: now,
      },
    });

    await audit({
      user,
      action: "UPDATE",
      entity: "SESSION",
      entityId: sp.sessionId,
      entityRef: sp.trainingSession.refNumber,
      description: `Payment receipt rejected: ${receipt.amount} ${receipt.currency} for ${sp.company?.name} — ${rejectionReason}`,
      descriptionAr: `تم رفض إيصال الدفع: ${receipt.amount} ${receipt.currency} لـ ${sp.company?.name} — ${rejectionReason}`,
      req,
      oldValue: { receiptStatus: "PENDING" },
      newValue: { receiptStatus: "REJECTED", rejectionReason },
      metadata: {
        action: "PAYMENT_RECEIPT_REJECTED",
        sessionPaymentId: id,
        receiptId,
        amount: receipt.amount,
        rejectionReason,
      },
    });

    return ok({ receiptId, status: "REJECTED" });
  }

  // ── Verify the receipt ─────────────────────────────────────────────────
  await db.$transaction(async (tx) => {
    // Mark receipt as verified
    await tx.paymentReceipt.update({
      where: { id: receiptId },
      data: {
        status: "VERIFIED",
        verifiedById: user.id,
        verifiedAt: now,
        notes: notes ?? null,
        updatedAt: now,
      },
    });

    // Add the receipt amount to paidAmount
    const newPaidAmount = sp.paidAmount + receipt.amount;
    const remaining = Math.max(0, sp.totalAmount - newPaidAmount);
    const newStatus = remaining <= 0.01 ? "VERIFIED" : newPaidAmount > 0 ? "PARTIALLY_VERIFIED" : "PENDING";

    await tx.sessionPayment.update({
      where: { id },
      data: {
        paidAmount: newPaidAmount,
        verificationStatus: newStatus,
        verifiedBy: user.id,
        verifiedAt: now,
        verificationNotes: notes ?? sp.verificationNotes,
        updatedBy: user.id,
        updatedAt: now,
      },
    });
  });

  // Re-fetch to get the updated state
  const updated = await db.sessionPayment.findUnique({
    where: { id },
    select: { paidAmount: true, totalAmount: true, verificationStatus: true },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: sp.sessionId,
    entityRef: sp.trainingSession.refNumber,
    description: `Payment receipt verified: +${receipt.amount} ${receipt.currency} for ${sp.company?.name}. Total paid: ${updated?.paidAmount}/${updated?.totalAmount} ${sp.currency} (${updated?.verificationStatus})`,
    descriptionAr: `تم اعتماد إيصال الدفع: +${receipt.amount} ${receipt.currency} لـ ${sp.company?.name}. إجمالي المدفوع: ${updated?.paidAmount}/${updated?.totalAmount} ${sp.currency} (${updated?.verificationStatus})`,
    req,
    oldValue: { receiptStatus: "PENDING", paidAmount: sp.paidAmount, verificationStatus: sp.verificationStatus },
    newValue: { receiptStatus: "VERIFIED", paidAmount: updated?.paidAmount, verificationStatus: updated?.verificationStatus },
    metadata: {
      action: "PAYMENT_RECEIPT_VERIFIED",
      sessionPaymentId: id,
      receiptId,
      receiptAmount: receipt.amount,
      newPaidAmount: updated?.paidAmount,
      totalAmount: updated?.totalAmount,
      verificationStatus: updated?.verificationStatus,
    },
  });

  return ok({
    receiptId,
    status: "VERIFIED",
    paidAmount: updated?.paidAmount,
    totalAmount: updated?.totalAmount,
    verificationStatus: updated?.verificationStatus,
  });
});
