// GCCLAB TMS — Clean seed script
// =====================================================================
// Per architecture requirements, we seed ONLY:
//   - Super Admin account
//   - System Roles
//   - Permissions
//   - System Settings
//   - Arabic and English languages
//
// NO sample companies, trainers, courses, requests, sessions, attendance,
// certificates, or exams are seeded. The application starts completely empty
// in production form, ready for real business data entry.

import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/jwt";
import type { UserRole } from "../src/lib/auth/permissions";

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
  console.log("→ System roles");
  const roles = [
    { code: "SUPER_ADMIN", name: "Super Admin", nameAr: "مدير النظام", description: "Platform administration: settings, users, roles, branding, integrations. Also has all operational permissions.", permissions: ["*"], isSystem: true },
    { code: "COORDINATOR", name: "Coordinator", nameAr: "منسق التدريب", description: "Full operational access to all training modules (equivalent to Trainer). No access to Settings.", permissions: ["companies.*", "company-contacts.*", "trainers.*", "trainer-qualifications.*", "trainees.*", "courses.*", "requests.*", "sessions.*", "scheduling.*", "attendance.*", "qr-code.*", "pre-test.*", "final-test.*", "evaluation.view", "certificates.*", "reports.view", "notifications.view", "audit-log.view"], isSystem: true },
    { code: "TRAINER", name: "Trainer", nameAr: "المدرب", description: "Full operational access to all training modules (equivalent to Coordinator). No access to Settings.", permissions: ["companies.*", "company-contacts.*", "trainers.*", "trainer-qualifications.*", "trainees.*", "courses.*", "requests.*", "sessions.*", "scheduling.*", "attendance.*", "qr-code.*", "pre-test.*", "final-test.*", "evaluation.view", "certificates.*", "reports.view", "notifications.view", "audit-log.view"], isSystem: true },
    { code: "CONTRACTOR", name: "Contractor", nameAr: "المقاول (الشركة)", description: "Submit and track training requests for own company only", permissions: ["trainees.view", "trainees.create", "trainees.edit", "requests.view", "requests.create", "certificates.view", "notifications.view"], isSystem: true },
  ];
  for (const r of roles) {
    await db.role.upsert({
      where: { code: r.code },
      update: { name: r.name, nameAr: r.nameAr, description: r.description, permissions: r.permissions, isSystem: true },
      create: r,
    });
  }

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
  const adminEmail = process.env.SUPER_ADMIN_EMAIL || "admin@gcclab.com";
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD || "ChangeMeInProduction!2024";
  const passwordHash = await hashPassword(adminPassword);

  const superAdminRole = await db.role.findUnique({ where: { code: "SUPER_ADMIN" } });

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
    console.log(`   ⚠  Password: ${adminPassword}`);
    console.log(`   ⚠  CHANGE THE PASSWORD IMMEDIATELY AFTER FIRST LOGIN`);
  } else {
    console.log(`   → Super Admin already exists: ${adminEmail}`);
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
  console.log(`   - Roles: ${roles.length} (Super Admin, Coordinator, Trainer, Contractor)`);
  console.log(`   - Permissions: ${permCount}`);
  console.log(`   - Settings: ${defaultSettings.length}`);
  console.log(`   - Report Schedules: ${defaultSchedules.length}`);
  console.log(`   - Super Admin: 1 (no other business data seeded)`);
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
