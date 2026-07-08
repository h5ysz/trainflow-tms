// /api/roles — list system roles (any authenticated user)
import { db } from "@/lib/db";
import { getCurrentUser, ok, fail } from "@/lib/auth/api";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);

  const roles = await db.role.findMany({
    where: { deletedAt: null },
    orderBy: { code: "asc" },
    select: {
      id: true,
      code: true,
      name: true,
      nameAr: true,
      description: true,
      isSystem: true,
    },
  });
  return ok(roles);
}
