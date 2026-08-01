// /api/bank-accounts/[id] — update / delete a bank account
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const GET = withModuleAction("bank-accounts", "view", async ({ params }) => {
  const id = params.id as string;
  const account = await db.bankAccount.findUnique({ where: { id } });
  if (!account || account.deletedAt) return notFound("Bank account not found");
  return ok(account);
});

export const PUT = withModuleAction("bank-accounts", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const existing = await db.bankAccount.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Bank account not found");

  const body = await req.json().catch(() => ({}));
  const { bankName, beneficiary, accountNumber, iban, swift, qrImageUrl, isActive, isDefault } = body;

  // If setting as default, unset any existing default
  if (isDefault && !existing.isDefault) {
    await db.bankAccount.updateMany({ where: { isDefault: true, deletedAt: null, NOT: { id } }, data: { isDefault: false } });
  }

  const updated = await db.bankAccount.update({
    where: { id },
    data: {
      ...(bankName !== undefined && { bankName }),
      ...(beneficiary !== undefined && { beneficiary }),
      ...(accountNumber !== undefined && { accountNumber }),
      ...(iban !== undefined && { iban }),
      ...(swift !== undefined && { swift }),
      ...(qrImageUrl !== undefined && { qrImageUrl }),
      ...(isActive !== undefined && { isActive }),
      ...(isDefault !== undefined && { isDefault }),
      updatedBy: user.id,
    },
  });

  await audit({
    user, action: "UPDATE", entity: "SETTING", entityId: id,
    description: `Updated bank account: ${updated.bankName}`,
    descriptionAr: `تم تحديث حساب بنكي: ${updated.bankName}`,
    req, oldValue: existing, newValue: updated,
    metadata: { action: "BANK_ACCOUNT_CHANGED" },
  });

  return ok(updated);
});

export const DELETE = withModuleAction("bank-accounts", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.bankAccount.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Bank account not found");

  await db.bankAccount.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id, isActive: false },
  });

  await audit({
    user, action: "DELETE", entity: "SETTING", entityId: id,
    description: `Deleted bank account: ${existing.bankName}`,
    descriptionAr: `تم حذف حساب بنكي: ${existing.bankName}`,
    req, metadata: { action: "BANK_ACCOUNT_DELETED" },
  });

  return ok({ success: true });
});
