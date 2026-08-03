// /api/invoices/[id] — get / update / delete (soft) an invoice
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const GET = withModuleAction("invoices", "view", async ({ params, user }) => {
  const id = params.id as string;
  const invoice = await db.invoice.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, refNumber: true, crNumber: true, vatNumber: true, address: true, phone: true, email: true } },
      request: { select: { id: true, refNumber: true } },
      session: { select: { id: true, refNumber: true, title: true } },
      quotation: { select: { id: true, refNumber: true } },
      bankAccount: true,
      payments: { where: { deletedAt: null }, orderBy: { paymentDate: "desc" } },
      receipts: { where: { deletedAt: null }, orderBy: { receiptDate: "desc" } },
    },
  });
  if (!invoice || invoice.deletedAt) return notFound("Invoice not found");
  // Contractors see only their own invoices
  if (user.role === "CONTRACTOR" && user.companyId !== invoice.companyId) {
    return notFound("Invoice not found");
  }
  return ok(invoice);
});

export const PUT = withModuleAction("invoices", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const existing = await db.invoice.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Invoice not found");

  const body = await req.json().catch(() => ({}));
  const {
    lineItems, subtotal, discountAmount, discountPercent,
    vatRate, dueDate, bankAccountId,
    coordinatorNotes, paymentNotes, status,
  } = body;

  // Recalculate totals if line items or amounts changed
  let newSubtotal = existing.subtotal;
  let newDiscount = existing.discountAmount;
  let newVatRate = existing.vatRate;
  let newVatAmount = existing.vatAmount;
  let newGrandTotal = existing.grandTotal;
  let newOutstanding = existing.outstandingBalance;

  if (subtotal !== undefined || discountAmount !== undefined || vatRate !== undefined) {
    newSubtotal = subtotal !== undefined ? parseFloat(subtotal) : existing.subtotal;
    newDiscount = discountAmount !== undefined ? parseFloat(discountAmount) : existing.discountAmount;
    newVatRate = vatRate !== undefined ? parseFloat(vatRate) : existing.vatRate;
    const afterDiscount = newSubtotal - newDiscount;
    newVatAmount = afterDiscount * (newVatRate / 100);
    newGrandTotal = afterDiscount + newVatAmount;
    newOutstanding = newGrandTotal - existing.paidAmount;
  }

  const updated = await db.invoice.update({
    where: { id },
    data: {
      ...(lineItems !== undefined && { lineItems: typeof lineItems === "string" ? lineItems : JSON.stringify(lineItems) }),
      ...(subtotal !== undefined && { subtotal: newSubtotal }),
      ...(discountAmount !== undefined && { discountAmount: newDiscount }),
      ...(discountPercent !== undefined && { discountPercent: parseFloat(discountPercent) }),
      ...(vatRate !== undefined && { vatRate: newVatRate }),
      ...(subtotal !== undefined || discountAmount !== undefined || vatRate !== undefined) && {
        vatAmount: newVatAmount, grandTotal: newGrandTotal, outstandingBalance: newOutstanding,
      },
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      ...(bankAccountId !== undefined && { bankAccountId }),
      ...(coordinatorNotes !== undefined && { coordinatorNotes }),
      ...(paymentNotes !== undefined && { paymentNotes }),
      ...(status !== undefined && { status, ...(status === "PAID" && { paidDate: new Date() }) }),
      updatedBy: user.id,
    },
  });

  await audit({
    user, action: "UPDATE", entity: "SETTING", entityId: id,
    description: `Updated invoice ${existing.refNumber}`,
    descriptionAr: `تم تحديث فاتورة ${existing.refNumber}`,
    req, oldValue: existing, newValue: updated,
    metadata: { action: "INVOICE_EDITED" },
  });

  return ok(updated);
});

export const DELETE = withModuleAction("invoices", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.invoice.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Invoice not found");

  // Soft delete only — never hard-delete financial records
  await db.invoice.update({
    where: { id },
    data: { deletedAt: new Date(), status: "CANCELLED", updatedBy: user.id },
  });

  await audit({
    user, action: "DELETE", entity: "SETTING", entityId: id,
    description: `Cancelled invoice ${existing.refNumber}`,
    descriptionAr: `تم إلغاء فاتورة ${existing.refNumber}`,
    req, metadata: { action: "INVOICE_CANCELLED" },
  });

  return ok({ success: true });
});
