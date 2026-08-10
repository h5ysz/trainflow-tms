// /api/companies — list + create (with UUID, COM-000001 ref number, soft delete, audit)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { nextRefNumber } from "@/lib/api/ref-number";
import { list } from "@/lib/api/response";
import { coordinatorRegionScope } from "@/lib/api/region-scope";
import { isRegionCode } from "@/lib/regions";

const ALLOWED_SORT_FIELDS = ["name", "createdAt", "updatedAt", "status", "industry", "country", "city"];

export const GET = withModuleAction("companies", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { name: { contains: q.search } },
      { legalName: { contains: q.search } },
      { email: { contains: q.search } },
      { crNumber: { contains: q.search } },
      { refNumber: { contains: q.search } },
    ];
  }
  // Apply status filter (legacy — also supported via q.filters)
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.industry) where.industry = q.filters.industry;
  if (q.filters.country) where.country = q.filters.country;
  if (q.filters.region) where.region = q.filters.region;

  // Contractors only see their own company
  if (user.role === "CONTRACTOR" && user.companyId) {
    where.id = user.companyId;
  }

  // Coordinators scoped to a region see only companies within their scope
  // (own region + covered regions). Unscoped coordinators (no region assigned)
  // keep full visibility for backward compatibility.
  const scope = coordinatorRegionScope(user);
  if (scope) {
    where.region = { in: scope };
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.company.findMany({
      where,
      include: {
        contacts: {
          where: { deletedAt: null, isActive: true },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
          take: 3,
          select: { id: true, fullName: true, fullNameAr: true, jobTitle: true, email: true, phone: true, mobile: true, preferredContact: true, isPrimary: true },
        },
        _count: { select: { contacts: true, trainingRequests: true, users: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.company.count({ where }),
  ]);

  return list(
    rows.map((c) => ({
      id: c.id,
      refNumber: c.refNumber,
      name: c.name,
      nameAr: c.nameAr,
      legalName: c.legalName,
      crNumber: c.crNumber,
      vatNumber: c.vatNumber,
      industry: c.industry,
      country: c.country,
      city: c.city,
      region: c.region,
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
      contacts: c.contacts.map((ct) => ({
        id: ct.id,
        fullName: ct.fullName,
        fullNameAr: ct.fullNameAr,
        jobTitle: ct.jobTitle,
        email: ct.email,
        phone: ct.phone,
        mobile: ct.mobile,
        preferredContact: ct.preferredContact,
        isPrimary: ct.isPrimary,
      })),
      contactsCount: c._count.contacts,
      requestsCount: c._count.trainingRequests,
      usersCount: c._count.users,
    })),
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("companies", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    name, nameAr, legalName, crNumber, vatNumber, industry,
    country, city, region, address, postalCode, phone, email, website,
    contactPerson, contactPhone, contactEmail, status, logoUrl,
  } = body;

  if (!name) return fail("Company name is required", 422, "VALIDATION_ERROR");
  if (region !== undefined && region !== null && region !== "" && !isRegionCode(region)) {
    return fail(`Invalid region: ${region}. Valid: CENTRAL, EASTERN, WESTERN, SOUTHERN.`, 422, "VALIDATION_ERROR");
  }

  // Uniqueness checks
  if (crNumber) {
    const dup = await db.company.findFirst({ where: { crNumber, deletedAt: null } });
    if (dup) return fail("Commercial Registration number already exists", 400);
  }

  const refNumber = await nextRefNumber("COMPANY");

  const company = await db.company.create({
    data: {
      refNumber,
      name,
      nameAr: nameAr ?? null,
      legalName: legalName ?? null,
      crNumber: crNumber ?? null,
      vatNumber: vatNumber ?? null,
      industry: industry ?? null,
      country: country ?? null,
      city: city ?? null,
      region: region ?? null,
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
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "COMPANY",
    entityId: company.id,
    entityRef: company.refNumber,
    description: `Created company: ${company.name} (${company.refNumber})`,
    descriptionAr: `تم إنشاء شركة: ${company.name} (${company.refNumber})`,
    req,
  });

  return created(company);
});
