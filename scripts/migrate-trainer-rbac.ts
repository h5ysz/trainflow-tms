// GCCLAB TMS — TRAINER RBAC migration
// =====================================================================
// Replaces the TRAINER role's permission set with the delivery-scoped set that
// matches src/lib/auth/permissions.ts (TRAINER_PERMISSIONS). The old set gave
// the trainer coordinator-level access to companies, trainees, courses,
// requests, certificates, reports, audit log, approvals, dashboards, etc.
// The set below is delivery-scoped: sessions/attendance/QR/tests/evaluations
// plus read-only, server-scoped visibility of the trainer's own courses and
// trainees, plus course-materials (upload/replace/delete of the files of their
// own courses). NO certificates (issuance stays with COORDINATOR), NO
// administrative/financial/AI modules.
//
// This script runs on every deploy (render.yaml buildCommand), so its list is
// the source of truth for what the TRAINER role holds in production — keep it
// in sync with seed-test-users.ts's ROLE_PERMISSIONS.TRAINER.
//
// Also ensures the COORDINATOR role includes claims permissions.
//
// Idempotent — safe to re-run. Only touches the TRAINER and COORDINATOR Role
// rows' `permissions` arrays. Does NOT modify SUPER_ADMIN / CONTRACTOR, does
// not touch any data.
//
// Usage: npx tsx scripts/migrate-trainer-rbac.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const TRAINER_PERMISSIONS = [
  "dashboard.view",
  "courses.view",
  "course-materials.view", "course-materials.create", "course-materials.edit", "course-materials.delete",
  "trainees.view",
  "sessions.view", "sessions.edit",
  "attendance.view", "attendance.create", "attendance.edit",
  "qr-code.view", "qr-code.create",
  "pre-test.view", "pre-test.create", "pre-test.edit",
  "final-test.view", "final-test.create", "final-test.edit",
  "evaluation.view",
  "workshops.view",
  "notifications.view",
  "claims.view", "claims.create", "claims.edit",
];

async function main() {
  // ── TRAINER ──
  const trainer = await db.role.findUnique({ where: { code: "TRAINER" } });
  if (!trainer) {
    console.log("   → TRAINER role not found — skipping");
  } else {
    const current = trainer.permissions as string[];
    const sameLength = current.length === TRAINER_PERMISSIONS.length;
    const sameSet = sameLength && [...TRAINER_PERMISSIONS].every((p) => current.includes(p));
    if (sameSet) {
      console.log("   → TRAINER role already has the delivery-only permission set — skipping");
    } else {
      await db.role.update({
        where: { code: "TRAINER" },
        data: { permissions: TRAINER_PERMISSIONS },
      });
      console.log(`   ✓ Replaced TRAINER role permissions (${current.length} → ${TRAINER_PERMISSIONS.length})`);
    }
  }

  // ── COORDINATOR — ensure claims permissions are present ──
  const COORDINATOR_CLAIMS_PERMS = ["claims.view", "claims.create", "claims.edit", "claims.delete"];
  const coordinator = await db.role.findUnique({ where: { code: "COORDINATOR" } });
  if (!coordinator) {
    console.log("   → COORDINATOR role not found — skipping");
  } else {
    const current = coordinator.permissions as string[];
    const missing = COORDINATOR_CLAIMS_PERMS.filter((p) => !current.includes(p));
    if (missing.length === 0) {
      console.log("   → COORDINATOR role already has claims permissions — skipping");
    } else {
      const updated = [...current, ...missing];
      await db.role.update({
        where: { code: "COORDINATOR" },
        data: { permissions: updated },
      });
      console.log(`   ✓ Added claims permissions to COORDINATOR (+${missing.length}: ${missing.join(", ")})`);
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
