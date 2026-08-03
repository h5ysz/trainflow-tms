// /api/payments/[id] — get / update / soft-delete a payment
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const GET = withModuleAction("payments", "view", async ({ params, user }) => {
  const id = params.id as string;
  const payment = await db.payment.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, refNumber: true } },
      invoice: { select: { id: true, refNumber: true } },
      receipts: { where: { deletedAt: null } },
    },
  });
  if (!payment || payment.deletedAt) return notFound("Payment not found");
  if (user.role === "CONTRACTOR" && user.companyId !== payment.companyId) {
    return notFound("Payment not found");
  }
  return ok(payment);
});

export const PUT = withModuleAction("payments", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const existing = await db.payment.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Payment not found");

  const body = await req.json().catch(() => ({}));
  const { status, referenceNumber, notes, paidBy, method } = body;

  const updated = await db.payment.update({
    where: { id },
    data: {
      ...(status !== undefined && { status }),
      ...(referenceNumber !== undefined && { referenceNumber }),
      ...(notes !== undefined && { notes }),
      ...(paidBy !== undefined && { paidBy }),
      ...(method !== undefined && { method }),
      updatedBy: user.id,
    },
  });

  await audit({
    user, action: "UPDATE", entity: "SETTING", entityId: id,
    description: `Updated payment ${existing.refNumber}`,
    descriptionAr: `تم تحديث دفعة ${existing.refNumber}`,
    req, oldValue: existing, newValue: updated,
    metadata: { action: "PAYMENT_UPDATED" },
  });

  return ok(updated);
});

export const DELETE = withModuleAction("payments", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.payment.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Payment not found");

  await db.payment.update({
    where: { id },
    data: { deletedAt: new Date(), status: "CANCELLED", updatedBy: user.id },
  });

  await audit({
    user, action: "DELETE", entity: "SETTING", entityId: id,
    description: `Cancelled payment ${existing.refNumber}`,
    descriptionAr: `تم إلغاء دفعة ${existing.refNumber}`,
    req, metadata: { action: "PAYMENT_CANCELLED" },
  });

  return ok({ success: true });
});
