// /api/company-contacts — list + create
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, auditLog } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";

export const GET = withModuleAction("company-contacts", "view", async ({ req, user }) => {
  const params = parseListParams(req);
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { fullName: { contains: params.search } },
      { email: { contains: params.search } },
      { jobTitle: { contains: params.search } },
    ];
  }
  if (params.status) where.isActive = params.status === "true";
  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");
  if (companyId) where.companyId = companyId;

  if (user.role === "CONTRACTOR" && user.companyId) {
    where.companyId = user.companyId;
  }

  const [rows, total] = await Promise.all([
    db.companyContact.findMany({
      where,
      include: { company: { select: { id: true, name: true } } },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "desc" }],
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.companyContact.count({ where }),
  ]);

  return ok(
    listResponse(
      rows.map((c) => ({
        id: c.id,
        companyId: c.companyId,
        companyName: c.company?.name ?? null,
        fullName: c.fullName,
        jobTitle: c.jobTitle,
        email: c.email,
        phone: c.phone,
        mobile: c.mobile,
        isPrimary: c.isPrimary,
        isActive: c.isActive,
        notes: c.notes,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
      })),
      total,
      params
    )
  );
});

export const POST = withModuleAction("company-contacts", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { companyId, fullName, jobTitle, email, phone, mobile, isPrimary, isActive, notes } = body;
  if (!companyId || !fullName) return fail("companyId and fullName are required", 400);

  const company = await db.company.findUnique({ where: { id: companyId } });
  if (!company) return fail("Company not found", 404);

  const contact = await db.companyContact.create({
    data: {
      companyId,
      fullName,
      jobTitle: jobTitle ?? null,
      email: email ?? null,
      phone: phone ?? null,
      mobile: mobile ?? null,
      isPrimary: isPrimary ?? false,
      isActive: isActive ?? true,
      notes: notes ?? null,
    },
  });

  await auditLog({
    userId: user.id,
    action: "CREATE",
    entity: "COMPANY",
    entityId: companyId,
    description: `Created contact: ${contact.fullName} for ${company.name}`,
    req,
  });

  return created(contact);
});
