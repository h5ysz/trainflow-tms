// /api/claims — list + create trainer claims
import { db } from "@/lib/db";
import { withModuleAction, audit, fail } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { createClaim, generateClaimItems, CLAIM_TYPES, type ClaimListFilters } from "@/lib/claims/service";

const ALLOWED_SORT_FIELDS = ["createdAt", "updatedAt", "refNumber", "periodFrom", "periodTo", "status", "totalAmount"];

export const GET = withModuleAction("claims", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const filters: ClaimListFilters = {
    claimType: q.filters.claimType || undefined,
    status: q.filters.status || undefined,
    trainerId: q.filters.trainerId || undefined,
    coordinatorId: q.filters.coordinatorId || undefined,
    search: q.search,
    month: q.filters.month || undefined,
  };

  // Trainers may only see their own claims; coordinators see claims assigned to them; admins see all.
  let trainerScopeId: string | null = null;
  if (user.role === "TRAINER") {
    trainerScopeId = user.trainerId ?? null;
  } else if (user.role === "COORDINATOR" && !filters.coordinatorId) {
    // Auto-scope coordinators to claims assigned to them (unless they explicitly filter)
    filters.coordinatorId = user.id;
  }

  const where: Record<string, unknown> = { deletedAt: q.includeDeleted ? undefined : null };
  if (trainerScopeId) where.trainerId = trainerScopeId;
  if (filters.claimType) where.claimType = filters.claimType;
  if (filters.status) where.status = filters.status;
  if (filters.trainerId && !trainerScopeId) where.trainerId = filters.trainerId;
  if (filters.coordinatorId) where.coordinatorId = filters.coordinatorId;
  if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) {
    const [y, m] = filters.month.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    where.periodFrom = { lte: to };
    where.periodTo = { gte: from };
  }
  if (filters.search) {
    where.OR = [
      { refNumber: { contains: filters.search } },
      { trainer: { nameEn: { contains: filters.search } } },
      { trainer: { nameAr: { contains: filters.search } } },
    ];
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.trainerClaim.findMany({
      where,
      include: {
        trainer: { select: { id: true, nameEn: true, nameAr: true, refNumber: true, engagementType: true } },
        coordinator: { select: { id: true, fullName: true } },
        _count: { select: { items: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.trainerClaim.count({ where }),
  ]);

  return list(
    rows.map((c) => ({
      id: c.id,
      refNumber: c.refNumber,
      claimType: c.claimType,
      engagementType: c.engagementType,
      status: c.status,
      periodFrom: c.periodFrom,
      periodTo: c.periodTo,
      dailyAllowance: c.dailyAllowance,
      mainLocation: c.mainLocation,
      totalHours: c.totalHours,
      totalDays: c.totalDays,
      totalAmount: c.totalAmount,
      currency: c.currency,
      itemCount: c._count.items,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      trainer: c.trainer,
      coordinator: c.coordinator,
    })),
    buildListMeta(total, q),
  );
});

export const POST = withModuleAction("claims", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const claimType = body.claimType;
  const trainerId = typeof body.trainerId === "string" ? body.trainerId : undefined;
  const coordinatorId = typeof body.coordinatorId === "string" ? body.coordinatorId : undefined;
  const engagementType = typeof body.engagementType === "string" ? body.engagementType : undefined;
  const periodFrom = body.periodFrom;
  const periodTo = body.periodTo;
  const notes = typeof body.notes === "string" ? body.notes : undefined;

  if (!CLAIM_TYPES.includes(claimType)) {
    return fail("claimType must be OVERTIME or BUSINESS_MISSION", 422, "VALIDATION_ERROR");
  }
  if (!trainerId) {
    return fail("trainerId is required", 422, "VALIDATION_ERROR");
  }
  if (!periodFrom || !periodTo) {
    return fail("periodFrom and periodTo are required", 422, "VALIDATION_ERROR");
  }

  const claim = await createClaim({ claimType, trainerId, coordinatorId, engagementType, periodFrom, periodTo, notes }, { id: user.id, fullName: user.fullName });

  await audit({
    user,
    action: "CREATE",
    entity: "CLAIM",
    entityId: claim.id,
    entityRef: claim.refNumber,
    description: `Created ${claimType} claim ${claim.refNumber}`,
    descriptionAr: `تم إنشاء مطالبة ${claimType === "OVERTIME" ? "ساعات إضافية" : "رحلة عمل"} ${claim.refNumber}`,
    req,
  });

  // Auto-generate items from the trainer's sessions in the period.
  let generated;
  try {
    generated = await generateClaimItems(claim.id, { id: user.id, fullName: user.fullName });
  } catch {
    generated = null;
  }

  const claimId = generated?.id ?? claim.id;
  const full = await db.trainerClaim.findUnique({
    where: { id: claimId },
    include: {
      trainer: { select: { id: true, nameEn: true, nameAr: true, refNumber: true, engagementType: true } },
      items: true,
    },
  });
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        id: full!.id,
        refNumber: full!.refNumber,
        claimType: full!.claimType,
        engagementType: full!.engagementType,
        status: full!.status,
        periodFrom: full!.periodFrom,
        periodTo: full!.periodTo,
        createdAt: full!.createdAt,
        updatedAt: full!.updatedAt,
        trainer: full!.trainer,
        itemCount: full!.items.length,
      },
    }),
    { status: 201, headers: { "Content-Type": "application/json" } },
  );
});
