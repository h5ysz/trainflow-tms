// /api/trainees — list + create (TRA-000001 ref number, duplicate National ID prevention)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { nextRefNumber } from "@/lib/api/ref-number";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["fullName", "nationalId", "createdAt", "updatedAt", "status", "nationality", "jobTitle"];

export const GET = withModuleAction("trainees", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { fullName: { contains: q.search } },
      { nationalId: { contains: q.search } },
      { email: { contains: q.search } },
      { mobile: { contains: q.search } },
      { refNumber: { contains: q.search } },
    ];
  }
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.companyId) where.companyId = q.filters.companyId;
  if (q.filters.nationality) where.nationality = q.filters.nationality;

  // Contractors only see their own company's trainees
  if (user.role === "CONTRACTOR" && user.companyId) {
    where.companyId = user.companyId;
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.trainee.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, refNumber: true } },
        _count: { select: { requestCourses: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.trainee.count({ where }),
  ]);

  return list(
    rows.map((t) => ({
      id: t.id,
      refNumber: t.refNumber,
      fullName: t.fullName,
      nationalId: t.nationalId,
      nationality: t.nationality,
      jobTitle: t.jobTitle,
      mobile: t.mobile,
      email: t.email,
      companyId: t.companyId,
      companyName: t.company?.name ?? null,
      companyRef: t.company?.refNumber ?? null,
      status: t.status,
      notes: t.notes,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      requestsCount: t._count.requestCourses,
    })),
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("trainees", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { fullName, nationalId, nationality, jobTitle, mobile, email, companyId, status, notes } = body;

  if (!fullName || !nationalId || !companyId) {
    return fail("fullName, nationalId, and companyId are required", 422, "VALIDATION_ERROR");
  }

  // Prevent duplicate National ID (excluding soft-deleted records)
  const existing = await db.trainee.findFirst({
    where: { nationalId, deletedAt: null },
  });
  if (existing) {
    return fail(`Trainee with National ID "${nationalId}" already exists (${existing.refNumber})`, 400, "DUPLICATE_NATIONAL_ID", {
      existingRefNumber: existing.refNumber,
      existingId: existing.id,
    });
  }

  // Validate company exists
  const company = await db.company.findFirst({ where: { id: companyId, deletedAt: null } });
  if (!company) return fail("Company not found", 404);

  const refNumber = await nextRefNumber("TRAINEE");

  const trainee = await db.trainee.create({
    data: {
      refNumber,
      fullName,
      nationalId,
      nationality: nationality ?? null,
      jobTitle: jobTitle ?? null,
      mobile: mobile ?? null,
      email: email ?? null,
      companyId,
      status: status ?? "ACTIVE",
      notes: notes ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    },
    include: { company: { select: { name: true, refNumber: true } } },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "TRAINEE",
    entityId: trainee.id,
    entityRef: trainee.refNumber,
    description: `Created trainee: ${trainee.fullName} (${trainee.refNumber}) for ${trainee.company?.name}`,
    descriptionAr: `تم إنشاء متدرب: ${trainee.fullName} (${trainee.refNumber}) لـ ${trainee.company?.name}`,
    req,
  });

  return created(trainee);
});
