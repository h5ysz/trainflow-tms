// /api/payments — list + register a payment
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { nextRefNumber } from "@/lib/api/ref-number";

const ALLOWED_SORT_FIELDS = ["refNumber", "paymentDate", "amount", "status", "createdAt"];

export const GET = withModuleAction("payments", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.companyId) where.companyId = q.filters.companyId;
  if (q.filters.invoiceId) where.invoiceId = q.filters.invoiceId;
  if (q.filters.method) where.method = q.filters.method;
  if (user.role === "CONTRACTOR" && user.companyId) {
    where.companyId = user.companyId;
  }
  if (q.search) {
    where.OR = [
      { refNumber: { contains: q.search } },
      { referenceNumber: { contains: q.search } },
      { company: { name: { contains: q.search } } },
    ];
  }
  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);
  const [rows, total] = await Promise.all([
    db.payment.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, refNumber: true } },
        invoice: { select: { id: true, refNumber: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.payment.count({ where }),
  ]);
  return list(rows, buildListMeta(total, q));
});

export const POST = withModuleAction("payments", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    invoiceId, companyId, amount, vatAmount, currency, method,
    paymentDate, referenceNumber, bankAccountId, paidBy, notes, status,
  } = body;

  if (!companyId || !amount || !method) {
    return fail("companyId, amount, and method are required", 422, "VALIDATION_ERROR");
  }

  const refNumber = await nextRefNumber("PAYMENT");
  const paymentStatus = status ?? "PAID"; // default to PAID for manual registrations

  const payment = await db.payment.create({
    data: {
      refNumber,
      invoiceId: invoiceId ?? null,
      companyId,
      amount: parseFloat(amount),
      vatAmount: vatAmount ? parseFloat(vatAmount) : 0,
      currency: currency ?? "SAR",
      method,
      status: paymentStatus,
      paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
      referenceNumber: referenceNumber ?? null,
      bankAccountId: bankAccountId ?? null,
      paidBy: paidBy ?? null,
      notes: notes ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  // If linked to a single invoice, update the invoice's paidAmount + outstanding + status
  if (invoiceId) {
    const invoice = await db.invoice.findUnique({ where: { id: invoiceId } });
    if (invoice && !invoice.deletedAt) {
      const newPaidAmount = invoice.paidAmount + parseFloat(amount);
      const newOutstanding = invoice.grandTotal - newPaidAmount;
      let newStatus = invoice.status;
      if (newOutstanding <= 0) newStatus = "PAID";
      else if (newPaidAmount > 0) newStatus = "PARTIALLY_PAID";

      await db.invoice.update({
        where: { id: invoiceId },
        data: {
          paidAmount: newPaidAmount,
          outstandingBalance: newOutstanding,
          status: newStatus,
          ...(newStatus === "PAID" && { paidDate: new Date() }),
          updatedBy: user.id,
        },
      });

      // Auto-generate a receipt if payment is confirmed
      if (paymentStatus === "PAID") {
        let settings = await db.financialSettings.findUnique({ where: { id: "default" } });
        if (!settings) settings = await db.financialSettings.create({ data: { id: "default" } });
        const receiptRef = await nextRefNumber("RECEIPT");
        const receiptSnapshot = JSON.stringify({
          company: { name: settings.companyName, crNumber: settings.crNumber, vatNumber: settings.vatNumber },
        });
        await db.receipt.create({
          data: {
            refNumber: receiptRef,
            paymentId: payment.id,
            invoiceId,
            companyId,
            amount: parseFloat(amount),
            vatAmount: vatAmount ? parseFloat(vatAmount) : 0,
            currency: currency ?? "SAR",
            receiptDate: new Date(),
            paymentMethod: method,
            paidBy: paidBy ?? null,
            referenceNumber: referenceNumber ?? null,
            snapshot: receiptSnapshot,
            createdBy: user.id,
            updatedBy: user.id,
          },
        });
      }
    }
  }

  await audit({
    user, action: "CREATE", entity: "SETTING", entityId: payment.id,
    description: `Registered payment ${refNumber} — ${amount} ${currency ?? "SAR"} via ${method}`,
    descriptionAr: `تم تسجيل دفعة ${refNumber} — ${amount} ${currency ?? "SAR"}`,
    req, metadata: { action: "PAYMENT_REGISTERED", refNumber, amount, method, invoiceId, companyId },
  });

  return created(payment);
});
