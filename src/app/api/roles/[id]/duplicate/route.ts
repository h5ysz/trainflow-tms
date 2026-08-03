// /api/roles/[id]/duplicate — clone an existing role under a new code
import { db } from "@/lib/db";
import { requireRole, ok, notFound, fail, audit, created } from "@/lib/auth/api";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let user;
  try { user = await requireRole("SUPER_ADMIN"); } catch { return fail("Forbidden", 403); }
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

  const finalCode = (code ?? `${source.code}_COPY`).toUpperCase();
  const finalName = name ?? `${source.name} (Copy)`;
  const finalNameAr = nameAr ?? source.nameAr ?? null;
  const finalDesc = description ?? source.description ?? null;

  // Code uniqueness
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
      permissions: (source.permissions ?? []) as string[], // copy permission matrix
      isSystem: false, // duplicates are never system roles
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "USER",
    entityId: cloned.id,
    description: `Duplicated role ${source.code} → ${cloned.code} (${cloned.name})`,
    descriptionAr: `تم نسخ الدور ${source.code} → ${cloned.code} (${cloned.name})`,
    req,
    metadata: { sourceRoleId: id, sourceCode: source.code, newCode: cloned.code, permissions: cloned.permissions },
  });

  return created(cloned);
}
