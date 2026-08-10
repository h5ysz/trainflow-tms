// /api/sessions/[id]/payments — manage session payment records
// =====================================================================
// GET  — list all payment records for the session (optionally filtered by company)
// POST — create or update a payment record (upsert by sessionId+companyId)
//
// Body for POST: {
//   companyId: string,
//   totalAmount: number,
//   paidAmount?: number,         // default 0
//   currency?: string,           // default "SAR"
//   invoiceRef?: string,
//   invoiceIssuedAt?: string,    // ISO date
//   invoiceDueDate?: string,     // ISO date
//   notes?: string,
// }
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { autoUpdateReleaseStatus } from "@/lib/certificates/release-checklist";
import { randomUUID } from "node:crypto";

// Enrich payment rows with derived values + per-company trainee count + the
// names of the users who verified / released printing.
async function enrichPayments(payments: Array<{
  sessionId: string;
  companyId: string;
  totalAmount: number;
  paidAmount: number;
  verifiedBy?: string | null;
  printingReleasedBy?: string | null;
  session?: { refNumber: string } | null;
}>) {
  const sessionIds = [...new Set(payments.map((p) => p.sessionId))];
  const companies = await db.sessionCompany.findMany({ where: { sessionId: { in: sessionIds } } });
  const userIds = [
    ...new Set(payments.flatMap((p) => [p.verifiedBy, p.printingReleasedBy]).filter(Boolean)),
  ] as string[];
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } })
    : [];
  const userMap = new Map(users.map((u) => [u.id, u.fullName]));
  const countMap = new Map(companies.map((c) => [`${c.sessionId}:${c.companyId}`, c.traineeCount]));

  return payments.map((p) => {
    const remaining = Math.max(0, p.totalAmount - p.paidAmount);
    const pct = p.totalAmount > 0 ? Math.round((p.paidAmount / p.totalAmount) * 100) : (p.paidAmount > 0 ? 100 : 0);
    const status = remaining <= 0.01 ? "PAID" : p.paidAmount > 0 ? "PARTIALLY_PAID" : "UNPAID";
    return {
      ...p,
      sessionRef: p.session?.refNumber ?? null,
      traineeCount: countMap.get(`${p.sessionId}:${p.companyId}`) ?? 0,
      verifiedByName: p.verifiedBy ? (userMap.get(p.verifiedBy) ?? p.verifiedBy) : null,
      printingReleasedByName: p.printingReleasedBy ? (userMap.get(p.printingReleasedBy) ?? p.printingReleasedBy) : null,
      remainingBalance: remaining,
      paymentPercentage: pct,
      paymentStatus: status,
    };
  });
}

