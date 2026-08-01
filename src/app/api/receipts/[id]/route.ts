// /api/receipts/[id] — get a single receipt
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound } from "@/lib/auth/api";

export const GET = withModuleAction("receipts", "view", async ({ params, user }) => {
  const id = params.id as string;
  const receipt = await db.receipt.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, refNumber: true, crNumber: true, vatNumber: true, address: true, phone: true, email: true } },
      invoice: { select: { id: true, refNumber: true, grandTotal: true, paidAmount: true, outstandingBalance: true, currency: true } },
      payment: { select: { id: true, refNumber: true, method: true, referenceNumber: true, paidBy: true } },
    },
  });
  if (!receipt || receipt.deletedAt) return notFound("Receipt not found");
  if (user.role === "CONTRACTOR" && user.companyId !== receipt.companyId) return notFound("Receipt not found");
  return ok(receipt);
});
