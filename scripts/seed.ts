// GCCLAB TMS — Clean seed script
// =====================================================================
// Per architecture requirements, we seed ONLY:
//   - Super Admin account
//   - System Roles (SUPER_ADMIN + COMPANY_ADMIN + COORDINATOR + TRAINER + AUDITOR)
//   - Default user accounts for the 4 non-super-admin system roles
//   - Permissions
//   - System Settings
//   - Arabic and English languages
//
// NO sample companies, trainers, courses, requests, sessions, attendance,
// certificates, or exams are seeded. The application starts completely empty
// in production form, ready for real business data entry.
//
// IDEMPOTENCY: Re-running this seed is safe. Existing roles are NOT overwritten
// (only created if missing). Existing users are NOT overwritten (only created if
// missing). The SUPER_ADMIN account is the sole exception — its password is
// always reset from SUPER_ADMIN_PASSWORD env var (preserving existing behavior).

import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/jwt";
import { nextRefNumber } from "../src/lib/api/ref-number";
import { buildPermissionStringsForRole, type UserRole } from "../src/lib/auth/permissions";
import { randomBytes } from "crypto";

async function main() {
  console.log("🌱 Seeding GCCLAB TMS (clean — no fake business data)...\n");

  // ─────────────────────────────────────────────────────────────────
  // 1) LANGUAGES
  // ─────────────────────────────────────────────────────────────────
  console.log("→ Languages (Arabic + English)");
  const languages = [
    { code: "en", name: "English", nameNative: "English", direction: "ltr", isDefault: true, sortOrder: 1 },
    { code: "ar", name: "Arabic", nameNative: "العربية", direction: "rtl", isDefault: false, sortOrder: 2 },
  ];
  for (const lang of languages) {
    await db.language.upsert({
      where: { code: lang.code },
      update: { name: lang.name, nameNative: lang.nameNative, direction: lang.direction, isDefault: lang.isDefault, sortOrder: lang.sortOrder, isActive: true },
      create: lang,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // 2) SYSTEM ROLES
  // ─────────────────────────────────────────────────────────────────
  // SUPER_ADMIN is always re-synced (its permissions are ["*"] and it stays
  // isSystem=true) — preserving the original behavior.
  //
  // The 4 operational system roles (COMPANY_ADMIN, COORDINATOR, TRAINER, AUDITOR)
  // are CREATED IF MISSING but NEVER OVERWRITTEN. If the admin has customized a
  // role's permissions via the UI, re-running this seed will not undo those
  // changes. The `update: {}` (empty) on the upsert enforces this.
  //
  // `permissions` here is the LIVE, DB-driven RBAC source (src/lib/auth/api.ts
  // resolveEffectivePermissions() reads it per-request). `baseType` is what a
  // user assigned to this role gets stored as User.role (the enum), which
  // drives tenant-row-scoping and the fixed Super-Admin-only admin gates —
  // those two concerns stay separate from this operational permission set.
  console.log("→ System roles");
  const roles = [
    {
      code: "SUPER_ADMIN", name: "Super Admin", nameAr: "مدير النظام", baseType: "SUPER_ADMIN" as const,
      description: "Platform administration: settings, users, roles, branding, integrations. Also has all operational permissions.",
      permissions: ["*"], isSystem: true,
    },
    {
      code: "COMPANY_ADMIN", name: "Company Admin", nameAr: "مدير الشركة", baseType: "COMPANY_ADMIN" as const,
      description: "Company-scoped management: manage companies, trainees, requests, report schedules. View-only on training delivery. No system settings or roles.",
      permissions: buildPermissionStringsForRole("COMPANY_ADMIN"), isSystem: true,
    },
    {
      code: "COORDINATOR", name: "Coordinator", nameAr: "منسق التدريب", baseType: "COORDINATOR" as const,
      description: "Training operations: full CRUD on companies, trainers, trainees, courses, requests, sessions, attendance, exams, certificates. No system settings.",
      permissions: buildPermissionStringsForRole("COORDINATOR"), isSystem: true,
    },
    {
      code: "TRAINER", name: "Trainer", nameAr: "المدرب", baseType: "TRAINER" as const,
      description: "Training delivery: manage sessions, attendance, pre-test, final-test, evaluations, certificates. No report scheduling, no system settings.",
      permissions: buildPermissionStringsForRole("TRAINER"), isSystem: true,
    },
    {
      code: "AUDITOR", name: "Auditor", nameAr: "المدقق", baseType: "AUDITOR" as const,
      description: "Read-only compliance and audit access across all operational and reporting modules. Cannot mutate any data.",
      permissions: buildPermissionStringsForRole("AUDITOR"), isSystem: true,
    },
  ];
  let rolesCreated = 0;
  let rolesSkipped = 0;
  for (const r of roles) {
    const existing = await db.role.findUnique({ where: { code: r.code } });
    if (existing) {
      // SUPER_ADMIN is always re-synced (preserves original behavior).
      // All other system roles are skipped — manual customizations preserved.
      if (r.code === "SUPER_ADMIN") {
        await db.role.update({
          where: { code: r.code },
          data: { name: r.name, nameAr: r.nameAr, description: r.description, permissions: r.permissions, baseType: r.baseType, isSystem: true },
        });
        console.log(`   ✓ Super Admin role re-synced`);
      } else {
        console.log(`   → ${r.code} role exists — skipped (preserving manual changes)`);
      }
      rolesSkipped++;
    } else {
      await db.role.create({ data: r });
      console.log(`   ✓ Created ${r.code} system role (${r.permissions.length} permissions)`);
      rolesCreated++;
    }
  }
  console.log(`   → ${rolesCreated} created, ${rolesSkipped} skipped/existing`);

  // Backfill roleId for any user whose roleId is null but whose role enum
  // matches a seeded system Role code — self-heals users created before
  // dynamic RBAC (e.g. via /api/users, which never wrote roleId). Idempotent;
  // safe to re-run on every deploy.
  console.log("→ Backfilling roleId for existing users");
  const systemRoles = await db.role.findMany({ where: { isSystem: true } });
  let backfilled = 0;
  for (const role of systemRoles) {
    const { count } = await db.user.updateMany({
      where: { role: role.code as UserRole, roleId: null, deletedAt: null },
      data: { roleId: role.id },
    });
    backfilled += count;
  }
  if (backfilled > 0) console.log(`   ✓ Backfilled roleId for ${backfilled} user(s)`);

  // ─────────────────────────────────────────────────────────────────
  // 3) PERMISSIONS
  // ─────────────────────────────────────────────────────────────────
  console.log("→ Permissions");
  const MODULES_LIST = [
    "dashboard", "companies", "company-contacts", "trainers", "trainer-qualifications",
    "trainees", "courses", "requests", "sessions", "scheduling", "attendance", "qr-code",
    "pre-test", "final-test", "evaluation", "certificates", "reports",
    "notifications", "audit-log", "settings",
  ];
  const ACTIONS = ["view", "create", "edit", "delete"];
  let permCount = 0;
  for (const moduleName of MODULES_LIST) {
    for (const action of ACTIONS) {
      // Some modules are read-only by design
      if (["dashboard", "reports", "audit-log", "evaluation", "notifications"].includes(moduleName) && action !== "view") continue;
      // Settings is admin-only — skip non-view actions at permission level (handled by RBAC)
      await db.permission.upsert({
        where: { code: `${moduleName}.${action}` },
        update: { module: moduleName, action, description: `${action} on ${moduleName}` },
        create: { code: `${moduleName}.${action}`, module: moduleName, action, description: `${action} on ${moduleName}` },
      });
      permCount++;
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 4) SYSTEM SETTINGS
  // ─────────────────────────────────────────────────────────────────
  console.log("→ System settings");
  const defaultSettings = [
    // General
    { key: "system.name", value: "GCCLAB TMS", category: "GENERAL", description: "System display name", isPublic: true },
    { key: "system.defaultLanguage", value: "en", category: "GENERAL", description: "Default UI language", isPublic: true },
    { key: "system.timezone", value: "Asia/Riyadh", category: "GENERAL", description: "Default timezone", isPublic: true },
    { key: "system.dateFormat", value: "YYYY-MM-DD", category: "GENERAL", description: "Date format", isPublic: true },
    // Security
    { key: "security.passwordMinLength", value: "8", category: "SECURITY", description: "Minimum password length", isPublic: false },
    { key: "security.requireUppercase", value: "true", category: "SECURITY", description: "Require uppercase letters", isPublic: false },
    { key: "security.requireNumbers", value: "true", category: "SECURITY", description: "Require numbers", isPublic: false },
    { key: "security.requireSymbols", value: "false", category: "SECURITY", description: "Require symbols", isPublic: false },
    { key: "security.sessionTimeoutMinutes", value: "30", category: "SECURITY", description: "Session timeout (minutes)", isPublic: false },
    { key: "security.twoFactorEnabled", value: "false", category: "SECURITY", description: "Enable 2FA", isPublic: true },
    // Branding
    { key: "branding.primaryColor", value: "#0d9488", category: "BRANDING", description: "Primary brand color", isPublic: true },
    { key: "branding.logoUrl", value: "/logo.svg", category: "BRANDING", description: "Logo URL", isPublic: true },
    // Email
    { key: "email.smtpHost", value: "", category: "EMAIL", description: "SMTP host", isPublic: false },
    { key: "email.smtpPort", value: "587", category: "EMAIL", description: "SMTP port", isPublic: false },
    { key: "email.smtpUser", value: "", category: "EMAIL", description: "SMTP username", isPublic: false },
    { key: "email.smtpFrom", value: "noreply@gcclab.com", category: "EMAIL", description: "From email", isPublic: false },
    // Schedule — Weekly Report timing (configurable by Super Admin)
    { key: "schedule.weekly.enabled", value: "true", category: "NOTIFICATION", description: "Enable weekly scheduled training report", isPublic: false },
    { key: "schedule.weekly.executionTime", value: "09:00", category: "NOTIFICATION", description: "Weekly report execution time (HH:mm, 24h)", isPublic: false },
    { key: "schedule.weekly.dayOfWeek", value: "4", category: "NOTIFICATION", description: "Weekly report day of week (0=Sunday, 4=Thursday)", isPublic: false },
    { key: "schedule.monthly.enabled", value: "true", category: "NOTIFICATION", description: "Enable monthly training completion report", isPublic: false },
    { key: "schedule.monthly.executionTime", value: "09:00", category: "NOTIFICATION", description: "Monthly report execution time (HH:mm, 24h)", isPublic: false },
    { key: "schedule.monthly.dayOfMonth", value: "1", category: "NOTIFICATION", description: "Monthly report day of month (1-31)", isPublic: false },
    { key: "schedule.timezone", value: "Asia/Riyadh", category: "NOTIFICATION", description: "Default timezone for scheduled reports", isPublic: false },
    // Notifications
    { key: "notif.newRequest", value: "true", category: "NOTIFICATION", description: "Notify on new training request", isPublic: false },
    { key: "notif.sessionScheduled", value: "true", category: "NOTIFICATION", description: "Notify when session scheduled", isPublic: false },
    { key: "notif.certIssued", value: "true", category: "NOTIFICATION", description: "Notify on certificate issuance", isPublic: false },
    { key: "notif.qualExpiring", value: "true", category: "NOTIFICATION", description: "Notify on qualification expiring", isPublic: false },
    { key: "notif.lowAttendance", value: "false", category: "NOTIFICATION", description: "Notify on low attendance", isPublic: false },
  ];
  for (const s of defaultSettings) {
    await db.setting.upsert({
      where: { key: s.key },
      update: { value: s.value, category: s.category, description: s.description, isPublic: s.isPublic },
      create: s,
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // 5) SUPER ADMIN ACCOUNT
  // ─────────────────────────────────────────────────────────────────
  console.log("→ Super Admin account");
  // No defaults, by design. A fallback password here would be committed to the
  // repository and printed to every build log, which is how this seed previously
  // shipped a publicly-known admin account to production.
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD;
  if (!adminEmail || !adminPassword) {
    console.error(
      "\n✗ SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD must both be set to seed the super admin.\n" +
        "  Set them in your environment (or the Render dashboard) and re-run.\n"
    );
    process.exit(1);
  }
  if (adminPassword.length < 12) {
    console.error("\n✗ SUPER_ADMIN_PASSWORD must be at least 12 characters.\n");
    process.exit(1);
  }
  const passwordHash = await hashPassword(adminPassword);

  const superAdminRole = await db.role.findUnique({ where: { code: "SUPER_ADMIN" } });

  // SUPER_ADMIN_PASSWORD is authoritative, including for an account that already
  // exists. Skipping the update when the row is present is how a super admin seeded
  // from an old committed default survived into a deploy that had set the env var:
  // the operator believed they had changed the password, and had not.
  const existingAdmin = await db.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await db.user.create({
      data: {
        email: adminEmail,
        fullName: "System Administrator",
        passwordHash,
        role: "SUPER_ADMIN" as UserRole,
        roleId: superAdminRole?.id,
        language: "en",
        isActive: true,
      },
    });
    console.log(`   ✓ Created Super Admin: ${adminEmail}`);
  } else {
    await db.user.update({
      where: { id: existingAdmin.id },
      data: {
        passwordHash,
        role: "SUPER_ADMIN" as UserRole,
        roleId: superAdminRole?.id,
        isActive: true,
        deletedAt: null,
        lockedUntil: null,
        failedLoginAttempts: 0,
      },
    });
    console.log(`   ✓ Super Admin exists: ${adminEmail} — password reset from env.`);
  }
  console.log(`   → Password taken from SUPER_ADMIN_PASSWORD (not logged).`);

  // Any *other* super admin is an account this seed did not create and cannot
  // vouch for — historically the committed demo account with a repo-published
  // password. Deactivating rather than deleting preserves audit-log references.
  const strayAdmins = await db.user.updateMany({
    where: { role: "SUPER_ADMIN", email: { not: adminEmail }, isActive: true },
    data: { isActive: false },
  });
  if (strayAdmins.count > 0) {
    console.log(`   ! Deactivated ${strayAdmins.count} other super admin account(s).`);
  }

  // ─────────────────────────────────────────────────────────────────
  // 5b) DEFAULT ROLE USERS (COMPANY_ADMIN, COORDINATOR, TRAINER, AUDITOR)
  // ─────────────────────────────────────────────────────────────────
  // One default user per operational system role. Created IF MISSING only —
  // existing users are NEVER overwritten (per idempotency requirement).
  //
  // Passwords are TEMPORARY: a random 24-char hex string generated at seed
  // time, printed ONCE to the console, and hashed into the DB. The operator
  // must copy the password from the seed output and use it for first login.
  // forcePasswordChange=true forces a password change on first login so the
  // temporary password is never used long-term.
  //
  // Set SEED_DEFAULT_USERS=false in the env to skip creating these users
  // (useful for production deploys where the operator creates users manually).
  console.log("→ Default role users (COMPANY_ADMIN, COORDINATOR, TRAINER, AUDITOR)");
  const seedDefaultUsers = process.env.SEED_DEFAULT_USERS !== "false";
  let usersCreated = 0;
  let usersSkipped = 0;

  if (!seedDefaultUsers) {
    console.log("   → Skipped (SEED_DEFAULT_USERS=false)");
  } else {
    const defaultUsers = [
      {
        email: "company.admin@gcclab.com",
        fullName: "Default Company Admin",
        role: "COMPANY_ADMIN" as UserRole,
        language: "en",
      },
      {
        email: "coordinator@gcclab.com",
        fullName: "Default Coordinator",
        role: "COORDINATOR" as UserRole,
        language: "en",
      },
      {
        email: "trainer@gcclab.com",
        fullName: "Default Trainer",
        role: "TRAINER" as UserRole,
        language: "en",
      },
      {
        email: "auditor@gcclab.com",
        fullName: "Default Auditor",
        role: "AUDITOR" as UserRole,
        language: "en",
      },
    ];

    const createdPasswords: Array<{ email: string; password: string }> = [];

    for (const u of defaultUsers) {
      const existing = await db.user.findUnique({ where: { email: u.email } });
      if (existing) {
        console.log(`   → ${u.email} exists — skipped (preserving existing account)`);
        usersSkipped++;
        continue;
      }

      // Look up the system role to link roleId
      const roleRow = await db.role.findUnique({ where: { code: u.role } });
      if (!roleRow) {
        console.error(`   ✗ Could not find system role '${u.role}' — run seed again after role creation`);
        continue;
      }

      // Generate a temporary password (24 hex chars = 96 bits of entropy)
      const tempPassword = randomBytes(12).toString("hex");
      const tempHash = await hashPassword(tempPassword);

      await db.user.create({
        data: {
          email: u.email,
          fullName: u.fullName,
          passwordHash: tempHash,
          role: u.role,
          roleId: roleRow.id,
          language: u.language,
          isActive: true,
          accountStatus: "ACTIVE",
          forcePasswordChange: true, // must change on first login
        },
      });
      console.log(`   ✓ Created ${u.role} user: ${u.email}`);
      createdPasswords.push({ email: u.email, password: tempPassword });
      usersCreated++;
    }

    console.log(`   → ${usersCreated} created, ${usersSkipped} skipped/existing`);

    // Print temporary passwords ONCE so the operator can copy them.
    // These are NEVER written to a file — only stdout. The operator must
    // record them immediately. After first login + password change, they
    // are no longer valid.
    if (createdPasswords.length > 0) {
      console.log("");
      console.log("   ╔══════════════════════════════════════════════════════════════╗");
      console.log("   ║  TEMPORARY PASSWORDS — RECORD THESE NOW                  ║");
      console.log("   ║  (Not stored anywhere else. Lost passwords require       ║");
      console.log("   ║   a manual reset via the Super Admin UI.)               ║");
      console.log("   ╠══════════════════════════════════════════════════════════════╣");
      for (const { email, password } of createdPasswords) {
        console.log(`   ║  ${email.padEnd(34)} → ${password}  ║`);
      }
      console.log("   ╚══════════════════════════════════════════════════════════════╝");
      console.log("");
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // 6) DEFAULT REPORT SCHEDULES
  // ─────────────────────────────────────────────────────────────────
  console.log("→ Default report schedules (timing from Settings)");
  // Read timing from Settings — configurable by Super Admin without code changes
  const weeklyEnabled = await db.setting.findUnique({ where: { key: "schedule.weekly.enabled" } });
  const weeklyTime = await db.setting.findUnique({ where: { key: "schedule.weekly.executionTime" } });
  const weeklyDay = await db.setting.findUnique({ where: { key: "schedule.weekly.dayOfWeek" } });
  const monthlyEnabled = await db.setting.findUnique({ where: { key: "schedule.monthly.enabled" } });
  const monthlyTime = await db.setting.findUnique({ where: { key: "schedule.monthly.executionTime" } });
  const monthlyDay = await db.setting.findUnique({ where: { key: "schedule.monthly.dayOfMonth" } });
  const timezoneSetting = await db.setting.findUnique({ where: { key: "schedule.timezone" } });

  const wEnabled = weeklyEnabled?.value !== "false";
  const wTime = weeklyTime?.value ?? "09:00";
  const wDay = parseInt(weeklyDay?.value ?? "4", 10);
  const mEnabled = monthlyEnabled?.value !== "false";
  const mTime = monthlyTime?.value ?? "09:00";
  const mDay = parseInt(monthlyDay?.value ?? "1", 10);
  const tz = timezoneSetting?.value ?? "Asia/Riyadh";

  // Build cron expressions from settings
  const [wHour, wMin] = wTime.split(":").map(Number);
  const [mHour, mMin] = mTime.split(":").map(Number);
  const weeklyCron = `${wMin} ${wHour} * * ${wDay}`;
  const monthlyCron = `${mMin} ${mHour} ${mDay} * *`;

  const defaultSchedules = [
    {
      name: "Weekly Scheduled Training Report",
      nameAr: "التقرير الأسبوعي للجلسات المجدولة",
      description: `Every ${["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][wDay]} at ${wTime} (${tz}) — sends all training sessions scheduled for the following week.`,
      templateCode: "GCCLAB_MONTHLY",
      scheduleType: "WEEKLY",
      cronExpression: weeklyCron,
      executionTime: wTime,
      timezone: tz,
      dayOfWeek: wDay,
      isActive: wEnabled,
      filters: JSON.stringify({}),
      exportFormats: JSON.stringify(["xlsx", "pdf"]),
      recipients: JSON.stringify([]),
      maxRetries: 3,
      retryDelayMin: 10,
    },
    {
      name: "Monthly Training Completion Report",
      nameAr: "التقرير الشهري لإنجازات التدريب",
      description: `Day ${mDay} of every month at ${mTime} (${tz}) — sends completed training results for the previous month.`,
      templateCode: "GCCLAB_MONTHLY",
      scheduleType: "MONTHLY",
      cronExpression: monthlyCron,
      executionTime: mTime,
      timezone: tz,
      dayOfMonth: mDay,
      isActive: mEnabled,
      filters: JSON.stringify({}),
      exportFormats: JSON.stringify(["xlsx", "pdf"]),
      recipients: JSON.stringify([]),
      maxRetries: 3,
      retryDelayMin: 10,
    },
  ];
  for (const s of defaultSchedules) {
    const existing = await db.reportSchedule.findFirst({ where: { name: s.name, deletedAt: null } });
    if (!existing) {
      await db.reportSchedule.create({ data: s as any });
    }
  }

  console.log(`\n✅ Clean seed completed`);
  console.log(`   - Languages: ${languages.length} (English, Arabic)`);
  console.log(`   - Roles: ${roles.length} system roles (SUPER_ADMIN + COMPANY_ADMIN + COORDINATOR + TRAINER + AUDITOR)`);
  console.log(`     · ${rolesCreated} created, ${rolesSkipped} skipped/existing`);
  console.log(`   - Permissions: ${permCount}`);
  console.log(`   - Settings: ${defaultSettings.length}`);
  console.log(`   - Report Schedules: ${defaultSchedules.length}`);
  console.log(`   - Super Admin: 1 (password from SUPER_ADMIN_PASSWORD env)`);
  if (seedDefaultUsers) {
    console.log(`   - Default role users: ${usersCreated} created, ${usersSkipped} skipped/existing`);
  } else {
    console.log(`   - Default role users: skipped (SEED_DEFAULT_USERS=false)`);
  }

  // ─── Sprint 6: Core Mandatory Courses + Compliance Rules ────────────
  // These three courses are ALWAYS mandatory by default:
  //   OHS Orientation, Fire Safety, First Aid
  // Only SUPER_ADMIN can disable them.
  const coreMandatoryCourses = [
    { code: "OHS-001", title: "OHS Orientation", titleAr: "التوجيه المهني للسلامة", validityMonths: 24, durationHours: 4 },
    { code: "FIRE-001", title: "Fire Safety", titleAr: "سلامة الإطفاء", validityMonths: 24, durationHours: 4 },
    { code: "FA-001", title: "First Aid", titleAr: "الإسعافات الأولية", validityMonths: 24, durationHours: 8 },
  ];

  let coreCourseCount = 0;
  let coreRuleCount = 0;
  for (const cmc of coreMandatoryCourses) {
    // Create the course if it doesn't exist
    let course = await db.course.findUnique({ where: { code: cmc.code } });
    if (!course) {
      const courseRef = await nextRefNumber("COURSE");
      course = await db.course.create({
        data: {
          refNumber: courseRef,
          code: cmc.code,
          title: cmc.title,
          titleAr: cmc.titleAr,
          validityMonths: cmc.validityMonths,
          durationHours: cmc.durationHours,
          passScore: 70,
          status: "ACTIVE",
          hasPreTest: true,
          hasFinalTest: true,
          hasEvaluation: true,
        },
      });
      coreCourseCount++;
    }

    // Create the core mandatory compliance rule if it doesn't exist
    const existingRule = await db.complianceRule.findFirst({
      where: { courseId: course.id, scopeType: "ALL", deletedAt: null },
    });
    if (!existingRule) {
      const rule = await db.complianceRule.create({
        data: {
          courseId: course.id,
          isMandatory: true,
          isCoreMandatory: true,
          validityMonths: cmc.validityMonths,
          scopeType: "ALL",
          isActive: true,
        },
      });
      // Record initial version
      await db.complianceRuleVersion.create({
        data: {
          rule: { connect: { id: rule.id } },
          version: 1,
          courseId: course.id,
          isMandatory: true,
          isCoreMandatory: true,
          validityMonths: cmc.validityMonths,
          scopeType: "ALL",
          scopeValue: null,
          scopeLabel: null,
          isActive: true,
          changedBy: existingAdmin?.id ?? "seed",
          changeType: "CREATE",
          reason: "Core mandatory course — auto-seeded",
        },
      });
      coreRuleCount++;
    }
  }
  console.log(`   - Core Mandatory Courses: ${coreCourseCount} created (${coreMandatoryCourses.length} total)`);
  console.log(`   - Core Compliance Rules: ${coreRuleCount} created`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
