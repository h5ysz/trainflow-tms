// Phase 3 migration: add "ai-dashboard.view" to COORDINATOR role permissions.
// Idempotent — safe to re-run. Does NOT modify schema, only updates the JSON
// `permissions` array on the COORDINATOR Role row.
//
// Usage: npx tsx scripts/migrate-ai-dashboard-permissions.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  console.log("→ Adding ai-dashboard.view to COORDINATOR role permissions");
  const coord = await db.role.findUnique({ where: { code: "COORDINATOR" } });
  if (!coord) {
    console.log("   → COORDINATOR role not found — skipping (will be created by seed)");
    return;
  }
  const perms = coord.permissions as string[];
  if (perms.includes("ai-dashboard.view") || perms.includes("ai-dashboard.*") || perms.includes("*")) {
    console.log("   → COORDINATOR already has ai-dashboard permission — skipping");
    return;
  }
  const updated = [...perms, "ai-dashboard.view"];
  await db.role.update({
    where: { code: "COORDINATOR" },
    data: { permissions: updated },
  });
  console.log(`   ✓ Added ai-dashboard.view to COORDINATOR (${perms.length} → ${updated.length} permissions)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
