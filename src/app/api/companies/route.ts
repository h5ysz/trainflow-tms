// /api/companies — list + create
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";

export const GET = withModuleAction("companies", "view", async ({ req, user }) => {
  const params = parseListParams(req);
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { name: { contains: params.search } },
      { legalName: { contains: params.search } },
      { email: { contains: params.search } },
      { crNumber: { contains: params.search } },
    ];
  }
  if (params.status) where.status = params.status;

  // Contractors only see their own company
  if (user.role === "CONTRACTOR" && user.companyId) {
    where.id = user.companyId;
  }

  const [rows, total] = await Promise.all([
    db.company.findMany({
      where,
      include: {
        _count: { select: { contacts: true, trainingRequests: true, users: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.company.count({ where }),
  ]);

  return ok(
    listResponse(
      rows.map((c) => ({
        id: c.id,
        name: c.name,
        nameAr: c.nameAr,
        legalName: c.legalName,
        crNumber: c.crNumber,
        vatNumber: c.vatNumber,
        industry: c.industry,
        country: c.country,
        city: c.city,
        address: c.address,
        postalCode: c.postalCode,
        phone: c.phone,
        email: c.email,
        website: c.website,
        contactPerson: c.contactPerson,
        contactPhone: c.contactPhone,
        contactEmail: c.contactEmail,
        status: c.status,
        logoUrl: c.logoUrl,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        contactsCount: c._count.contacts,
        requestsCount: c._count.trainingRequests,
        usersCount: c._count.users,
      })),
      total,
      params
    )
  );
});

export const POST = withModuleAction("companies", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    name, nameAr, legalName, crNumber, vatNumber, industry,
    country, city, address, postalCode, phone, email, website,
    contactPerson, contactPhone, contactEmail, status, logoUrl,
  } = body;

  if (!name) return fail("Company name is required", 400);

  const company = await db.company.create({
    data: {
      name,
      nameAr: nameAr ?? null,
      legalName: legalName ?? null,
      crNumber: crNumber ?? null,
      vatNumber: vatNumber ?? null,
      industry: industry ?? null,
      country: country ?? null,
      city: city ?? null,
      address: address ?? null,
      postalCode: postalCode ?? null,
      phone: phone ?? null,
      email: email ?? null,
      website: website ?? null,
      contactPerson: contactPerson ?? null,
      contactPhone: contactPhone ?? null,
      contactEmail: contactEmail ?? null,
      status: status ?? "ACTIVE",
      logoUrl: logoUrl ?? null,
    },
  });

  await db.auditLog.create({
    data: {
      userId: user.id,
      action: "CREATE",
      entity: "COMPANY",
      entityId: company.id,
      description: `Created company: ${company.name}`,
    },
  });

  return created(company);
});
