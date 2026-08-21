// /api/quotations — list + create quotations
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit, companyScope } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { nextRefNumber } from "@/lib/api/ref-number";

const ALLOWED_SORT_FIELDS = ["refNumber", "issueDate", "grandTotal", "status", "createdAt"];

export const GET = withModuleAction("quotations", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.companyId) where.companyId = q.filters.companyId;
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
    db.quotation.findMany({
      where, orderBy, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
      include: { company: { select: { id: true, name: true, refNumber: true } }, request: { select: { id: true, refNumber: true } } },
    }),
    db.quotation.count({ where }),
  ]);
  return list(rows, buildListMeta(total, q));
});

export const POST = withModuleAction("quotations", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { requestId, companyId, lineItems, subtotal, discountAmount, discountPercent, vatRate, currency, validUntil, notes, termsConditions, status } = body;
  if (!companyId || !lineItems) return fail("companyId and lineItems are required", 422, "VALIDATION_ERROR");

  let settings = await db.financialSettings.findUnique({ where: { id: "default" } });
  if (!settings) settings = await db.financialSettings.create({ data: { id: "default" } });

  const effVatRate = vatRate ?? settings.vatRate;
  const effSubtotal = parseFloat(subtotal) || 0;
  const effDiscount = parseFloat(discountAmount) || 0;
  const afterDisc = effSubtotal - effDiscount;
  const vatAmount = afterDisc * (effVatRate / 100);
  const grandTotal = afterDisc + vatAmount;

  const snapshot = JSON.stringify({
    company: { name: settings.companyName, crNumber: settings.crNumber, vatNumber: settings.vatNumber, address: settings.address, phone: settings.phone, email: settings.financeEmail },
    vatRate: effVatRate, currency: currency ?? settings.currency,
  });

  const refNumber = await nextRefNumber("QUOTATION");
  const quotation = await db.quotation.create({
    data: {
      refNumber, requestId: requestId ?? null, companyId,
      lineItems: typeof lineItems === "string" ? lineItems : JSON.stringify(lineItems),
      subtotal: effSubtotal, discountAmount: effDiscount,
      discountPercent: discountPercent ? parseFloat(discountPercent) : null,
      vatAmount, grandTotal, currency: currency ?? settings.currency, vatRate: effVatRate,


      createdBy: user.id, updatedBy: user.id,
    },
  });

  await audit({ user, action: "CREATE", entity: "SETTING", entityId: quotation.id, description: `Created quotation ${refNumber}`, req, metadata: { action: "QUOTATION_CREATED" } });
  return created(quotation);
});
