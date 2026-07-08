// /api/users — list + create (Super Admin only)
import { db } from "@/lib/db";
import { requireRole, ok, created, fail, auditLog } from "@/lib/auth/api";
import { hashPassword } from "@/lib/auth/jwt";
import { parseListParams, listResponse } from "@/lib/api/query";
import type { UserRole } from "@/lib/auth/permissions";

const VALID_ROLES: UserRole[] = ["SUPER_ADMIN", "COORDINATOR", "TRAINER", "CONTRACTOR"];

export async function GET(req: Request) {
  let user;
  try {
    user = await requireRole("SUPER_ADMIN");
  } catch {
    return fail("Forbidden — Super Admin only", 403);
  }

  const params = parseListParams(req);
  const where: Record<string, unknown> = {};
  if (params.search) {
    where.OR = [
      { fullName: { contains: params.search } },
      { email: { contains: params.search } },
    ];
  }
  if (params.status) where.isActive = params.status === "true";
  const url = new URL(req.url);
  const role = url.searchParams.get("role");
  if (role) where.role = role;

  const [rows, total] = await Promise.all([
    db.user.findMany({
      where,
      include: {
        company: { select: { id: true, name: true } },
        trainer: { select: { id: true, fullName: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (params.page - 1) * params.pageSize,
      take: params.pageSize,
    }),
    db.user.count({ where }),
  ]);

  return ok(
    listResponse(
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
        trainerId: u.trainerId,
        trainerName: u.trainer?.fullName ?? null,
        lastLoginAt: u.lastLoginAt,
        createdAt: u.createdAt,
      })),
      total,
      params
    )
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

  if (!email || !fullName || !password) return fail("email, fullName, password are required", 400);
  if (!VALID_ROLES.includes(role)) return fail(`Invalid role: ${role}`, 400);

  const dup = await db.user.findUnique({ where: { email } });
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
    },
  });

  await auditLog({
    userId: user.id,
    action: "CREATE",
    entity: "USER",
    entityId: newUser.id,
    description: `Created user ${newUser.email} (${newUser.role})`,
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
