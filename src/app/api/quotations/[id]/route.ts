// /api/quotations/[id] — get / update / delete (soft) a quotation
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const GET = withModuleAction("quotations", "view", async ({ params, user }) => {
  const id = params.id as string;
  const q = await db.quotation.findUnique({ where: { id }, include: { company: { select: { id: true, name: true, refNumber: true } }, request: { select: { id: true, refNumber: true } } } });
  if (!q || q.deletedAt) return notFound("Quotation not found");
  if (user.role === "CONTRACTOR" && user.companyId !== q.companyId) return notFound("Quotation not found");
  return ok(q);
});

export const PUT = withModuleAction("quotations", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const existing = await db.quotation.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Quotation not found");
  const body = await req.json().catch(() => ({}));
  const { lineItems, subtotal, discountAmount, discountPercent, vatRate, status, notes, termsConditions, validUntil } = body;

  let newSubtotal = existing.subtotal, newDiscount = existing.discountAmount, newVatRate = existing.vatRate, newVatAmount = existing.vatAmount, newGrandTotal = existing.grandTotal;
  if (subtotal !== undefined || discountAmount !== undefined || vatRate !== undefined) {
    newSubtotal = subtotal !== undefined ? parseFloat(subtotal) : existing.subtotal;
    newDiscount = discountAmount !== undefined ? parseFloat(discountAmount) : existing.discountAmount;
    newVatRate = vatRate !== undefined ? parseFloat(vatRate) : existing.vatRate;
    const afterDisc = newSubtotal - newDiscount;
    newVatAmount = afterDisc * (newVatRate / 100);
    newGrandTotal = afterDisc + newVatAmount;
  }

  const updated = await db.quotation.update({
    where: { id },
    data: {
      ...(lineItems !== undefined && { lineItems: typeof lineItems === "string" ? lineItems : JSON.stringify(lineItems) }),
      ...(subtotal !== undefined && { subtotal: newSubtotal }),
      ...(discountAmount !== undefined && { discountAmount: newDiscount }),
      ...(discountPercent !== undefined && { discountPercent: parseFloat(discountPercent) }),
      ...(vatRate !== undefined && { vatRate: newVatRate }),
      ...(subtotal !== undefined || discountAmount !== undefined || vatRate !== undefined) && { vatAmount: newVatAmount, grandTotal: newGrandTotal },
      ...(status !== undefined && { status }),
      ...(notes !== undefined && { notes }),
      ...(termsConditions !== undefined && { termsConditions }),
      ...(validUntil !== undefined && { validUntil: validUntil ? new Date(validUntil) : null }),
      updatedBy: user.id,
    },
  });

  await audit({ user, action: "UPDATE", entity: "SETTING", entityId: id, description: `Updated quotation ${existing.refNumber}`, req, metadata: { ...({ action: "QUOTATION_EDITED" }), oldValue: (existing), newValue: (updated) } });
  return ok(updated);
});

export const DELETE = withModuleAction("quotations", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.quotation.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Quotation not found");
  await db.quotation.update({ where: { id }, data: { deletedAt: new Date(), status: "EXPIRED", updatedBy: user.id } });
  await audit({ user, action: "DELETE", entity: "SETTING", entityId: id, description: `Deleted quotation ${existing.refNumber}`, req, metadata: { action: "QUOTATION_DELETED" } });
  return ok({ success: true });
});
