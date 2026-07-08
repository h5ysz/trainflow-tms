// /api/roles — list + create dynamic roles
import { db } from "@/lib/db";
import { requireRole, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["code", "name", "createdAt"];

export async function GET(req: Request) {
  let user;
  try { user = await requireRole("SUPER_ADMIN", "COORDINATOR"); } catch { return fail("Forbidden", 403); }

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
}

export async function POST(req: Request) {
  let user;
  try { user = await requireRole("SUPER_ADMIN"); } catch { return fail("Forbidden", 403); }

  const body = await req.json().catch(() => ({}));
  const { code, name, nameAr, description, permissions } = body;

  if (!code || !name) return fail("code and name are required", 422, "VALIDATION_ERROR");

  const existing = await db.role.findUnique({ where: { code: code.toUpperCase() } });
  if (existing) return fail("Role code already exists", 400);

  const role = await db.role.create({
    data: {
      code: code.toUpperCase(),
      name,
      nameAr: nameAr ?? null,
      description: description ?? null,
      permissions: permissions ?? [],
      isSystem: false,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "USER",
    entityId: role.id,
    description: `Created new role: ${name} (${code})`,
    req,
    metadata: { code, permissions },
  });

  return created(role);
}
