// /api/languages — public endpoint, returns active languages (no auth required)
import { db } from "@/lib/db";
import { ok } from "@/lib/auth/api";

export async function GET() {
  const langs = await db.language.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
  return ok(langs);
}
