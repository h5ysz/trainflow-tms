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
// Idempotent — safe to re-run. Only touches the TRAINER Role row's `permissions`
// array (mirrors scripts/migrate-ai-dashboard-permissions.ts). Does NOT modify
// SUPER_ADMIN / COORDINATOR / CONTRACTOR, does not touch any data.
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
];

async function main() {
  const trainer = await db.role.findUnique({ where: { code: "TRAINER" } });
  if (!trainer) {
    console.log("   → TRAINER role not found — skipping (it will be created by seed-test-users with the new set)");
    return;
  }

  const current = trainer.permissions as string[];
  const sameLength = current.length === TRAINER_PERMISSIONS.length;
  const sameSet = sameLength && [...TRAINER_PERMISSIONS].every((p) => current.includes(p));
  if (sameSet) {
    console.log("   → TRAINER role already has the delivery-only permission set — skipping");
    return;
  }

  await db.role.update({
    where: { code: "TRAINER" },
    data: { permissions: TRAINER_PERMISSIONS },
  });
  console.log(`   ✓ Replaced TRAINER role permissions (${current.length} → ${TRAINER_PERMISSIONS.length})`);
  console.log("     Removed: companies/company-contacts/trainers/trainer-qualifications/requests/");
  console.log("     scheduling/certificates/reports/audit-log/user-approvals/");
  console.log("     worker-passports/compliance-matrix/executive-dashboard/renewal-dashboard + all `.*` grants.");
  console.log("     Added: courses.view, trainees.view, qr-code.create, pre-test.edit, final-test.edit,");
  console.log("     course-materials.view, course-materials.create, course-materials.edit, course-materials.delete.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
