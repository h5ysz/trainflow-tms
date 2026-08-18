// Migration: add "copilot.view" to ALL system role permissions.
// The Floating AI Copilot is available to every authenticated user, independent
// of the AI Dashboard. Idempotent — safe to re-run.
//
// Usage: npx tsx scripts/migrate-copilot-permissions.ts
import { PrismaClient } from "@prisma/client";

const ALL_ROLES = [
  "SUPER_ADMIN",
  "COMPANY_ADMIN",
  "COORDINATOR",
  "TRAINER",
  "AUDITOR",
  "CONTRACTOR",
  "VIEWER",
];

async function main() {
  console.log("→ Adding copilot.view to all system role permissions\n");

  for (const code of ALL_ROLES) {
    const role = await db.role.findUnique({ where: { code } });
    if (!role) {
      console.log(`   → ${code} role not found — skipping`);
      continue;
    }
    const perms = role.permissions as string[];
    if (perms.includes("copilot.view") || perms.includes("copilot.*") || perms.includes("*")) {
      console.log(`   → ${code} already has copilot permission — skipping`);
      continue;
    }
    const updated = [...perms, "copilot.view"];
    await db.role.update({
      where: { code },
      data: { permissions: updated },
    });
    console.log(`   ✓ ${code}: added copilot.view (${perms.length} → ${updated.length} permissions)`);
  }

  console.log("\n✓ Done — copilot.view added to all roles");
}

const db = new PrismaClient();

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
