// /api/payments/[id]/approve — coordinator approves or rejects a contractor-submitted payment
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { nextRefNumber } from "@/lib/api/ref-number";

export const POST = withModuleAction("payments", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const { action } = body; // "approve" or "reject"

  if (!action || !["approve", "reject"].includes(action)) {
    return fail("action must be 'approve' or 'reject'", 422, "VALIDATION_ERROR");
  }

  const payment = await db.payment.findUnique({
    where: { id },
    include: { invoice: true },
  });
  if (!payment || payment.deletedAt) return notFound("Payment not found");
  if (payment.status !== "PENDING") {
    return fail(`Payment is already ${payment.status}`, 400, "INVALID_STATUS");
  }

  if (action === "reject") {
    const updated = await db.payment.update({
      where: { id },
      data: { status: "CANCELLED", updatedBy: user.id },
    });

    await audit({
      user, action: "UPDATE", entity: "SETTING", entityId: id,
      description: `Rejected payment ${payment.refNumber} for ${payment.invoice?.refNumber ?? "—"}`,
      descriptionAr: `رفض دفعة ${payment.refNumber}`,
      req, metadata: { action: "PAYMENT_REJECTED", paymentId: id, invoiceId: payment.invoiceId },
    });

    return ok({ ...updated, approved: false });
  }

  // ── Approve ──────────────────────────────────────────────────────────
  // Update payment status to PAID
  const updatedPayment = await db.payment.update({
    where: { id },
    data: { status: "PAID", updatedBy: user.id },
  });

  // Update the linked invoice
  if (payment.invoiceId && payment.invoice) {
    const inv = payment.invoice;
    const newPaidAmount = inv.paidAmount + payment.amount;
    const newOutstanding = inv.grandTotal - newPaidAmount;
    let newStatus = inv.status;
    if (newOutstanding <= 0) newStatus = "PAID";
    else if (newPaidAmount > 0) newStatus = "PARTIALLY_PAID";

    await db.invoice.update({
      where: { id: inv.id },
      data: {
        paidAmount: newPaidAmount,
        outstandingBalance: newOutstanding,
        status: newStatus,
        ...(newStatus === "PAID" && { paidDate: new Date() }),
        updatedBy: user.id,
      },
    });

    // Auto-generate receipt
    let settings = await db.financialSettings.findUnique({ where: { id: "default" } });
    if (!settings) settings = await db.financialSettings.create({ data: { id: "default" } });
    const receiptRef = await nextRefNumber("RECEIPT");
    const receiptSnapshot = JSON.stringify({
      company: { name: settings.companyName, crNumber: settings.crNumber, vatNumber: settings.vatNumber },
    });
    await db.receipt.create({
      data: {
        refNumber: receiptRef,
        paymentId: id,
        invoiceId: inv.id,
        companyId: payment.companyId,
        amount: payment.amount,
        currency: payment.currency,
        receiptDate: new Date(),
        paymentMethod: payment.method,
        paidBy: payment.paidBy,
        referenceNumber: payment.referenceNumber,
        snapshot: receiptSnapshot,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
  }

  // Create notification for the contractor's company users
  const companyUsers = await db.user.findMany({ where: { companyId: payment.companyId, deletedAt: null, isActive: true }, select: { id: true } });
  if (companyUsers.length > 0) {
    await db.notification.createMany({
      data: companyUsers.map(u => ({
        userId: u.id,
        title: "Payment Approved",
        message: `Your payment ${payment.refNumber} for invoice ${payment.invoice?.refNumber} has been approved. A receipt has been generated.`,
        titleAr: "اعتماد السداد",
        messageAr: `تم اعتماد دفعتك ${payment.refNumber} للفاتورة ${payment.invoice?.refNumber}. تم إصدار إيصال.`,
        type: "SUCCESS",
        category: "SYSTEM",
        link: "invoices",
        createdBy: user.id,
      })),
    });
  }

  await audit({
    user, action: "UPDATE", entity: "SETTING", entityId: id,
    description: `Approved payment ${payment.refNumber} — invoice ${payment.invoice?.refNumber} updated, receipt generated`,
    descriptionAr: `اعتماد دفعة ${payment.refNumber} — تحديث الفاتورة وإصدار إيصال`,
    req, metadata: { action: "PAYMENT_APPROVED", paymentId: id, invoiceId: payment.invoiceId },
  });

  return ok({ ...updatedPayment, approved: true });
});
