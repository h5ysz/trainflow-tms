// TrainFlow TMS — Seed script
// Run with: bun run db:seed
// Seeds: default settings, demo users, sample companies, trainers, courses.

import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/jwt";
import type { UserRole } from "../src/lib/auth/permissions";

async function main() {
  console.log("🌱 Seeding TrainFlow TMS...\n");

  // 1) Settings
  console.log("→ Settings");
  const defaultSettings = [
    { key: "system.name", value: "TrainFlow TMS", category: "GENERAL", description: "System display name" },
    { key: "system.defaultLanguage", value: "en", category: "GENERAL", description: "Default UI language" },
    { key: "system.timezone", value: "Asia/Riyadh", category: "GENERAL", description: "Default timezone" },
    { key: "system.dateFormat", value: "YYYY-MM-DD", category: "GENERAL", description: "Date format" },
    { key: "security.passwordMinLength", value: "8", category: "SECURITY", description: "Minimum password length" },
    { key: "security.requireUppercase", value: "true", category: "SECURITY", description: "Require uppercase letters" },
    { key: "security.requireNumbers", value: "true", category: "SECURITY", description: "Require numbers" },
    { key: "security.requireSymbols", value: "false", category: "SECURITY", description: "Require symbols" },
    { key: "security.sessionTimeoutMinutes", value: "30", category: "SECURITY", description: "Session timeout" },
    { key: "security.twoFactorEnabled", value: "false", category: "SECURITY", description: "Enable 2FA" },
    { key: "branding.primaryColor", value: "#0d9488", category: "BRANDING", description: "Primary brand color" },
    { key: "branding.logoUrl", value: "/logo.svg", category: "BRANDING", description: "Logo URL" },
    { key: "email.smtpHost", value: "", category: "EMAIL", description: "SMTP host" },
    { key: "email.smtpPort", value: "587", category: "EMAIL", description: "SMTP port" },
    { key: "email.smtpFrom", value: "noreply@trainflow.io", category: "EMAIL", description: "From email" },
  ];
  for (const s of defaultSettings) {
    await db.setting.upsert({
      where: { key: s.key },
      update: {},
      create: s,
    });
  }

  // 2) Demo users (one per role)
  console.log("→ Demo users");
  const passwordHash = await hashPassword("trainflow123");
  const users = [
    { email: "admin@trainflow.io", fullName: "System Administrator", role: "SUPER_ADMIN" as UserRole },
    { email: "coordinator@trainflow.io", fullName: "Sarah Coordinator", role: "COORDINATOR" as UserRole },
    { email: "trainer@trainflow.io", fullName: "Ahmed Trainer", role: "TRAINER" as UserRole },
    { email: "contractor@trainflow.io", fullName: "Khalid Contractor", role: "CONTRACTOR" as UserRole },
  ];
  for (const u of users) {
    await db.user.upsert({
      where: { email: u.email },
      update: {},
      create: { ...u, passwordHash, language: "en", isActive: true },
    });
  }

  // 3) Sample companies (real-looking — for testing only)
  console.log("→ Sample companies");
  const companies = [
    {
      name: "Saudi Build Co.",
      nameAr: "السعودية للبناء",
      legalName: "Saudi Build Co. Ltd.",
      crNumber: "CR-1010101010",
      vatNumber: "VAT-300010101000003",
      industry: "Construction",
      country: "Saudi Arabia",
      city: "Riyadh",
      address: "King Fahd Road, Olaya District",
      postalCode: "11564",
      phone: "+966 11 200 0000",
      email: "info@saudibuild.example",
      website: "https://saudibuild.example",
      contactPerson: "Fahd Al-Qahtani",
      contactPhone: "+966 50 100 0000",
      contactEmail: "fahd@saudibuild.example",
    },
    {
      name: "Gulf Petro Services",
      nameAr: "خدمات الخليج للبترول",
      legalName: "Gulf Petro Services LLC",
      crNumber: "CR-2020202020",
      vatNumber: "VAT-300020202000006",
      industry: "Oil & Gas",
      country: "Saudi Arabia",
      city: "Dammam",
      address: "Industrial Area, Dammam",
      postalCode: "31952",
      phone: "+966 13 300 0000",
      email: "info@gulfpetro.example",
      website: "https://gulfpetro.example",
      contactPerson: "Noura Al-Dossari",
      contactPhone: "+966 55 200 0000",
      contactEmail: "noura@gulfpetro.example",
    },
    {
      name: "Industrial Manufacturing Group",
      nameAr: "مجموعة التصنيع الصناعي",
      legalName: "Industrial Manufacturing Group Co.",
      crNumber: "CR-3030303030",
      vatNumber: "VAT-300030303000009",
      industry: "Manufacturing",
      country: "Saudi Arabia",
      city: "Jeddah",
      address: "2nd Industrial City, Jeddah",
      postalCode: "21442",
      phone: "+966 12 400 0000",
      email: "info@img.example",
      website: "https://img.example",
      contactPerson: "Salem Al-Ghamdi",
      contactPhone: "+966 56 300 0000",
      contactEmail: "salem@img.example",
    },
  ];
  for (const c of companies) {
    const existing = await db.company.findFirst({ where: { crNumber: c.crNumber } });
    if (!existing) {
      await db.company.create({ data: c });
    }
  }

  // Link Khalid Contractor to the first company
  const contractorUser = await db.user.findUnique({ where: { email: "contractor@trainflow.io" } });
  const firstCompany = await db.company.findFirst({ where: { crNumber: "CR-1010101010" } });
  if (contractorUser && firstCompany && !contractorUser.companyId) {
    await db.user.update({
      where: { id: contractorUser.id },
      data: { companyId: firstCompany.id },
    });
  }

  // 4) Sample trainers (real-looking — for testing only)
  console.log("→ Sample trainers");
  const trainers = [
    {
      fullName: "Ahmed Al-Harbi",
      fullNameAr: "أحمد الحربي",
      nationalId: "1000000001",
      email: "ahmed.harbi@trainflow.io",
      phone: "+966 11 500 0001",
      mobile: "+966 50 500 0001",
      gender: "MALE",
      nationality: "Saudi",
      country: "Saudi Arabia",
      city: "Riyadh",
      address: "Al-Malqa District, Riyadh",
      bio: "NEBOSH-certified HSE trainer with 12+ years of experience in construction safety.",
      hireDate: new Date("2020-01-15"),
    },
    {
      fullName: "Mohammed Al-Otaibi",
      fullNameAr: "محمد العتيبي",
      nationalId: "1000000002",
      email: "mohammed.otaibi@trainflow.io",
      phone: "+966 11 500 0002",
      mobile: "+966 50 500 0002",
      gender: "MALE",
      nationality: "Saudi",
      country: "Saudi Arabia",
      city: "Dammam",
      address: "Al-Shati District, Dammam",
      bio: "Fire safety and emergency response specialist. IOSH Member.",
      hireDate: new Date("2021-03-10"),
    },
    {
      fullName: "Layla Al-Shehri",
      fullNameAr: "ليلى الشهري",
      nationalId: "1000000003",
      email: "layla.shehri@trainflow.io",
      phone: "+966 11 500 0003",
      mobile: "+966 50 500 0003",
      gender: "FEMALE",
      nationality: "Saudi",
      country: "Saudi Arabia",
      city: "Jeddah",
      address: "Al-Ruwais District, Jeddah",
      bio: "First aid and CPR instructor certified by Saudi Red Crescent Authority.",
      hireDate: new Date("2022-06-01"),
    },
  ];
  const trainerRecords: { id: string; fullName: string }[] = [];
  for (const t of trainers) {
    const existing = await db.trainer.findUnique({ where: { nationalId: t.nationalId } });
    if (existing) {
      trainerRecords.push({ id: existing.id, fullName: existing.fullName });
    } else {
      const created = await db.trainer.create({ data: { ...t, status: "ACTIVE" } });
      trainerRecords.push({ id: created.id, fullName: created.fullName });
    }
  }
  // Link Ahmed Trainer user → Ahmed Al-Harbi trainer
  const trainerUser = await db.user.findUnique({ where: { email: "trainer@trainflow.io" } });
  if (trainerUser && trainerRecords[0] && !trainerUser.trainerId) {
    await db.user.update({
      where: { id: trainerUser.id },
      data: { trainerId: trainerRecords[0].id },
    });
  }

  // 5) Trainer qualifications
  console.log("→ Trainer qualifications");
  const quals = [
    { trainerIdx: 0, title: "NEBOSH General Certificate", issuer: "NEBOSH", credentialNumber: "NEB-1001", issueDate: "2019-05-01", expiryDate: "2026-05-01" },
    { trainerIdx: 0, title: "OSHA 30-Hour Construction", issuer: "OSHA", credentialNumber: "OSH-2001", issueDate: "2020-02-15" },
    { trainerIdx: 1, title: "Fire Safety Instructor", issuer: "NFPA", credentialNumber: "NFPA-3001", issueDate: "2018-09-01", expiryDate: "2025-09-01" },
    { trainerIdx: 1, title: "Emergency Response Trainer", issuer: "Saudi Civil Defense", credentialNumber: "SCD-4001", issueDate: "2021-04-10" },
    { trainerIdx: 2, title: "First Aid Instructor", issuer: "Saudi Red Crescent Authority", credentialNumber: "SRCA-5001", issueDate: "2022-01-20", expiryDate: "2027-01-20" },
    { trainerIdx: 2, title: "CPR & AED Trainer", issuer: "American Heart Association", credentialNumber: "AHA-6001", issueDate: "2023-03-15" },
  ];
  for (const q of quals) {
    const trainerId = trainerRecords[q.trainerIdx].id;
    const existing = await db.trainerQualification.findFirst({
      where: { trainerId, credentialNumber: q.credentialNumber },
    });
    if (!existing) {
      await db.trainerQualification.create({
        data: {
          trainerId,
          title: q.title,
          issuer: q.issuer,
          credentialNumber: q.credentialNumber,
          issueDate: q.issueDate ? new Date(q.issueDate) : null,
          expiryDate: q.expiryDate ? new Date(q.expiryDate) : null,
          status: q.expiryDate && new Date(q.expiryDate) < new Date() ? "EXPIRED" : "VALID",
        },
      });
    }
  }

  // 6) Sample courses
  console.log("→ Sample courses");
  const courses = [
    {
      code: "HSE-101",
      title: "Basic Workplace Safety",
      titleAr: "السلامة الأساسية في مكان العمل",
      description: "Foundational safety awareness training covering PPE, hazard identification, and emergency procedures.",
      category: "HSE Fundamentals",
      durationHours: 8,
      language: "en",
      validityMonths: 12,
      passScore: 70,
      maxTrainees: 20,
    },
    {
      code: "HSE-201",
      title: "Construction Safety",
      titleAr: "السلامة في البناء",
      description: "Comprehensive construction site safety including fall protection, scaffolding, and heavy equipment.",
      category: "Construction",
      durationHours: 16,
      language: "en",
      validityMonths: 12,
      passScore: 75,
      maxTrainees: 15,
    },
    {
      code: "FIRE-101",
      title: "Fire Safety & Evacuation",
      titleAr: "سلامة الحريق والإخلاء",
      description: "Fire prevention, extinguisher use, and emergency evacuation procedures.",
      category: "Fire Safety",
      durationHours: 6,
      language: "en",
      validityMonths: 24,
      passScore: 70,
      maxTrainees: 25,
    },
    {
      code: "FA-101",
      title: "First Aid & CPR",
      titleAr: "الإسعافات الأولية والإنعاش القلبي الرئوي",
      description: "Basic first aid skills and cardiopulmonary resuscitation techniques.",
      category: "First Aid",
      durationHours: 8,
      language: "en",
      validityMonths: 24,
      passScore: 80,
      maxTrainees: 12,
    },
    {
      code: "HSE-301",
      title: "Working at Heights",
      titleAr: "العمل على ارتفاعات",
      description: "Safe working practices at heights including fall arrest systems and rescue procedures.",
      category: "Construction",
      durationHours: 12,
      language: "bilingual",
      validityMonths: 12,
      passScore: 75,
      maxTrainees: 15,
    },
    {
      code: "HSE-401",
      title: "Confined Space Entry",
      titleAr: "الدخول إلى الأماكن المغلقة",
      description: "Hazard assessment, entry permits, and rescue procedures for confined spaces.",
      category: "Industrial",
      durationHours: 10,
      language: "en",
      validityMonths: 12,
      passScore: 80,
      maxTrainees: 12,
    },
  ];
  for (const c of courses) {
    const existing = await db.course.findUnique({ where: { code: c.code } });
    if (!existing) {
      await db.course.create({
        data: {
          ...c,
          hasPreTest: true,
          hasFinalTest: true,
          hasEvaluation: true,
          status: "ACTIVE",
        },
      });
    }
  }

  console.log("\n✅ Seed completed successfully");
  console.log("   Demo users: admin@/coordinator@/trainer@/contractor@trainflow.io");
  console.log("   Password: trainflow123 (or use role-based login)");
  console.log("   Companies: 3, Trainers: 3, Qualifications: 6, Courses: 6");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
