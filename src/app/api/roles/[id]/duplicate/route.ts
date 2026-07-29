// /api/roles/[id]/duplicate — clone an existing role under a new code
// =====================================================================
// Super Admin only. Copies name, description, permissions, and baseType
// from the source role. The new role's code must be unique (returned as
// 400 CODE_EXISTS if it clashes). The cloned role is never a system role.
//
// Body:
//   code        — required, will be uppercased
//   name        — required
//   nameAr      — optional
//   description — optional (defaults to source description)
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, notFound, fail, audit, created } from "@/lib/auth/api";

export const POST = withErrorEnvelope(async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SUPER_ADMIN");
  const { id } = await ctx.params;

  const source = await db.role.findUnique({ where: { id } });
  if (!source || source.deletedAt) return notFound("Role not found");

  const body = await req.json().catch(() => ({}));
  const { code, name, nameAr, description } = body as {
    code?: string;
    name?: string;
    nameAr?: string;
    description?: string;
  };

  if (!code || !name) {
    return fail("code and name are required", 422, "VALIDATION_ERROR");
  }

  const finalCode = code.toUpperCase();
  const finalName = name;
  const finalNameAr = nameAr ?? source.nameAr ?? null;
  const finalDesc = description ?? source.description ?? null;

  // Code uniqueness (across non-deleted roles)
  const existing = await db.role.findUnique({ where: { code: finalCode } });
  if (existing && !existing.deletedAt) {
    return fail(`Role code "${finalCode}" already exists`, 400, "CODE_EXISTS");
  }

  const cloned = await db.role.create({
    data: {
      code: finalCode,
      name: finalName,
      nameAr: finalNameAr,
      description: finalDesc,
      permissions: (source.permissions ?? []) as string[],
      baseType: source.baseType,
      isSystem: false, // duplicates are never system roles
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "ROLE",
    entityId: cloned.id,
    entityRef: cloned.code,
    description: `Duplicated role ${source.code} → ${cloned.code} (${cloned.name})`,
    descriptionAr: `تم نسخ الدور ${source.code} → ${cloned.code} (${cloned.name})`,
    req,
    metadata: {
      sourceRoleId: id,
      sourceCode: source.code,
      newCode: cloned.code,
      permissionsCount: (source.permissions as string[])?.length ?? 0,
    },
  });

  return created(cloned);
});
