// /api/settings — list + bulk update (Super Admin only)
import { db } from "@/lib/db";
import { requireRole, ok, fail, auditLog } from "@/lib/auth/api";

export async function GET() {
  let user;
  try {
    user = await requireRole("SUPER_ADMIN");
  } catch {
    return fail("Forbidden — Super Admin only", 403);
  }

  const settings = await db.setting.findMany({ orderBy: { category: "asc" } });
  // Group as key-value map
  const map: Record<string, { value: string; category: string; description?: string | null }> = {};
  for (const s of settings) {
    map[s.key] = { value: s.value, category: s.category, description: s.description };
  }
  return ok(map);
}

export async function PUT(req: Request) {
  let user;
  try {
    user = await requireRole("SUPER_ADMIN");
  } catch {
    return fail("Forbidden — Super Admin only", 403);
  }

  const body = await req.json().catch(() => ({}));
  // body: { settings: { key: value, ... } }
  const updates = body.settings ?? body;
  if (typeof updates !== "object" || Array.isArray(updates)) {
    return fail("Expected { settings: { key: value } }", 400);
  }

  const ops = Object.entries(updates).map(([key, value]) =>
    db.setting.upsert({
      where: { key },
      update: { value: String(value), updatedBy: user.id },
      create: {
        key,
        value: String(value),
        category: body.category ?? "GENERAL",
        updatedBy: user.id,
      },
    })
  );

  await Promise.all(ops);

  await auditLog({
    userId: user.id,
    action: "UPDATE",
    entity: "SETTING",
    description: `Updated settings: ${Object.keys(updates).join(", ")}`,
    req,
  });

  return ok({ success: true, updated: Object.keys(updates) });
}
