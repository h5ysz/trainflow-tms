// /api/roles — list + create dynamic roles
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { ALL_MODULES, ACTIONS, type UserRole } from "@/lib/auth/permissions";

const ALLOWED_SORT_FIELDS = ["code", "name", "createdAt"];

// Base types a *new custom* role may pick — SUPER_ADMIN is reserved for the
// real Super Admin system role so a custom role can never acquire the
// platform-admin-exclusive gates (settings/users/roles) just by being assigned.
const ASSIGNABLE_BASE_TYPES: UserRole[] = ["COMPANY_ADMIN", "COORDINATOR", "TRAINER", "AUDITOR", "CONTRACTOR", "VIEWER"];

function validatePermissions(perms: unknown): string[] | null {
  if (!Array.isArray(perms)) return null;
  const valid = new Set<string>(["*"]);
  for (const m of ALL_MODULES) {
    valid.add(`${m}.*`);
    for (const a of ACTIONS) valid.add(`${m}.${a}`);
  }
  return perms.every((p) => typeof p === "string" && valid.has(p)) ? (perms as string[]) : null;
}

export const GET = withErrorEnvelope(async function GET(req: Request) {
  const user = await requireRole("SUPER_ADMIN", "COORDINATOR");

  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);
  if (q.search) {
    where.OR = [{ name: { contains: q.search } }, { code: { contains: q.search } }];
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "code");

  const [rows, total] = await Promise.all([
    db.role.findMany({
      where,
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.role.count({ where }),
  ]);

  return list(rows, buildListMeta(total, q));
});

export const POST = withErrorEnvelope(async function POST(req: Request) {
  const user = await requireRole("SUPER_ADMIN");

  const body = await req.json().catch(() => ({}));
  const { code, name, nameAr, description, permissions, baseType } = body;

  if (!code || !name) return fail("code and name are required", 422, "VALIDATION_ERROR");

  if (!baseType || !ASSIGNABLE_BASE_TYPES.includes(baseType)) {
    return fail(`baseType must be one of: ${ASSIGNABLE_BASE_TYPES.join(", ")}`, 422, "VALIDATION_ERROR");
  }

  const validPermissions = validatePermissions(permissions ?? []);
  if (validPermissions === null) return fail("Invalid permission string(s)", 422, "VALIDATION_ERROR");

  const existing = await db.role.findUnique({ where: { code: code.toUpperCase() } });
  if (existing) return fail("Role code already exists", 400);

  const role = await db.role.create({
    data: {
      code: code.toUpperCase(),
      name,
      nameAr: nameAr ?? null,
      description: description ?? null,
      permissions: validPermissions,
      baseType,
      isSystem: false,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "ROLE",
    entityId: role.id,
    description: `Created new role: ${name} (${code})`,
    req,
    metadata: { code, baseType, permissions: validPermissions },
  });

  return created(role);
});
