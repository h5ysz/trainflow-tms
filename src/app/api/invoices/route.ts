// /api/invoices — list + create invoices
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit, companyScope } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { nextRefNumber } from "@/lib/api/ref-number";

const ALLOWED_SORT_FIELDS = ["refNumber", "issueDate", "dueDate", "grandTotal", "status", "createdAt"];

export const GET = withModuleAction("invoices", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.companyId) where.companyId = q.filters.companyId;
  if (q.filters.requestId) where.requestId = q.filters.requestId;
  if (q.filters.sessionId) where.sessionId = q.filters.sessionId;
  // Contractors see only their own invoices
  const scope = companyScope(user);
  if (scope) Object.assign(where, scope);
  if (q.search) {
    where.OR = [
      { refNumber: { contains: q.search } },
      { company: { name: { contains: q.search } } },
    ];
  }
  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);
  const [rows, total] = await Promise.all([
    db.invoice.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, refNumber: true } },
        request: { select: { id: true, refNumber: true } },
        session: { select: { id: true, refNumber: true, title: true } },
        bankAccount: { select: { id: true, bankName: true, iban: true } },
        _count: { select: { payments: true, receipts: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.invoice.count({ where }),
  ]);
  return list(rows, buildListMeta(total, q));
});

export const POST = withModuleAction("invoices", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    quotationId, requestId, sessionId, companyId,
    lineItems, subtotal, discountAmount, discountPercent,
    vatRate, currency, dueDate, bankAccountId,
    coordinatorNotes, paymentNotes, status,
  } = body;

  if (!companyId) return fail("companyId is required", 422, "VALIDATION_ERROR");
  if (!lineItems) return fail("lineItems is required", 422, "VALIDATION_ERROR");

  // Load financial settings for snapshot + VAT rate
  let settings = await db.financialSettings.findUnique({ where: { id: "default" } });
  if (!settings) {
    settings = await db.financialSettings.create({ data: { id: "default" } });
  }

  const effectiveVatRate = vatRate ?? settings.vatRate;
  const effectiveCurrency = currency ?? settings.currency;
  const effectiveSubtotal = parseFloat(subtotal) || 0;
  const effectiveDiscount = parseFloat(discountAmount) || 0;
  const afterDiscount = effectiveSubtotal - effectiveDiscount;
  const vatAmount = afterDiscount * (effectiveVatRate / 100);
  const grandTotal = afterDiscount + vatAmount;

  // Build the snapshot — frozen company/bank/settings info at issue time
  const bankAccount = bankAccountId
    ? await db.bankAccount.findFirst({ where: { id: bankAccountId, deletedAt: null } })
    : null;
  const company = await db.company.findFirst({ where: { id: companyId, deletedAt: null } });
  if (!company) return fail("Company not found", 404);

  const snapshot = JSON.stringify({
    company: {
      name: settings.companyName,
      crNumber: settings.crNumber,
      vatNumber: settings.vatNumber,
      email: settings.financeEmail,
      logoUrl: settings.companyLogoUrl,
      address: settings.address,
      phone: settings.phone,
    },
    bank: bankAccount ? {
      bankName: bankAccount.bankName,
      beneficiary: bankAccount.beneficiary,
      accountNumber: bankAccount.accountNumber,
      iban: bankAccount.iban,
      swift: bankAccount.swift,
    } : null,
    vatRate: effectiveVatRate,
    currency: effectiveCurrency,
    customer: {
      name: company.name,
      refNumber: company.refNumber,
      crNumber: company.crNumber,
      vatNumber: company.vatNumber,
      address: company.address,
      phone: company.phone,
      email: company.email,
    },
  });

  const refNumber = await nextRefNumber("INVOICE");
  const issueDate = new Date();
  const effectiveDueDate = dueDate ? new Date(dueDate) : new Date(issueDate.getTime() + (settings.defaultDueDays * 86400000));

  const invoice = await db.invoice.create({
    data: {
      refNumber,
      quotationId: quotationId ?? null,
      requestId: requestId ?? null,
      sessionId: sessionId ?? null,
      companyId,
      lineItems: typeof lineItems === "string" ? lineItems : JSON.stringify(lineItems),
      subtotal: effectiveSubtotal,
      discountAmount: effectiveDiscount,
      discountPercent: discountPercent ? parseFloat(discountPercent) : null,
      vatAmount,
      grandTotal,
      paidAmount: 0,
      outstandingBalance: grandTotal,
      currency: effectiveCurrency,
      vatRate: effectiveVatRate,
      status: status ?? "DRAFT",
      issueDate,
      dueDate: effectiveDueDate,
      bankAccountId: bankAccountId ?? null,
      coordinatorNotes: coordinatorNotes ?? null,
      paymentNotes: paymentNotes ?? null,
      snapshot,
      createdBy: user.id,
      updatedBy: user.id,
    },
    include: {
      company: { select: { id: true, name: true, refNumber: true } },
    },
  });

  await audit({
    user, action: "CREATE", entity: "SETTING", entityId: invoice.id,
    description: `Created invoice ${invoice.refNumber} for ${company.name} — ${grandTotal.toFixed(2)} ${effectiveCurrency}`,
    descriptionAr: `تم إنشاء فاتورة ${invoice.refNumber} لـ ${company.name}`,
    req, metadata: { action: "INVOICE_CREATED", refNumber, grandTotal, companyId },
  });

  return created(invoice);
});
