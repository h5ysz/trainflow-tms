// GCCLAB TMS — RBAC Test Users Seed Script
// =====================================================================
// Creates the 5 standard test accounts for RBAC verification.
// Also creates the missing system roles (COMPANY_ADMIN, COORDINATOR,
// TRAINER, AUDITOR, CONTRACTOR) with permissions derived from the
// permissions.ts buildPermissionStringsForRole() function.
//
// Does NOT touch SUPER_ADMIN or modify production seed.ts.
//
// Usage: npx tsx scripts/seed-test-users.ts
//
// All passwords: Demo@1234
import { PrismaClient } from "@prisma/client";
import { randomBytes, pbkdf2Sync } from "node:crypto";
import { TEST_TRAINER_TRAINER_ID } from "../src/lib/api/trainer-scope";

const db = new PrismaClient();

const PBKDF2_ITERATIONS = 600_000;
const TEST_PASSWORD = "Demo@1234";

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

// Permission sets per role (mirrors src/lib/auth/permissions.ts)
const ROLE_PERMISSIONS: Record<string, string[]> = {
  COMPANY_ADMIN: [
    "companies.view", "companies.edit",
    "company-contacts.view", "company-contacts.create", "company-contacts.edit", "company-contacts.delete",
    "trainers.view", "trainer-qualifications.view",
    "trainees.view", "trainees.create", "trainees.edit",
    "courses.view",
    "requests.view", "requests.create", "requests.edit",
    "sessions.view", "scheduling.view", "attendance.view",
    "certificates.view",
    "reports.view",
    "report-schedules.view", "report-schedules.create", "report-schedules.edit", "report-schedules.delete",
    "notifications.view", "audit-log.view",
    "user-approvals.view", "user-approvals.create", "user-approvals.edit",
    "user-management.view",
    "worker-passports.view", "compliance-matrix.view",
    "executive-dashboard.view", "renewal-dashboard.view",
  ],
  COORDINATOR: [
    "companies.*", "company-contacts.*", "trainers.*", "trainer-qualifications.*",
    "trainees.*", "courses.*", "requests.*", "sessions.*", "scheduling.*",
    "attendance.*", "qr-code.*", "pre-test.*", "final-test.*", "evaluation.*",
    "course-materials.*",
    "certificates.*", "reports.view",
    "report-schedules.*", "notifications.view", "audit-log.view",
    "user-approvals.view", "user-approvals.create", "user-approvals.edit",
    "worker-passports.view", "compliance-matrix.view",
    "executive-dashboard.view", "renewal-dashboard.view",
    "invoices.*", "quotations.*", "payments.*", "receipts.*",
    "bank-accounts.*", "financial-reports.view",
    "ai-dashboard.view",
  ],
  // TRAINER: delivery scoped. No administrative modules, NO certificates
  // (issuance stays with COORDINATOR). The server scopes every
  // session/course/trainee/workshop/evaluation query to this trainer's own
  // records (trainerId from the authenticated user — never from the client).
  // `sessions.edit`, `qr-code.create` and the exam `create`/`edit`s are the
  // delivery actions (start/complete a session, activate its QR window, run +
  // manage pre/final tests) and are additionally restricted server-side to the
  // trainer's own sessions.
  TRAINER: [
    "dashboard.view",
    "courses.view",
    // Course materials: trainer manages the uploaded files (PDF/PowerPoint/Word)
    // of the courses they run — upload, replace, delete, view. Granted as a
    // dedicated module so the trainer does NOT get `courses.edit` (full course
    // record editing stays with the coordinator).
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
  ],
  AUDITOR: [
    "companies.view", "company-contacts.view", "trainers.view", "trainer-qualifications.view",
    "trainees.view", "courses.view", "requests.view",
    "sessions.view", "scheduling.view", "attendance.view",
    "qr-code.view", "pre-test.view", "final-test.view", "evaluation.view",
    "certificates.view", "reports.view",
    "notifications.view", "audit-log.view",
    "worker-passports.view", "compliance-matrix.view",
    "executive-dashboard.view", "renewal-dashboard.view",
    "invoices.view", "quotations.view", "payments.view", "receipts.view",
    "bank-accounts.view", "financial-reports.view", "financial-settings.view",
  ],
  CONTRACTOR: [
    "trainees.view", "trainees.create", "trainees.edit",
    "requests.view", "requests.create",
    "courses.view",
    "certificates.view",
    "notifications.view",
    "worker-passports.view",
    "renewal-dashboard.view",
  ],
};

const ROLES = [
  // baseType must be a valid UserRole enum value from the Prisma schema
  // COMPANY_ADMIN and AUDITOR don't exist in the enum, so we map them to the closest valid role
  { code: "COMPANY_ADMIN", name: "Company Admin", nameAr: "مدير الشركة", baseType: "COORDINATOR" as const, description: "Company-scoped management" },
  { code: "COORDINATOR", name: "Coordinator", nameAr: "منسق التدريب", baseType: "COORDINATOR" as const, description: "Training operations coordinator" },
  { code: "TRAINER", name: "Trainer", nameAr: "المدرب", baseType: "TRAINER" as const, description: "Training delivery" },
  { code: "AUDITOR", name: "Auditor", nameAr: "المدقق", baseType: "VIEWER" as const, description: "Read-only compliance and audit access" },
  { code: "CONTRACTOR", name: "Contractor", nameAr: "المقاول", baseType: "CONTRACTOR" as const, description: "Contractor portal access" },
];

