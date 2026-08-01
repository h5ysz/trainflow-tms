// /api/invoices/[id]/send — send invoice notification to contractor
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";

export const POST = withModuleAction("invoices", "edit", async ({ params, user, req }) => {
  const id = params.id as string;
  const invoice = await db.invoice.findUnique({ where: { id }, include: { company: true } });
  if (!invoice || invoice.deletedAt) return notFound("Invoice not found");

  // Create notification for all users of the contractor company
  const companyUsers = await db.user.findMany({ where: { companyId: invoice.companyId, deletedAt: null, isActive: true }, select: { id: true } });
  if (companyUsers.length > 0) {
    await db.notification.createMany({
      data: companyUsers.map(u => ({
        userId: u.id,
        title: `Invoice ${invoice.refNumber}`,
        message: `A new invoice has been issued. Amount: ${invoice.grandTotal} ${invoice.currency}. Due: ${invoice.dueDate?.toLocaleDateString() ?? "—"}`,
        titleAr: `فاتورة ${invoice.refNumber}`,
        messageAr: `تم إصدار فاتورة جديدة. المبلغ: ${invoice.grandTotal} ${invoice.currency}. الاستحقاق: ${invoice.dueDate?.toLocaleDateString() ?? "—"}`,
        type: "INFO",
        category: "SYSTEM",
        link: "invoices",
        createdBy: user.id,
      })),
    });
  }

  await audit({
    user, action: "UPDATE", entity: "SETTING", entityId: id,
    description: `Sent invoice ${invoice.refNumber} to ${invoice.company.name}`,
    descriptionAr: `إرسال فاتورة ${invoice.refNumber} إلى ${invoice.company.name}`,
    req, metadata: { action: "INVOICE_SENT" },
  });

  return ok({ sent: true });
});
