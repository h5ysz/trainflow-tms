// /api/financial-settings — company financial settings (single row)
// GET: any authenticated user with finance.view (coordinators need to see
//      company info on invoices they create)
// PUT: SUPER_ADMIN only
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { canPerformAction } from "@/lib/auth/permissions";

export const GET = withModuleAction("invoices", "view", async () => {
  let settings = await db.financialSettings.findUnique({ where: { id: "default" } });
  if (!settings) {
    settings = await db.financialSettings.create({ data: { id: "default" } });
  }
  return ok(settings);
});

export const PUT = withModuleAction("financial-settings", "edit", async ({ req, user }) => {
  const existing = await db.financialSettings.findUnique({ where: { id: "default" } });
  if (!existing) return fail("Financial settings not found", 404);

  const body = await req.json().catch(() => ({}));
  const {
    companyName, crNumber, vatNumber, financeEmail, companyLogoUrl,
    address, phone, currency, vatRate, defaultDueDays,
    invoiceSeq, quotationSeq, receiptSeq,
  } = body;

  const updated = await db.financialSettings.update({
    where: { id: "default" },
    data: {
      ...(companyName !== undefined && { companyName }),
      ...(crNumber !== undefined && { crNumber }),
      ...(vatNumber !== undefined && { vatNumber }),
      ...(financeEmail !== undefined && { financeEmail }),
      ...(companyLogoUrl !== undefined && { companyLogoUrl }),
      ...(address !== undefined && { address }),
      ...(phone !== undefined && { phone }),
      ...(currency !== undefined && { currency }),
      ...(vatRate !== undefined && { vatRate }),
      ...(defaultDueDays !== undefined && { defaultDueDays }),
      ...(invoiceSeq !== undefined && { invoiceSeq }),
      ...(quotationSeq !== undefined && { quotationSeq }),
      ...(receiptSeq !== undefined && { receiptSeq }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "SETTING",
    entityId: "financial-settings",
    description: "Updated financial settings",
    descriptionAr: "تم تحديث الإعدادات المالية",
    req,
    metadata: { oldValue: existing, newValue: updated },
  });

  return ok(updated);
});
