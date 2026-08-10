// /api/company-contacts — list + create
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["fullName", "createdAt", "updatedAt", "isPrimary", "isActive"];

// Keep at most one primary contact per company.
async function enforceSinglePrimary(companyId: string, keepId: string | null, tx: Prisma.TransactionClient) {
  if (keepId) {
    await tx.companyContact.updateMany({
      where: { companyId, id: { not: keepId }, deletedAt: null },
      data: { isPrimary: false },
    });
  }
}

export const GET = withModuleAction("company-contacts", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { fullName: { contains: q.search } },
      { fullNameAr: { contains: q.search } },
      { email: { contains: q.search } },
      { jobTitle: { contains: q.search } },
    ];
  }
  if (q.filters.companyId) where.companyId = q.filters.companyId;
  if (q.filters.isActive) where.isActive = q.filters.isActive === "true";

  if (user.role === "CONTRACTOR" && user.companyId) {
    where.companyId = user.companyId;
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.companyContact.findMany({
      where,
      include: { company: { select: { id: true, name: true, nameAr: true, refNumber: true } } },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.companyContact.count({ where }),
  ]);

  return list(
    rows.map((c) => ({
      id: c.id,
      companyId: c.companyId,
      companyName: c.company?.name ?? null,
      companyNameAr: c.company?.nameAr ?? null,
      companyRef: c.company?.refNumber ?? null,
      fullName: c.fullName,
      fullNameAr: c.fullNameAr,
      jobTitle: c.jobTitle,
      email: c.email,
      phone: c.phone,
      mobile: c.mobile,
      contactType: c.contactType,
      preferredContact: c.preferredContact,
      isPrimary: c.isPrimary,
      isActive: c.isActive,
      notes: c.notes,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("company-contacts", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { companyId, fullName, fullNameAr, jobTitle, email, phone, mobile, contactType, preferredContact, isPrimary, isActive, notes } = body;
  if (!companyId || !fullName) return fail("companyId and fullName are required", 422, "VALIDATION_ERROR");

  const company = await db.company.findFirst({ where: { id: companyId, deletedAt: null } });
  if (!company) return fail("Company not found", 404);

  const contact = await db.$transaction(async (tx) => {
    const created = await tx.companyContact.create({
      data: {
        companyId,
        fullName,
        fullNameAr: fullNameAr ?? null,
        jobTitle: jobTitle ?? null,
        email: email ?? null,
        phone: phone ?? null,
        mobile: mobile ?? null,
        contactType: contactType ?? null, // OPERATIONS | HR | ADMIN | PAYROLL | QUALITY | OTHER
        preferredContact: preferredContact ?? null, // PHONE | MOBILE | EMAIL | WHATSAPP
        isPrimary: isPrimary ?? false,
        isActive: isActive ?? true,
        notes: notes ?? null,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
    if (created.isPrimary) {
      await enforceSinglePrimary(companyId, created.id, tx);
    }
    return created;
  });

  await audit({
    user,
    action: "CREATE",
    entity: "COMPANY",
    entityId: companyId,
    entityRef: company.refNumber,
    description: `Created contact: ${contact.fullName} for ${company.name}`,
    descriptionAr: `تم إنشاء جهة اتصال: ${contact.fullName} لـ ${company.name}`,
    req,
  });

  return created(contact);
});
