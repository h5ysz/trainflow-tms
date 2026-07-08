// /api/users — list + create (Super Admin only, soft delete, audit)
import { db } from "@/lib/db";
import { requireRole, ok, created, fail, audit } from "@/lib/auth/api";
import { hashPassword } from "@/lib/auth/jwt";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import type { UserRole } from "@/lib/auth/permissions";

const VALID_ROLES: UserRole[] = ["SUPER_ADMIN", "COORDINATOR", "TRAINER", "CONTRACTOR"];
const ALLOWED_SORT_FIELDS = ["fullName", "email", "createdAt", "updatedAt", "role", "isActive", "lastLoginAt"];

export async function GET(req: Request) {
  let user;
  try {
    user = await requireRole("SUPER_ADMIN");
  } catch {
    return fail("Forbidden — Super Admin only", 403);
  }

  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { fullName: { contains: q.search } },
      { email: { contains: q.search } },
    ];
  }
  if (q.filters.role) where.role = q.filters.role;
  if (q.filters.isActive) where.isActive = q.filters.isActive === "true";
  if (q.filters.companyId) where.companyId = q.filters.companyId;

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, refNumber: true } },
        trainer: { select: { id: true, fullName: true, refNumber: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.user.count({ where }),
  ]);

  return list(
    rows.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role,
      isActive: u.isActive,
      language: u.language,
      avatarUrl: u.avatarUrl,
      companyId: u.companyId,
      companyName: u.company?.name ?? null,
      companyRef: u.company?.refNumber ?? null,
      trainerId: u.trainerId,
      trainerName: u.trainer?.fullName ?? null,
      trainerRef: u.trainer?.refNumber ?? null,
      lastLoginAt: u.lastLoginAt,
      createdAt: u.createdAt,
    })),
    buildListMeta(total, q)
  );
}

export async function POST(req: Request) {
  let user;
  try {
    user = await requireRole("SUPER_ADMIN");
  } catch {
    return fail("Forbidden — Super Admin only", 403);
  }

  const body = await req.json().catch(() => ({}));
  const { email, fullName, password, role, language, companyId, trainerId, isActive } = body;

  if (!email || !fullName || !password) return fail("email, fullName, password are required", 422, "VALIDATION_ERROR");
  if (!VALID_ROLES.includes(role)) return fail(`Invalid role: ${role}`, 400);

  const dup = await db.user.findFirst({ where: { email, deletedAt: null } });
  if (dup) return fail("Email already exists", 400);

  const passwordHash = await hashPassword(password);

  const newUser = await db.user.create({
    data: {
      email,
      fullName,
      passwordHash,
      role,
      language: language ?? "en",
      isActive: isActive ?? true,
      companyId: companyId ?? null,
      trainerId: trainerId ?? null,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "USER",
    entityId: newUser.id,
    description: `Created user ${newUser.email} (${newUser.role})`,
    descriptionAr: `تم إنشاء مستخدم ${newUser.email} (${newUser.role})`,
    req,
  });

  return created({
    id: newUser.id,
    email: newUser.email,
    fullName: newUser.fullName,
    role: newUser.role,
    isActive: newUser.isActive,
  });
}
