// /api/payments/submit — contractor submits a payment notification (upload transfer proof)
// The payment is created with status PENDING. The coordinator approves it
// via PUT /api/payments/[id]/approve.
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit, companyScope } from "@/lib/auth/api";
import { nextRefNumber } from "@/lib/api/ref-number";

export const POST = withModuleAction("payments", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { invoiceId, companyId, amount, method, paymentDate, referenceNumber, transferProofUrl, notes } = body;

  if (!invoiceId || !amount || !companyId) {
    return fail("invoiceId, amount, and companyId are required", 422, "VALIDATION_ERROR");
  }

  // Contractors can only submit for their own company
  const scope = companyScope(user);
  const finalCompanyId = scope ? (scope.companyId === "__NONE__" ? null : scope.companyId) : companyId;

  // Verify invoice belongs to this company
  const invoice = await db.invoice.findFirst({ where: { id: invoiceId, companyId: finalCompanyId, deletedAt: null } });
  if (!invoice) return fail("Invoice not found", 404);

  const refNumber = await nextRefNumber("PAYMENT");

  const payment = await db.payment.create({
    data: {
      refNumber,
      invoiceId,
      companyId: finalCompanyId,
      amount: parseFloat(amount),
      method: method || "BANK_TRANSFER",
      status: "PENDING", // coordinator must approve
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      referenceNumber: referenceNumber ?? null,
      notes: notes ?? null,
      // Store transfer proof URL in gatewayResponse as JSON
      gatewayResponse: transferProofUrl ? JSON.stringify({ transferProofUrl }) : null,
      paidBy: user.fullName,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user, action: "CREATE", entity: "SETTING", entityId: payment.id,
    description: `Contractor submitted payment ${refNumber} for ${invoice.refNumber} — pending approval`,
    descriptionAr: `قدم المقاول دفعة ${refNumber} لـ ${invoice.refNumber} — بانتظار الاعتماد`,
    req, metadata: { action: "PAYMENT_SUBMITTED", refNumber, invoiceId, amount, transferProofUrl },
  });

  return created(payment);
});
