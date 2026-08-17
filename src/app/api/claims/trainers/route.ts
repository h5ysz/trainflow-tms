// /api/claims/trainers — lightweight list of trainers for the claim form
import { db } from "@/lib/db";
import { withModuleAction, ok } from "@/lib/auth/api";

export const GET = withModuleAction("claims", "create", async ({ req }) => {
  const url = new URL(req.url);
  const search = url.searchParams.get("search") ?? "";

  const where: Record<string, unknown> = { deletedAt: null, status: "ACTIVE" };
  if (search) {
    where.OR = [
      { nameEn: { contains: search } },
      { nameAr: { contains: search } },
      { email: { contains: search } },
    ];
  }

  const rows = await db.trainer.findMany({
    where,
    select: { id: true, nameEn: true, nameAr: true, engagementType: true },
    orderBy: { nameEn: "asc" },
    take: 200,
  });

  return ok(rows);
});