export const GET = withModuleAction("sessions", "view", async ({ req, params }) => {
  const sessionId = params.id as string;
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");

  const where: Record<string, unknown> = { sessionId, deletedAt: null };
  if (companyId) where.companyId = companyId;

  const payments = await db.sessionPayment.findMany({
    where,
    include: {
      company: { select: { id: true, name: true, refNumber: true } },
      session: { select: { refNumber: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return ok(await enrichPayments(payments));
});

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const sessionId = params.id as string;
  const body = await req.json().catch(() => ({}));
  const {
    companyId, totalAmount, paidAmount, currency, invoiceRef,
    invoiceIssuedAt, invoiceDueDate, notes,
  } = body as {
    companyId?: string;
    totalAmount?: number;
    paidAmount?: number;
    currency?: string;
    invoiceRef?: string;
    invoiceIssuedAt?: string;
    invoiceDueDate?: string;
    notes?: string;
  };

  if (!companyId) return fail("companyId is required", 422, "VALIDATION_ERROR");
  if (totalAmount === undefined || totalAmount < 0) return fail("totalAmount must be >= 0", 422, "VALIDATION_ERROR");
  if ((paidAmount ?? 0) < 0) return fail("paidAmount must be >= 0", 422, "VALIDATION_ERROR");
  if ((paidAmount ?? 0) > totalAmount) return fail("paidAmount cannot exceed totalAmount", 422, "VALIDATION_ERROR");

  // Verify session + company exist
  const [session, company] = await Promise.all([
    db.trainingSession.findFirst({ where: { id: sessionId, deletedAt: null }, select: { id: true, refNumber: true } }),
    db.company.findFirst({ where: { id: companyId, deletedAt: null }, select: { id: true, name: true } }),
  ]);
  if (!session) return fail("Session not found", 404, "NOT_FOUND");
  if (!company) return fail("Company not found", 404, "NOT_FOUND");

  // Payment records are a coordinator/admin responsibility. Same hard gate as
  // the verify + release-printing routes so trainers cannot alter amounts.
  if (user.role !== "COORDINATOR" && user.role !== "SUPER_ADMIN") {
    return fail("Only coordinators can manage payment records", 403, "FORBIDDEN");
  }

  // Upsert payment record
  const existing = await db.sessionPayment.findUnique({
    where: { sessionId_companyId: { sessionId, companyId } },
  });

  const wasPaid = existing ? existing.paidAmount : 0;
  const isNowPaid = (paidAmount ?? 0) >= totalAmount - 0.01;

  // Derive the verification status from the amounts exactly like the receipt
  // verify route does: a record created as fully paid is immediately VERIFIED
  // (verifiedBy/verifiedAt stamped), which lets the coordinator proceed to the
  // release-printing gate without an intermediate receipt-verification round.
  const nextVerificationStatus = isNowPaid ? "VERIFIED" : (paidAmount ?? 0) > 0 ? "PARTIALLY_VERIFIED" : "PENDING";

  const payment = await db.sessionPayment.upsert({
    where: { sessionId_companyId: { sessionId, companyId } },
    update: {
      totalAmount,
      paidAmount: paidAmount ?? 0,
      currency: currency ?? existing?.currency ?? "SAR",
      invoiceRef: invoiceRef ?? existing?.invoiceRef ?? null,
      invoiceIssuedAt: invoiceIssuedAt ? new Date(invoiceIssuedAt) : existing?.invoiceIssuedAt ?? null,
      invoiceDueDate: invoiceDueDate ? new Date(invoiceDueDate) : existing?.invoiceDueDate ?? null,
      notes: notes ?? existing?.notes ?? null,
      verificationStatus: nextVerificationStatus,
      ...(isNowPaid
        ? { verifiedBy: user.id, verifiedAt: new Date() }
        : { verifiedBy: null, verifiedAt: null }),
      updatedBy: user.id,
    },
    create: {
      id: randomUUID(),
      sessionId,
      companyId,
      totalAmount,
      paidAmount: paidAmount ?? 0,
      currency: currency ?? "SAR",
      invoiceRef: invoiceRef ?? null,
      invoiceIssuedAt: invoiceIssuedAt ? new Date(invoiceIssuedAt) : null,
      invoiceDueDate: invoiceDueDate ? new Date(invoiceDueDate) : null,
      notes: notes ?? null,
      verificationStatus: nextVerificationStatus,
      ...(isNowPaid
        ? { verifiedBy: user.id, verifiedAt: new Date() }
        : { verifiedBy: null, verifiedAt: null }),
      createdBy: user.id,
      updatedBy: user.id,
      updatedAt: new Date(),
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "SESSION",
    entityId: session.id,
    entityRef: session.refNumber,
    description: `Updated payment for ${company.name}: ${paidAmount ?? 0} / ${totalAmount} ${payment.currency}`,
    descriptionAr: `تحديث الدفعة لـ ${company.name}: ${paidAmount ?? 0} / ${totalAmount} ${payment.currency}`,
    req,
    metadata: {
      aiGenerated: false,
      sessionPayment: true,
      companyId,
      companyName: company.name,
      oldValue: existing ? { totalAmount: existing.totalAmount, paidAmount: existing.paidAmount } : null,
      newValue: { totalAmount, paidAmount: paidAmount ?? 0, currency: payment.currency, fullyPaid: isNowPaid },
    },
  });

  // Auto-update release status for all certificates in this session+company
  const certs = await db.certificate.findMany({
    where: { sessionId, companyId, deletedAt: null },
    select: { id: true },
  });
  for (const c of certs) {
    await autoUpdateReleaseStatus(c.id);
  }

  const remaining = Math.max(0, payment.totalAmount - payment.paidAmount);
  const pct = payment.totalAmount > 0 ? Math.round((payment.paidAmount / payment.totalAmount) * 100) : 0;
  const status = remaining <= 0.01 ? "PAID" : payment.paidAmount > 0 ? "PARTIALLY_PAID" : "UNPAID";

  const enriched = await enrichPayments([
    {
      sessionId: payment.sessionId,
      companyId: payment.companyId,
      totalAmount: payment.totalAmount,
      paidAmount: payment.paidAmount,
      verifiedBy: payment.verifiedBy,
      printingReleasedBy: payment.printingReleasedBy,
      session: { refNumber: session.refNumber },
    },
  ]);

  return ok({
    ...payment,
    ...enriched[0],
    paymentStatus: status,
    certificatesChecked: certs.length,
  });
});
