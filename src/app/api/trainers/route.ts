// /api/trainers — list + create (UUID, TRN-000001 ref number, soft delete, audit)
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { nextRefNumber } from "@/lib/api/ref-number";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["fullName", "createdAt", "updatedAt", "status", "nationality", "hireDate"];

export const GET = withModuleAction("trainers", "view", async ({ req }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { fullName: { contains: q.search } },
      { email: { contains: q.search } },
      { nationalId: { contains: q.search } },
      { fullNameAr: { contains: q.search } },
      { refNumber: { contains: q.search } },
    ];
  }
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.nationality) where.nationality = q.filters.nationality;
  if (q.filters.gender) where.gender = q.filters.gender;

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.trainer.findMany({
      where,
      include: {
        _count: {
          select: {
            qualifications: true,
            sessions: true,
            certifications: { where: { status: "VALID", deletedAt: null } },
          },
        },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.trainer.count({ where }),
  ]);

  return list(
    rows.map((t) => ({
      id: t.id,
      refNumber: t.refNumber,
      fullName: t.fullName,
      fullNameAr: t.fullNameAr,
      nationalId: t.nationalId,
      email: t.email,
      phone: t.phone,
      mobile: t.mobile,
      gender: t.gender,
      nationality: t.nationality,
      primarySpecialization: t.primarySpecialization,
      country: t.country,
      city: t.city,
      address: t.address,
      bio: t.bio,
      photoUrl: t.photoUrl,
      status: t.status,
      hireDate: t.hireDate,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      qualificationsCount: t._count.qualifications,
      certifiedCoursesCount: t._count.certifications,
      sessionsCount: t._count.sessions,
    })),
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("trainers", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    fullName, fullNameAr, nationalId, email, phone, mobile,
    gender, nationality, country, city, address, bio, photoUrl,
    status, hireDate,
  } = body;

  if (!fullName) return fail("Trainer full name is required", 422, "VALIDATION_ERROR");

  if (nationalId) {
    const exists = await db.trainer.findFirst({ where: { nationalId, deletedAt: null } });
    if (exists) return fail("National ID already exists", 400);
  }
  if (email) {
    const exists = await db.trainer.findFirst({ where: { email, deletedAt: null } });
    if (exists) return fail("Email already exists", 400);
  }

  const refNumber = await nextRefNumber("TRAINER");

  const trainer = await db.trainer.create({
    data: {
      refNumber,
      fullName,
      fullNameAr: fullNameAr ?? null,
      nationalId: nationalId ?? null,
      email: email ?? null,
      phone: phone ?? null,
      mobile: mobile ?? null,
      gender: gender ?? null,
      nationality: nationality ?? null,
      country: country ?? null,
      city: city ?? null,
      address: address ?? null,
      bio: bio ?? null,
      photoUrl: photoUrl ?? null,
      status: status ?? "ACTIVE",
      hireDate: hireDate ? new Date(hireDate) : null,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "TRAINER",
    entityId: trainer.id,
    entityRef: trainer.refNumber,
    description: `Created trainer: ${trainer.fullName} (${trainer.refNumber})`,
    descriptionAr: `تم إنشاء مدرب: ${trainer.fullName} (${trainer.refNumber})`,
    req,
  });

  return created(trainer);
});
