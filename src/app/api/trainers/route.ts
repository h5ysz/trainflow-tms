// /api/trainers — list + create
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, auditLog } from "@/lib/auth/api";
import { parseListParams, listResponse } from "@/lib/api/query";

export const GET = withModuleAction("trainers", "view", async ({ req }) => {
  const params = parseListParams(req);
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { fullName: { contains: params.search } },
      { email: { contains: params.search } },
      { nationalId: { contains: params.search } },
      { fullNameAr: { contains: params.search } },
    ];
  }
  if (params.status) where.status = params.status;

  const [rows, total] = await Promise.all([
    db.trainer.findMany({
      where,
      include: {
        _count: {
          select: {
            qualifications: true,
            sessions: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.trainer.count({ where }),
  ]);

  return ok(
    listResponse(
      rows.map((t) => ({
        id: t.id,
        fullName: t.fullName,
        fullNameAr: t.fullNameAr,
        nationalId: t.nationalId,
        email: t.email,
        phone: t.phone,
        mobile: t.mobile,
        gender: t.gender,
        nationality: t.nationality,
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
        sessionsCount: t._count.sessions,
      })),
      total,
      params
    )
  );
});

export const POST = withModuleAction("trainers", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    fullName, fullNameAr, nationalId, email, phone, mobile,
    gender, nationality, country, city, address, bio, photoUrl,
    status, hireDate,
  } = body;

  if (!fullName) return fail("Trainer full name is required", 400);

  // Check uniqueness
  if (nationalId) {
    const exists = await db.trainer.findUnique({ where: { nationalId } });
    if (exists) return fail("National ID already exists", 400);
  }
  if (email) {
    const exists = await db.trainer.findUnique({ where: { email } });
    if (exists) return fail("Email already exists", 400);
  }

  const trainer = await db.trainer.create({
    data: {
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
    },
  });

  await auditLog({
    userId: user.id,
    action: "CREATE",
    entity: "TRAINER",
    entityId: trainer.id,
    description: `Created trainer: ${trainer.fullName}`,
    req,
  });

  return created(trainer);
});
