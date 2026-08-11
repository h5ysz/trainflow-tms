// /api/trainees — list + create (TRA-000001 ref number, duplicate National ID prevention)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { nextRefNumber } from "@/lib/api/ref-number";
import { list } from "@/lib/api/response";
import { coordinatorRegionScope } from "@/lib/api/region-scope";
import { trainerTraineeFilter } from "@/lib/api/trainer-scope";
import { randomUUID } from "node:crypto";

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
      { nationality: { contains: q.search } },
    ];
  }
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.companyId) where.companyId = q.filters.companyId;
  if (q.filters.nationality) where.nationality = q.filters.nationality;

  // Contractors only see their own company's trainees
  if (user.role === "CONTRACTOR" && user.companyId) {
    where.companyId = user.companyId;
  }

  // Coordinators scoped to a region only see trainees of companies within
  // their scope (own region + coverage). This makes the company-first trainee
  // picker safe server-side: even a crafted ?companyId= for an out-of-scope
  // company returns nothing.
  const scope = coordinatorRegionScope(user);
  if (scope) {
    where.company = { region: { in: scope } };
  }

  // Trainers only see trainees enrolled in their own sessions. Derived from the
  // authenticated user's trainerId — a crafted filter cannot widen it.
  const trainerFilter = trainerTraineeFilter(user);
  if (trainerFilter) Object.assign(where, trainerFilter);

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
      documents: t.documents,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      requestsCount: t._count.requestCourses,
    })),
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("trainees", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { fullName, nationalId, nationality, jobTitle, mobile, email, companyId, status, notes, documents, dateOfBirth, idExpiry } = body;

  if (!fullName || !nationalId || !companyId) {
    return fail("fullName, nationalId, and companyId are required", 422, "VALIDATION_ERROR");
  }

  // ── RBAC: company scope for the trainee file ──
  // Contractors may only create trainees under their own company (the passed
  // companyId is forced to theirs). Coordinators scoped to a region may only
  // create trainees for companies inside their region scope.
  let finalCompanyId = companyId;
  if (user.role === "CONTRACTOR" && user.companyId) {
    finalCompanyId = user.companyId;
  }
  const scope = coordinatorRegionScope(user);
  if (scope) {
    const targetCompany = await db.company.findFirst({
      where: { id: finalCompanyId, deletedAt: null },
      select: { region: true },
    });
    if (!targetCompany || !targetCompany.region || !scope.includes(targetCompany.region)) {
      return fail("You can only add trainees to companies within your region scope", 403, "FORBIDDEN_COMPANY_SCOPE");
    }
  }

  // Staged photo / identity attachments uploaded via /api/trainees/upload-id.
  let documentsJson: string | null = null;
  if (documents !== undefined && documents !== null) {
    if (!Array.isArray(documents)) {
      return fail("documents must be an array", 422, "VALIDATION_ERROR");
    }
    const now = new Date().toISOString();
    const clean = documents
      .map((d) => {
        const o = (d ?? {}) as Record<string, unknown>;
        const url = typeof o.url === "string" ? o.url.trim() : "";
        const type = typeof o.type === "string" ? o.type.trim() : "";
        const filename = typeof o.filename === "string" ? o.filename.trim() : "";
        if (!url || !type) return null;
        return {
          url,
          filename,
          type,
          uploadedAt: typeof o.uploadedAt === "string" ? o.uploadedAt : now,
          uploadedById: user.id,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
    documentsJson = JSON.stringify(clean);
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
  const company = await db.company.findFirst({ where: { id: finalCompanyId, deletedAt: null } });
  if (!company) return fail("Company not found", 404);

  const refNumber = await nextRefNumber("TRAINEE");

  const trainee = await db.trainee.create({
    data: {
      id: randomUUID(),
      refNumber,
      fullName,
      nationalId,
      nationality: nationality ?? null,
      jobTitle: jobTitle ?? null,
      mobile: mobile ?? null,
      email: email ?? null,
      companyId: finalCompanyId,
      status: status ?? "ACTIVE",
      notes: notes ?? null,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
      idExpiry: idExpiry ? new Date(idExpiry) : null,
      ...(documentsJson !== null && { documents: documentsJson }),
      createdBy: user.id,
      updatedBy: user.id,
      updatedAt: new Date(),
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
