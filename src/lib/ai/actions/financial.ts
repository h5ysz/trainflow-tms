// GCCLAB AI Copilot — Phase 2 — FINANCIAL actions
// =====================================================================
// create_quotation / create_invoice / send_invoice / register_payment /
// approve_payment / generate_receipt
//
// IMPORTANT: The Financial Module is FROZEN. These actions call the
// existing Prisma models (FinancialSettings, Quotation, Invoice, Payment,
// Receipt, BankAccount) directly without modifying any file in
// src/app/api/{quotations,invoices,payments,receipts,bank-accounts,
// financial-settings}/, src/lib/pdf/, or any financial-related component.
//
// Read+write access only — same models the existing endpoints use.
import { db } from "@/lib/db";
import { nextRefNumber } from "@/lib/api/ref-number";
import type { ActionHandler } from "./types";
import { ActionError } from "./types";
import { copilotAudit } from "./audit";

interface LineItem {
  courseTitle: string;
  traineeCount: number;
  unitPrice: number;
  lineTotal: number;
}

// ─── FINANCIAL_CREATE_QUOTATION ───────────────────────────────────────────
interface CreateQuotationInput {
  companyId: string;
  requestId?: string;
  lineItems: LineItem[];
  discountAmount?: number;
  discountPercent?: number;
  notes?: string;
}
const createQuotation: ActionHandler<CreateQuotationInput> = {
  type: "FINANCIAL_CREATE_QUOTATION",
  category: "FINANCIAL",
  description: "Create a quotation for a contractor with line items, discount, and VAT computed from FinancialSettings.",
  descriptionAr: "إنشاء عرض سعر لمقاول مع بنود وخصم وضريبة محسوبة من الإعدادات المالية.",
  resolvePermission: (role) => {
    if (role === "SUPER_ADMIN" || role === "COORDINATOR") return { module: "quotations", action: "create" };
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.companyId || !input.lineItems || input.lineItems.length === 0) {
      throw new ActionError("companyId and lineItems[] are required", 422, "VALIDATION_ERROR");
    }
    const company = await db.company.findFirst({ where: { id: input.companyId, deletedAt: null } });
    if (!company) throw new ActionError("Company not found", 404, "NOT_FOUND");
    const settings = await db.financialSettings.findUnique({ where: { id: "default" } });
    if (!settings) throw new ActionError("Financial settings not configured", 400, "NO_FINANCIAL_SETTINGS");
    const vatRate = settings.vatRate;
    const currency = settings.currency;
    const subtotal = input.lineItems.reduce((s, l) => s + l.lineTotal, 0);
    const discountAmount = input.discountAmount ?? (input.discountPercent ? subtotal * (input.discountPercent / 100) : 0);
    const taxableBase = subtotal - discountAmount;
    const vatAmount = taxableBase * (vatRate / 100);
    const grandTotal = taxableBase + vatAmount;
    return {
      actionType: "FINANCIAL_CREATE_QUOTATION",
      title: "Create Quotation",
      titleAr: "إنشاء عرض السعر",
      summary: `Create quotation for ${company.name}: ${input.lineItems.length} line item(s), total ${grandTotal.toFixed(2)} ${currency} (incl. VAT ${vatRate}%).`,
      summaryAr: `إنشاء عرض سعر لـ ${company.name}: ${input.lineItems.length} بند، الإجمالي ${grandTotal.toFixed(2)} ${currency} (شامل ضريبة ${vatRate}%).`,
      affectedRecords: [
        { entity: "COMPANY", refNumber: company.refNumber, description: company.name },
      ],
      changes: [
        { field: "lineItems", label: "Line Items", oldValue: null, newValue: input.lineItems.length },
        { field: "subtotal", label: "Subtotal", oldValue: null, newValue: `${subtotal.toFixed(2)} ${currency}` },
        { field: "discount", label: "Discount", oldValue: null, newValue: `${discountAmount.toFixed(2)} ${currency}` },
        { field: "vat", label: "VAT", oldValue: null, newValue: `${vatAmount.toFixed(2)} ${currency}` },
        { field: "grandTotal", label: "Grand Total", oldValue: null, newValue: `${grandTotal.toFixed(2)} ${currency}` },
      ],
      warnings: [],
      expectedResult: `Quotation will be created with ref QUO-YYYY-NNNNNN.`,
      expectedResultAr: `سيتم إنشاء عرض السعر بمرجع QUO-YYYY-NNNNNN.`,
      hydratedParams: {
        companyId: company.id, companyName: company.name,
        requestId: input.requestId ?? null,
        lineItems: input.lineItems,
        subtotal, discountAmount, vatAmount, grandTotal,
        vatRate, currency, notes: input.notes ?? null,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const refNumber = await nextRefNumber("QUOTATION");
    const quotation = await db.quotation.create({
      data: {
        refNumber,
        requestId: (p.requestId as string | null) ?? null,
        companyId: p.companyId as string,
        lineItems: JSON.stringify(p.lineItems),
        subtotal: p.subtotal as number,
        discountAmount: p.discountAmount as number,
        discountPercent: null,
        vatAmount: p.vatAmount as number,
        grandTotal: p.grandTotal as number,
        currency: p.currency as string,
        vatRate: p.vatRate as number,
        status: "DRAFT",
        notes: (p.notes as string | null) ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
    await copilotAudit({
      user,
      action: "CREATE",
      entity: "COMPANY",
      entityId: quotation.id,
      entityRef: quotation.refNumber,
      description: `AI created quotation ${quotation.refNumber} for ${p.companyName} (${p.grandTotal} ${p.currency})`,
      descriptionAr: `أنشأ الذكاء الاصطناعي عرض سعر ${quotation.refNumber} لـ ${p.companyName} (${p.grandTotal} ${p.currency})`,
      req,
      newValue: { grandTotal: p.grandTotal, currency: p.currency, lineItemCount: (p.lineItems as unknown[]).length },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "FINANCIAL_CREATE_QUOTATION",
      message: `Quotation ${quotation.refNumber} created (${(p.grandTotal as number).toFixed(2)} ${p.currency}).`,
      messageAr: `تم إنشاء عرض السعر ${quotation.refNumber} (${(p.grandTotal as number).toFixed(2)} ${p.currency}).`,
      results: [{ entity: "QUOTATION", id: quotation.id, refNumber: quotation.refNumber, description: `For ${p.companyName}` }],
    };
  },
};

// ─── FINANCIAL_CREATE_INVOICE ─────────────────────────────────────────────
interface CreateInvoiceInput {
  companyId: string;
  quotationId?: string;
  requestId?: string;
  sessionId?: string;
  lineItems: LineItem[];
  discountAmount?: number;
  dueDate?: string;
  bankAccountId?: string;
  notes?: string;
}
const createInvoice: ActionHandler<CreateInvoiceInput> = {
  type: "FINANCIAL_CREATE_INVOICE",
  category: "FINANCIAL",
  description: "Create an invoice from line items (or from a quotation). Captures snapshot of company + bank + VAT.",
  descriptionAr: "إنشاء فاتورة من بنود (أو من عرض سعر). يلتقط لقطة للشركة + البنك + الضريبة.",
  resolvePermission: (role) => {
    if (role === "SUPER_ADMIN" || role === "COORDINATOR") return { module: "invoices", action: "create" };
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.companyId || !input.lineItems || input.lineItems.length === 0) {
      throw new ActionError("companyId and lineItems[] are required", 422, "VALIDATION_ERROR");
    }
    const company = await db.company.findFirst({ where: { id: input.companyId, deletedAt: null } });
    if (!company) throw new ActionError("Company not found", 404, "NOT_FOUND");
    const settings = await db.financialSettings.findUnique({ where: { id: "default" } });
    if (!settings) throw new ActionError("Financial settings not configured", 400, "NO_FINANCIAL_SETTINGS");
    let bankAccount: { id: string; bankName: string; beneficiary: string; accountNumber: string; iban: string | null; swift: string | null } | null = null;
    if (input.bankAccountId) {
      bankAccount = await db.bankAccount.findFirst({ where: { id: input.bankAccountId, deletedAt: null } });
      if (!bankAccount) throw new ActionError("Bank account not found", 404, "NOT_FOUND");
    } else {
      bankAccount = await db.bankAccount.findFirst({ where: { isDefault: true, isActive: true, deletedAt: null } });
    }
    const vatRate = settings.vatRate;
    const currency = settings.currency;
    const subtotal = input.lineItems.reduce((s, l) => s + l.lineTotal, 0);
    const discountAmount = input.discountAmount ?? 0;
    const taxableBase = subtotal - discountAmount;
    const vatAmount = taxableBase * (vatRate / 100);
    const grandTotal = taxableBase + vatAmount;
    const dueDate = input.dueDate ? new Date(input.dueDate) : new Date(Date.now() + settings.defaultDueDays * 86400000);
    const snapshot = JSON.stringify({
      company: { name: company.name, crNumber: company.crNumber, vatNumber: company.vatNumber, address: company.address, phone: company.phone, email: company.email },
      bank: bankAccount ? { bankName: bankAccount.bankName, beneficiary: bankAccount.beneficiary, accountNumber: bankAccount.accountNumber, iban: bankAccount.iban, swift: bankAccount.swift } : null,
      vatRate, currency,
      provider: { name: settings.companyName, crNumber: settings.crNumber, vatNumber: settings.vatNumber, address: settings.address, phone: settings.phone, email: settings.financeEmail, logoUrl: settings.companyLogoUrl },
    });
    return {
      actionType: "FINANCIAL_CREATE_INVOICE",
      title: "Create Invoice",
      titleAr: "إنشاء الفاتورة",
      summary: `Create invoice for ${company.name}: total ${grandTotal.toFixed(2)} ${currency} (incl. VAT ${vatRate}%), due ${dueDate.toLocaleDateString()}.`,
      summaryAr: `إنشاء فاتورة لـ ${company.name}: الإجمالي ${grandTotal.toFixed(2)} ${currency} (شامل ضريبة ${vatRate}%)، الاستحقاق ${dueDate.toLocaleDateString()}.`,
      affectedRecords: [
        { entity: "COMPANY", refNumber: company.refNumber, description: company.name },
      ],
      changes: [
        { field: "subtotal", label: "Subtotal", oldValue: null, newValue: `${subtotal.toFixed(2)} ${currency}` },
        { field: "discount", label: "Discount", oldValue: null, newValue: `${discountAmount.toFixed(2)} ${currency}` },
        { field: "vat", label: "VAT", oldValue: null, newValue: `${vatAmount.toFixed(2)} ${currency}` },
        { field: "grandTotal", label: "Grand Total", oldValue: null, newValue: `${grandTotal.toFixed(2)} ${currency}` },
        { field: "dueDate", label: "Due Date", oldValue: null, newValue: dueDate.toLocaleDateString() },
      ],
      warnings: [],
      expectedResult: `Invoice will be created in DRAFT status. Use FINANCIAL_SEND_INVOICE to issue it.`,
      expectedResultAr: `سيتم إنشاء الفاتورة في حالة مسودة. استخدم إرسال الفاتورة لإصدارها.`,
      hydratedParams: {
        companyId: company.id, companyName: company.name,
        quotationId: input.quotationId ?? null, requestId: input.requestId ?? null, sessionId: input.sessionId ?? null,
        lineItems: input.lineItems, subtotal, discountAmount, vatAmount, grandTotal,
        vatRate, currency, dueDate: dueDate.toISOString(),
        bankAccountId: bankAccount?.id ?? null,
        snapshot, notes: input.notes ?? null,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const refNumber = await nextRefNumber("INVOICE");
    const invoice = await db.invoice.create({
      data: {
        refNumber,
        quotationId: (p.quotationId as string | null) ?? null,
        requestId: (p.requestId as string | null) ?? null,
        sessionId: (p.sessionId as string | null) ?? null,
        companyId: p.companyId as string,
        lineItems: JSON.stringify(p.lineItems),
        subtotal: p.subtotal as number,
        discountAmount: p.discountAmount as number,
        discountPercent: null,
        vatAmount: p.vatAmount as number,
        grandTotal: p.grandTotal as number,
        paidAmount: 0,
        outstandingBalance: p.grandTotal as number,
        currency: p.currency as string,
        vatRate: p.vatRate as number,
        status: "DRAFT",
        issueDate: new Date(),
        dueDate: new Date(p.dueDate as string),
        bankAccountId: (p.bankAccountId as string | null) ?? null,
        coordinatorNotes: (p.notes as string | null) ?? null,
        snapshot: p.snapshot as string,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
    await copilotAudit({
      user,
      action: "CREATE",
      entity: "COMPANY",
      entityId: invoice.id,
      entityRef: invoice.refNumber,
      description: `AI created invoice ${invoice.refNumber} for ${p.companyName} (${(p.grandTotal as number).toFixed(2)} ${p.currency})`,
      descriptionAr: `أنشأ الذكاء الاصطناعي الفاتورة ${invoice.refNumber} لـ ${p.companyName} (${(p.grandTotal as number).toFixed(2)} ${p.currency})`,
      req,
      newValue: { grandTotal: p.grandTotal, currency: p.currency },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "FINANCIAL_CREATE_INVOICE",
      message: `Invoice ${invoice.refNumber} created (${(p.grandTotal as number).toFixed(2)} ${p.currency}).`,
      messageAr: `تم إنشاء الفاتورة ${invoice.refNumber} (${(p.grandTotal as number).toFixed(2)} ${p.currency}).`,
      results: [{ entity: "INVOICE", id: invoice.id, refNumber: invoice.refNumber, description: `For ${p.companyName}` }],
    };
  },
};

// ─── FINANCIAL_SEND_INVOICE ───────────────────────────────────────────────
interface SendInvoiceInput { invoiceId: string; }
const sendInvoice: ActionHandler<SendInvoiceInput> = {
  type: "FINANCIAL_SEND_INVOICE",
  category: "FINANCIAL",
  description: "Issue an invoice (transition DRAFT → ISSUED → PENDING_PAYMENT) and notify the contractor.",
  descriptionAr: "إصدار فاتورة (تحويل المسودة → مُصدَرة → بانتظار الدفع) وإشعار المقاول.",
  resolvePermission: (role) => {
    if (role === "SUPER_ADMIN" || role === "COORDINATOR") return { module: "invoices", action: "edit" };
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.invoiceId) throw new ActionError("invoiceId is required", 422, "VALIDATION_ERROR");
    const invoice = await db.invoice.findFirst({
      where: { id: input.invoiceId, deletedAt: null },
      include: { company: { select: { name: true, refNumber: true, email: true } } },
    });
    if (!invoice) throw new ActionError("Invoice not found", 404, "NOT_FOUND");
    if (invoice.status !== "DRAFT") {
      throw new ActionError(`Invoice is already ${invoice.status} (only DRAFT can be sent)`, 400, "INVALID_STATUS");
    }
    return {
      actionType: "FINANCIAL_SEND_INVOICE",
      title: "Send Invoice",
      titleAr: "إرسال الفاتورة",
      summary: `Issue invoice ${invoice.refNumber} to ${invoice.company.name} (${invoice.grandTotal.toFixed(2)} ${invoice.currency}).`,
      summaryAr: `إصدار الفاتورة ${invoice.refNumber} إلى ${invoice.company.name} (${invoice.grandTotal.toFixed(2)} ${invoice.currency}).`,
      affectedRecords: [
        { entity: "INVOICE", refNumber: invoice.refNumber, description: `${invoice.company.name} — ${invoice.grandTotal.toFixed(2)} ${invoice.currency}` },
      ],
      changes: [
        { field: "status", label: "Status", oldValue: invoice.status, newValue: "PENDING_PAYMENT" },
        { field: "issueDate", label: "Issue Date", oldValue: null, newValue: new Date().toLocaleDateString() },
      ],
      warnings: [],
      expectedResult: `Invoice will transition to PENDING_PAYMENT and the contractor will be notified.`,
      expectedResultAr: `ستنتقل الفاتورة إلى بانتظار الدفع وسيتم إشعار المقاول.`,
      hydratedParams: {
        invoiceId: invoice.id, invoiceRef: invoice.refNumber,
        companyId: invoice.companyId, companyName: invoice.company.name,
        grandTotal: invoice.grandTotal, currency: invoice.currency,
        companyEmail: invoice.company.email,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const updated = await db.invoice.update({
      where: { id: p.invoiceId as string },
      data: { status: "PENDING_PAYMENT", issueDate: new Date(), updatedBy: user.id },
    });
    // Find contractor users for this company and notify them
    const contractorUsers = await db.user.findMany({
      where: { companyId: p.companyId as string, role: "CONTRACTOR", deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (contractorUsers.length > 0) {
      await db.notification.createMany({
        data: contractorUsers.map((u) => ({
          userId: u.id,
          title: `Invoice ${p.invoiceRef} issued`,
          titleAr: `تم إصدار الفاتورة ${p.invoiceRef}`,
          message: `Invoice ${p.invoiceRef} for ${(p.grandTotal as number).toFixed(2)} ${p.currency} is now pending payment.`,
          messageAr: `الفاتورة ${p.invoiceRef} بقيمة ${(p.grandTotal as number).toFixed(2)} ${p.currency} بانتظار الدفع.`,
          type: "INFO",
          category: "SYSTEM",
          channels: JSON.stringify(["in_app", "email"]),
          emailSentAt: new Date(),
        })),
      });
    }
    await copilotAudit({
      user,
      action: "ISSUE",
      entity: "COMPANY",
      entityId: updated.id,
      entityRef: updated.refNumber,
      description: `AI sent invoice ${updated.refNumber} to ${p.companyName}`,
      descriptionAr: `أرسل الذكاء الاصطناعي الفاتورة ${updated.refNumber} إلى ${p.companyName}`,
      req,
      oldValue: { status: "DRAFT" },
      newValue: { status: "PENDING_PAYMENT", notifiedUsers: contractorUsers.length },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "FINANCIAL_SEND_INVOICE",
      message: `Invoice ${updated.refNumber} sent to ${p.companyName}. ${contractorUsers.length} user(s) notified.`,
      messageAr: `تم إرسال الفاتورة ${updated.refNumber} إلى ${p.companyName}. تم إشعار ${contractorUsers.length} مستخدم.`,
      results: [],
    };
  },
};

// ─── FINANCIAL_REGISTER_PAYMENT ───────────────────────────────────────────
interface RegisterPaymentInput {
  invoiceId: string;
  amount: number;
  method: string; // BANK_TRANSFER | CASH | etc.
  referenceNumber?: string;
  paidBy?: string;
  notes?: string;
  bankAccountId?: string;
}
const registerPayment: ActionHandler<RegisterPaymentInput> = {
  type: "FINANCIAL_REGISTER_PAYMENT",
  category: "FINANCIAL",
  description: "Register a payment against an invoice (status PENDING — coordinator must approve via FINANCIAL_APPROVE_PAYMENT).",
  descriptionAr: "تسجيل دفعة ضد فاتورة (الحالة بانتظار — يجب أن يعتمدها المنسق عبر اعتماد الدفعة).",
  resolvePermission: (role) => {
    if (role === "SUPER_ADMIN" || role === "COORDINATOR") return { module: "payments", action: "create" };
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.invoiceId || input.amount === undefined || !input.method) {
      throw new ActionError("invoiceId, amount, method are required", 422, "VALIDATION_ERROR");
    }
    if (input.amount <= 0) throw new ActionError("amount must be positive", 422, "VALIDATION_ERROR");
    const invoice = await db.invoice.findFirst({
      where: { id: input.invoiceId, deletedAt: null },
      include: { company: { select: { name: true, refNumber: true } } },
    });
    if (!invoice) throw new ActionError("Invoice not found", 404, "NOT_FOUND");
    if (invoice.outstandingBalance <= 0) {
      throw new ActionError("Invoice has no outstanding balance", 400, "ALREADY_PAID");
    }
    if (input.amount > invoice.outstandingBalance + 0.01) {
      throw new ActionError(`Amount ${input.amount} exceeds outstanding balance ${invoice.outstandingBalance}`, 400, "OVERPAYMENT");
    }
    return {
      actionType: "FINANCIAL_REGISTER_PAYMENT",
      title: "Register Payment",
      titleAr: "تسجيل الدفعة",
      summary: `Register ${input.amount.toFixed(2)} ${invoice.currency} payment for invoice ${invoice.refNumber} (${invoice.company.name}). Status: PENDING (awaiting approval).`,
      summaryAr: `تسجيل دفعة ${input.amount.toFixed(2)} ${invoice.currency} للفاتورة ${invoice.refNumber} (${invoice.company.name}). الحالة: بانتظار (بانتظار الاعتماد).`,
      affectedRecords: [
        { entity: "INVOICE", refNumber: invoice.refNumber, description: `${invoice.company.name} — Outstanding: ${invoice.outstandingBalance.toFixed(2)} ${invoice.currency}` },
      ],
      changes: [
        { field: "amount", label: "Payment Amount", oldValue: 0, newValue: `${input.amount.toFixed(2)} ${invoice.currency}` },
        { field: "method", label: "Method", oldValue: null, newValue: input.method },
        { field: "referenceNumber", label: "Reference", oldValue: null, newValue: input.referenceNumber ?? "—" },
        { field: "status", label: "Status", oldValue: null, newValue: "PENDING" },
      ],
      warnings: [],
      expectedResult: `Payment will be created in PENDING status. Coordinator must approve to apply it to the invoice.`,
      expectedResultAr: `سيتم إنشاء الدفعة في حالة بانتظار. يجب على المنسق اعتمادها لتطبيقها على الفاتورة.`,
      hydratedParams: {
        invoiceId: invoice.id, invoiceRef: invoice.refNumber,
        companyId: invoice.companyId, companyName: invoice.company.name,
        amount: input.amount, currency: invoice.currency,
        method: input.method, referenceNumber: input.referenceNumber ?? null,
        paidBy: input.paidBy ?? null, notes: input.notes ?? null,
        bankAccountId: input.bankAccountId ?? null,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const refNumber = await nextRefNumber("PAYMENT");
    const payment = await db.payment.create({
      data: {
        refNumber,
        invoiceId: p.invoiceId as string,
        companyId: p.companyId as string,
        amount: p.amount as number,
        currency: p.currency as string,
        method: p.method as string,
        status: "PENDING",
        referenceNumber: (p.referenceNumber as string | null) ?? null,
        paidBy: (p.paidBy as string | null) ?? null,
        bankAccountId: (p.bankAccountId as string | null) ?? null,
        notes: (p.notes as string | null) ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
    await copilotAudit({
      user,
      action: "CREATE",
      entity: "COMPANY",
      entityId: payment.id,
      entityRef: payment.refNumber,
      description: `AI registered payment ${payment.refNumber} (${(p.amount as number).toFixed(2)} ${p.currency}) for invoice ${p.invoiceRef}`,
      descriptionAr: `سجّل الذكاء الاصطناعي دفعة ${payment.refNumber} (${(p.amount as number).toFixed(2)} ${p.currency}) للفاتورة ${p.invoiceRef}`,
      req,
      newValue: { amount: p.amount, currency: p.currency, method: p.method, status: "PENDING" },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "FINANCIAL_REGISTER_PAYMENT",
      message: `Payment ${payment.refNumber} registered (${(p.amount as number).toFixed(2)} ${p.currency}). Awaiting approval.`,
      messageAr: `تم تسجيل الدفعة ${payment.refNumber} (${(p.amount as number).toFixed(2)} ${p.currency}). بانتظار الاعتماد.`,
      results: [{ entity: "PAYMENT", id: payment.id, refNumber: payment.refNumber, description: `${(p.amount as number).toFixed(2)} ${p.currency} for ${p.invoiceRef}` }],
    };
  },
};

// ─── FINANCIAL_APPROVE_PAYMENT ────────────────────────────────────────────
interface ApprovePaymentInput { paymentId: string; }
const approvePayment: ActionHandler<ApprovePaymentInput> = {
  type: "FINANCIAL_APPROVE_PAYMENT",
  category: "FINANCIAL",
  description: "Approve a PENDING payment — applies it to the linked invoice (updates paidAmount + outstandingBalance), re-evaluates invoice status, auto-generates a receipt if invoice becomes PAID.",
  descriptionAr: "اعتماد دفعة بانتظار — تطبيقها على الفاتورة المرتبطة (تحديث المبلغ المدفوع + الرصيد المتبقي)، إعادة تقييم حالة الفاتورة، إنشاء إيصال تلقائي عند اكتمال الدفع.",
  resolvePermission: (role) => {
    if (role === "SUPER_ADMIN" || role === "COORDINATOR") return { module: "payments", action: "edit" };
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.paymentId) throw new ActionError("paymentId is required", 422, "VALIDATION_ERROR");
    const payment = await db.payment.findFirst({
      where: { id: input.paymentId, deletedAt: null },
      include: { invoice: { select: { refNumber: true, outstandingBalance: true, paidAmount: true, grandTotal: true, status: true, currency: true, companyId: true } }, company: { select: { name: true } } },
    });
    if (!payment) throw new ActionError("Payment not found", 404, "NOT_FOUND");
    if (payment.status !== "PENDING") {
      throw new ActionError(`Payment is already ${payment.status} (only PENDING can be approved)`, 400, "INVALID_STATUS");
    }
    if (!payment.invoice) throw new ActionError("Payment has no linked invoice", 400, "NO_INVOICE");
    const newPaidAmount = payment.invoice.paidAmount + payment.amount;
    const newOutstanding = Math.max(0, payment.invoice.grandTotal - newPaidAmount);
    const newInvoiceStatus = newOutstanding <= 0.01 ? "PAID" : "PARTIALLY_PAID";
    return {
      actionType: "FINANCIAL_APPROVE_PAYMENT",
      title: "Approve Payment",
      titleAr: "اعتماد الدفعة",
      summary: `Approve payment ${payment.refNumber} (${payment.amount.toFixed(2)} ${payment.currency}) for invoice ${payment.invoice.refNumber}. Invoice will become ${newInvoiceStatus}.`,
      summaryAr: `اعتماد الدفعة ${payment.refNumber} (${payment.amount.toFixed(2)} ${payment.currency}) للفاتورة ${payment.invoice.refNumber}. ستصبح الفاتورة ${newInvoiceStatus}.`,
      affectedRecords: [
        { entity: "PAYMENT", refNumber: payment.refNumber, description: `${payment.amount.toFixed(2)} ${payment.currency}` },
        { entity: "INVOICE", refNumber: payment.invoice.refNumber, description: `${payment.invoice.refNumber} — ${newInvoiceStatus}` },
      ],
      changes: [
        { field: "paymentStatus", label: "Payment Status", oldValue: payment.status, newValue: "PAID" },
        { field: "invoicePaid", label: "Invoice Paid Amount", oldValue: `${payment.invoice.paidAmount.toFixed(2)} ${payment.invoice.currency}`, newValue: `${newPaidAmount.toFixed(2)} ${payment.invoice.currency}` },
        { field: "invoiceOutstanding", label: "Invoice Outstanding", oldValue: `${payment.invoice.outstandingBalance.toFixed(2)} ${payment.invoice.currency}`, newValue: `${newOutstanding.toFixed(2)} ${payment.invoice.currency}` },
        { field: "invoiceStatus", label: "Invoice Status", oldValue: payment.invoice.status, newValue: newInvoiceStatus },
      ],
      warnings: [],
      expectedResult: `Payment will be PAID. Invoice will be ${newInvoiceStatus}${newInvoiceStatus === "PAID" ? " and a receipt will be auto-generated." : "."}`,
      expectedResultAr: `ستصبح الدفعة مدفوعة. ستصبح الفاتورة ${newInvoiceStatus}${newInvoiceStatus === "PAID" ? " وسيتم إنشاء إيصال تلقائياً." : "."}`,
      hydratedParams: {
        paymentId: payment.id, paymentRef: payment.refNumber,
        invoiceId: payment.invoiceId, invoiceRef: payment.invoice.refNumber,
        companyId: payment.companyId, companyName: payment.company.name,
        amount: payment.amount, currency: payment.currency,
        newPaidAmount, newOutstanding, newInvoiceStatus,
        paymentMethod: payment.method, paidBy: payment.paidBy, referenceNumber: payment.referenceNumber,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    let receiptRef: string | null = null;
    await db.$transaction(async (tx) => {
      // Mark payment PAID
      await tx.payment.update({
        where: { id: p.paymentId as string },
        data: { status: "PAID", paymentDate: new Date(), updatedBy: user.id },
      });
      // Apply to invoice
      await tx.invoice.update({
        where: { id: p.invoiceId as string },
        data: {
          paidAmount: p.newPaidAmount as number,
          outstandingBalance: p.newOutstanding as number,
          status: p.newInvoiceStatus as string,
          paidDate: p.newInvoiceStatus === "PAID" ? new Date() : null,
          updatedBy: user.id,
        },
      });
      // Auto-generate receipt if PAID
      if (p.newInvoiceStatus === "PAID") {
        const refNumber = await nextRefNumber("RECEIPT", tx);
        const receipt = await tx.receipt.create({
          data: {
            refNumber,
            paymentId: p.paymentId as string,
            invoiceId: p.invoiceId as string,
            companyId: p.companyId as string,
            amount: p.amount as number,
            currency: p.currency as string,
            receiptDate: new Date(),
            paymentMethod: (p.paymentMethod as string | null) ?? null,
            paidBy: (p.paidBy as string | null) ?? null,
            referenceNumber: (p.referenceNumber as string | null) ?? null,
            status: "ISSUED",
            createdBy: user.id,
            updatedBy: user.id,
          },
        });
        receiptRef = receipt.refNumber;
      }
    });
    await copilotAudit({
      user,
      action: "APPROVE",
      entity: "COMPANY",
      entityId: p.paymentId as string,
      entityRef: p.paymentRef as string,
      description: `AI approved payment ${p.paymentRef} (${(p.amount as number).toFixed(2)} ${p.currency}) — invoice ${p.invoiceRef} now ${p.newInvoiceStatus}${receiptRef ? `, receipt ${receiptRef}` : ""}`,
      descriptionAr: `اعتمد الذكاء الاصطناعي الدفعة ${p.paymentRef} (${(p.amount as number).toFixed(2)} ${p.currency}) — الفاتورة ${p.invoiceRef} الآن ${p.newInvoiceStatus}${receiptRef ? `، الإيصال ${receiptRef}` : ""}`,
      req,
      oldValue: { paymentStatus: "PENDING", invoiceStatus: "PARTIALLY_PAID" },
      newValue: { paymentStatus: "PAID", invoiceStatus: p.newInvoiceStatus, receiptRef },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "FINANCIAL_APPROVE_PAYMENT",
      message: `Payment ${p.paymentRef} approved. Invoice ${p.invoiceRef} is now ${p.newInvoiceStatus}.${receiptRef ? ` Receipt ${receiptRef} generated.` : ""}`,
      messageAr: `تم اعتماد الدفعة ${p.paymentRef}. الفاتورة ${p.invoiceRef} الآن ${p.newInvoiceStatus}.${receiptRef ? ` تم إنشاء الإيصال ${receiptRef}.` : ""}`,
      results: receiptRef
        ? [{ entity: "RECEIPT", refNumber: receiptRef, description: `For ${p.invoiceRef}` }]
        : [],
    };
  },
};

// ─── FINANCIAL_GENERATE_RECEIPT ───────────────────────────────────────────
interface GenerateReceiptInput { paymentId: string; }
const generateReceipt: ActionHandler<GenerateReceiptInput> = {
  type: "FINANCIAL_GENERATE_RECEIPT",
  category: "FINANCIAL",
  description: "Manually generate a receipt for a PAID payment (if one wasn't auto-generated).",
  descriptionAr: "إنشاء إيصال يدوياً لدفعة مدفوعة (إذا لم يُنشأ تلقائياً).",
  resolvePermission: (role) => {
    if (role === "SUPER_ADMIN" || role === "COORDINATOR") return { module: "receipts", action: "create" };
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.paymentId) throw new ActionError("paymentId is required", 422, "VALIDATION_ERROR");
    const payment = await db.payment.findFirst({
      where: { id: input.paymentId, deletedAt: null },
      include: { invoice: { select: { refNumber: true } }, company: { select: { name: true } }, receipts: { where: { deletedAt: null }, select: { id: true, refNumber: true } } },
    });
    if (!payment) throw new ActionError("Payment not found", 404, "NOT_FOUND");
    if (payment.status !== "PAID") throw new ActionError("Payment must be PAID first", 400, "INVALID_STATUS");
    if (payment.receipts.length > 0) {
      throw new ActionError(`Receipt already exists: ${payment.receipts[0].refNumber}`, 400, "RECEIPT_EXISTS");
    }
    return {
      actionType: "FINANCIAL_GENERATE_RECEIPT",
      title: "Generate Receipt",
      titleAr: "إنشاء الإيصال",
      summary: `Generate receipt for payment ${payment.refNumber} (${payment.amount.toFixed(2)} ${payment.currency}) to ${payment.company.name}.`,
      summaryAr: `إنشاء إيصال للدفعة ${payment.refNumber} (${payment.amount.toFixed(2)} ${payment.currency}) لـ ${payment.company.name}.`,
      affectedRecords: [
        { entity: "PAYMENT", refNumber: payment.refNumber, description: `${payment.amount.toFixed(2)} ${payment.currency}` },
        { entity: "INVOICE", refNumber: payment.invoice?.refNumber, description: payment.invoice?.refNumber ?? "" },
      ],
      changes: [
        { field: "amount", label: "Amount", oldValue: null, newValue: `${payment.amount.toFixed(2)} ${payment.currency}` },
        { field: "method", label: "Method", oldValue: null, newValue: payment.method },
      ],
      warnings: [],
      expectedResult: `Receipt will be created with ref RCP-YYYY-NNNNNN.`,
      expectedResultAr: `سيتم إنشاء الإيصال بمرجع RCP-YYYY-NNNNNN.`,
      hydratedParams: {
        paymentId: payment.id, paymentRef: payment.refNumber,
        invoiceId: payment.invoiceId, invoiceRef: payment.invoice?.refNumber,
        companyId: payment.companyId, companyName: payment.company.name,
        amount: payment.amount, currency: payment.currency,
        paymentMethod: payment.method, paidBy: payment.paidBy, referenceNumber: payment.referenceNumber,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const refNumber = await nextRefNumber("RECEIPT");
    const receipt = await db.receipt.create({
      data: {
        refNumber,
        paymentId: p.paymentId as string,
        invoiceId: (p.invoiceId as string | null) ?? null,
        companyId: p.companyId as string,
        amount: p.amount as number,
        currency: p.currency as string,
        receiptDate: new Date(),
        paymentMethod: (p.paymentMethod as string | null) ?? null,
        paidBy: (p.paidBy as string | null) ?? null,
        referenceNumber: (p.referenceNumber as string | null) ?? null,
        status: "ISSUED",
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
    await copilotAudit({
      user,
      action: "ISSUE",
      entity: "COMPANY",
      entityId: receipt.id,
      entityRef: receipt.refNumber,
      description: `AI generated receipt ${receipt.refNumber} for payment ${p.paymentRef}`,
      descriptionAr: `أنشأ الذكاء الاصطناعي الإيصال ${receipt.refNumber} للدفعة ${p.paymentRef}`,
      req,
      newValue: { amount: p.amount, currency: p.currency },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "FINANCIAL_GENERATE_RECEIPT",
      message: `Receipt ${receipt.refNumber} generated.`,
      messageAr: `تم إنشاء الإيصال ${receipt.refNumber}.`,
      results: [{ entity: "RECEIPT", id: receipt.id, refNumber: receipt.refNumber, description: `For ${p.companyName}` }],
    };
  },
};

export const financialActions: ActionHandler<any>[] = [
  createQuotation, createInvoice, sendInvoice,
  registerPayment, approvePayment, generateReceipt,
];
