// GCCLAB TMS — course-materials trainer-only migration
// =====================================================================
// Curriculum (course materials) and AI test generation are now TRAINER-only
// (Super Admin retains access via "*"). The COORDINATOR role previously held
// `course-materials.*`; this strips every `course-materials.*` permission from
// every role EXCEPT TRAINER and SUPER_ADMIN, so the coordinator can no longer
// list/upload/replace/delete materials or run the AI question generator.
//
// Mirrors the source-of-truth change in src/lib/auth/permissions.ts
// (OPERATIONAL_PERMISSIONS no longer contains course-materials) and
// scripts/seed-test-users.ts (COORDINATOR set no longer contains it).
//
// Idempotent — safe to re-run. Only touches Role.permissions arrays.
import { db } from "../src/lib/db";

const KEEP = new Set(["TRAINER", "SUPER_ADMIN"]);

async function main() {
  const roles = await db.role.findMany({ where: { deletedAt: null } });
  let changed = 0;
  for (const role of roles) {
    if (KEEP.has(role.code)) continue;
    const perms = Array.isArray(role.permissions) ? (role.permissions as string[]) : [];
    const filtered = perms.filter((p) => !p.startsWith("course-materials."));
    if (filtered.length !== perms.length) {
      await db.role.update({ where: { id: role.id }, data: { permissions: filtered } });
      console.log(`✓ ${role.code}: removed course-materials.* (${perms.length} → ${filtered.length})`);
      changed++;
    } else {
      console.log(`— ${role.code}: no course-materials permissions to remove`);
    }
  }
  console.log(changed > 0 ? `Done — updated ${changed} role(s).` : "Done — nothing to change.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