const TEST_USERS = [
  // User.role must be a valid UserRole enum value (SUPER_ADMIN, COORDINATOR, TRAINER, CONTRACTOR, VIEWER)
  // COMPANY_ADMIN and AUDITOR don't exist in the enum — use COORDINATOR/VIEWER as the enum
  // while linking to the correct Role row via roleId for permissions
  { email: "company.admin@gcclab.com", fullName: "Test Company Admin", role: "COORDINATOR" as const, roleCode: "COMPANY_ADMIN" },
  { email: "coordinator@gcclab.com", fullName: "Test Coordinator", role: "COORDINATOR" as const, roleCode: "COORDINATOR" },
  { email: "trainer@gcclab.com", fullName: "Test Trainer", role: "TRAINER" as const, roleCode: "TRAINER" },
  { email: "auditor@gcclab.com", fullName: "Test Auditor", role: "VIEWER" as const, roleCode: "AUDITOR" },
  { email: "contractor@gcclab.com", fullName: "Test Contractor", role: "CONTRACTOR" as const, roleCode: "CONTRACTOR" },
];

async function main() {
  console.log("→ Step 1: Creating system roles");
  for (const r of ROLES) {
    const permissions = ROLE_PERMISSIONS[r.code] || [];
    await db.role.upsert({
      where: { code: r.code },
      update: { name: r.name, nameAr: r.nameAr, description: r.description, permissions, baseType: r.baseType, isSystem: true },
      create: { code: r.code, name: r.name, nameAr: r.nameAr, description: r.description, permissions, baseType: r.baseType, isSystem: true },
    });
    console.log(`   ✓ Role: ${r.code} (${permissions.length} permissions)`);
  }

  console.log("\n→ Step 2: Creating test company + trainer");
  let testCompany = await db.company.findFirst({ where: { name: "Test Contractor Co." } });
  if (!testCompany) {
    testCompany = await db.company.create({
      data: { refNumber: "COM-TEST-001", name: "Test Contractor Co.", status: "ACTIVE" },
    });
    console.log("   ✓ Created test company:", testCompany.name);
  } else {
    console.log("   → Test company exists:", testCompany.name);
  }

  let testTrainer = await db.trainer.findFirst({ where: { email: "trainer@gcclab.com" } });
  if (testTrainer && testTrainer.id !== TEST_TRAINER_TRAINER_ID) {
    console.warn(
      `   ⚠ Test trainer exists with id ${testTrainer.id} (expected ${TEST_TRAINER_TRAINER_ID}). ` +
        "The QA test-wide scope will NOT apply until this is reconciled.",
    );
  }
  if (!testTrainer) {
    testTrainer = await db.trainer.create({
      data: {
        id: TEST_TRAINER_TRAINER_ID,
        refNumber: "TRN-TEST-001",
        nameEn: "Test Trainer",
        email: "trainer@gcclab.com",
        status: "ACTIVE",
      },
    });
    console.log("   ✓ Created test trainer:", testTrainer.nameEn);
  } else {
    console.log("   → Test trainer exists:", testTrainer.nameEn);
  }

  console.log("\n→ Step 3: Creating test users (password: Demo@1234)");
  const passwordHash = hashPassword(TEST_PASSWORD);
  let created = 0;
  let updated = 0;

  for (const u of TEST_USERS) {
    const existing = await db.user.findUnique({ where: { email: u.email } });
    const roleRow = await db.role.findUnique({ where: { code: u.roleCode } });
    if (!roleRow) {
      console.error(`   ✗ Role ${u.roleCode} not found — skipping ${u.email}`);
      continue;
    }

    const needsCompany = u.roleCode === "CONTRACTOR" || u.roleCode === "COMPANY_ADMIN";
    const needsTrainer = u.roleCode === "TRAINER";

    if (existing) {
      await db.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          role: u.role,
          roleId: roleRow.id,
          isActive: true,
          accountStatus: "ACTIVE",
          ...(needsCompany ? { companyId: testCompany.id } : {}),
          ...(needsTrainer ? { trainerId: testTrainer.id } : {}),
        },
      });
      console.log(`   → ${u.email} updated (password reset, role: ${u.roleCode})`);
      updated++;
    } else {
      await db.user.create({
        data: {
          email: u.email,
          passwordHash,
          fullName: u.fullName,
          role: u.role,
          roleId: roleRow.id,
          language: "en",
          isActive: true,
          accountStatus: "ACTIVE",
          ...(needsCompany ? { companyId: testCompany.id } : {}),
          ...(needsTrainer ? { trainerId: testTrainer.id } : {}),
        },
      });
      console.log(`   ✓ Created ${u.email} (enum: ${u.role}, role record: ${u.roleCode})`);
      created++;
    }
  }

  console.log(`\n✓ Done: ${created} created, ${updated} updated`);
  console.log("   All passwords: Demo@1234");
}

main().catch(console.error).finally(() => db.$disconnect());
