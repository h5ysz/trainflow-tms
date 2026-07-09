// /api/settings/public — public branding settings (no auth required)
// Sprint 6: Login page needs to display the support email and logos without
// requiring the user to be authenticated first.
import { db } from "@/lib/db";
import { ok } from "@/lib/api/response";

export async function GET() {
  const rows = await db.setting.findMany({
    where: { isPublic: true },
    select: { key: true, value: true, category: true },
  });

  const map: Record<string, string> = {};
  for (const r of rows) {
    map[r.key] = r.value;
  }

  return ok(map);
}
