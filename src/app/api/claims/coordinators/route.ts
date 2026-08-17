// /api/claims/coordinators — lightweight list of coordinator users for the claim form
import { db } from "@/lib/db";
import { withModuleAction, ok } from "@/lib/auth/api";

export const GET = withModuleAction("claims", "create", async ({ req }) => {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? "";

  // Find COORDINATOR role IDs
  const roleRows = await db.role.findMany({
    where: { code: "COORDINATOR", deletedAt: null },
    select: { id: true },
  });
  const coordinatorRoleIds = roleRows.map((r) => r.id);

  const where: Record<string, unknown> = {
    deletedAt: null,
    isActive: true,
    role: "COORDINATOR",
  };
  if (coordinatorRoleIds.length > 0) {
    where.roleId = { in: coordinatorRoleIds };
  }
  if (search) {
    where.OR = [
      { fullName: { contains: search } },
      { email: { contains: search } },
    ];
  }

  const rows = await db.user.findMany({
    where,
    select: { id: true, fullName: true },
    orderBy: { fullName: "asc" },
    take: 200,
  });

  return ok(rows);
});
