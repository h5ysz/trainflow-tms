// scripts/seed-test-data.ts
// =====================================================================
// Creates realistic test data: 20 courses, 8 trainers, 10 companies,
// 40 upcoming training sessions across different cities.
//
// IDEMPOTENT: Re-running is safe. Only creates missing records.
// Does NOT modify SUPER_ADMIN, permissions, workflows, or existing data.
// =====================================================================

import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/jwt";
import { nextRefNumber } from "../src/lib/api/ref-number";
import { randomBytes } from "crypto";

async function main() {
  console.log("🌱 Seeding test data...\n");

  // ─── 1. COURSES (20 total — 3 already exist, create 17 more) ──────────
  console.log("→ Courses (target: 20 active)");
  const existingCourseCodes = new Set(
    (await db.course.findMany({ select: { code: true } })).map((c) => c.code)
  );

  const coursesToCreate = [
    // HSE & Safety
    { code: "HSE-001", title: "HSE Orientation", titleAr: "التوجيه الصحي والسلامة", category: "HSE", durationHours: 8, language: "en", validityMonths: 24, passScore: 70 },
    { code: "HSE-002", title: "Working at Heights", titleAr: "العمل على ارتفاعات", category: "HSE", durationHours: 6, language: "bilingual", validityMonths: 12, passScore: 70 },
    { code: "HSE-003", title: "Confined Space Entry", titleAr: "الدخول إلى الأماكن المغلقة", category: "HSE", durationHours: 8, language: "en", validityMonths: 12, passScore: 70 },
    { code: "HSE-004", title: "Hot Work Safety", titleAr: "سلامة الأعمال الساخنة", category: "HSE", durationHours: 4, language: "ar", validityMonths: 12, passScore: 70 },
    { code: "HSE-005", title: "Electrical Safety", titleAr: "السلامة الكهربائية", category: "HSE", durationHours: 6, language: "bilingual", validityMonths: 24, passScore: 70 },
    // First Aid & Medical
    { code: "MED-001", title: "CPR & AED", titleAr: "الإنعاش القلبي الرئوي", category: "MEDICAL", durationHours: 4, language: "en", validityMonths: 12, passScore: 70 },
    { code: "MED-002", title: "Advanced First Aid", titleAr: "الإسعافات الأولية المتقدمة", category: "MEDICAL", durationHours: 16, language: "bilingual", validityMonths: 24, passScore: 70 },
    // Fire Safety
    { code: "FIRE-002", title: "Fire Warden Training", titleAr: "تدريب مراقب الحرائق", category: "FIRE", durationHours: 6, language: "en", validityMonths: 24, passScore: 70 },
    { code: "FIRE-003", title: "Fire Extinguisher Use", titleAr: "استخدام طفاية الحريق", category: "FIRE", durationHours: 2, language: "ar", validityMonths: 12, passScore: 70 },
    // Construction & Industrial
    { code: "CON-001", title: "Scaffolding Safety", titleAr: "سلامة السقالات", category: "CONSTRUCTION", durationHours: 6, language: "bilingual", validityMonths: 12, passScore: 70 },
    { code: "CON-002", title: "Crane & Lifting Operations", titleAr: "عمليات الرافعات والرفع", category: "CONSTRUCTION", durationHours: 8, language: "en", validityMonths: 24, passScore: 70 },
    { code: "CON-003", title: "Excavation Safety", titleAr: "سلامة الحفر", category: "CONSTRUCTION", durationHours: 4, language: "ar", validityMonths: 12, passScore: 70 },
    // Environmental
    { code: "ENV-001", title: "Spill Response", titleAr: "الاستجابة للانسكابات", category: "ENVIRONMENT", durationHours: 4, language: "en", validityMonths: 24, passScore: 70 },
    { code: "ENV-002", title: "Waste Management", titleAr: "إدارة النفايات", category: "ENVIRONMENT", durationHours: 4, language: "bilingual", validityMonths: 24, passScore: 70 },
    // Quality & Process
    { code: "QUAL-001", title: "Permit to Work System", titleAr: "نظام تصاريح العمل", category: "QUALITY", durationHours: 4, language: "en", validityMonths: 12, passScore: 70 },
    { code: "QUAL-002", title: "Risk Assessment", titleAr: "تقييم المخاطر", category: "QUALITY", durationHours: 8, language: "bilingual", validityMonths: 24, passScore: 70 },
    { code: "DRIVE-001", title: "Defensive Driving", titleAr: "القيادة الدفاعية", category: "TRANSPORT", durationHours: 6, language: "ar", validityMonths: 12, passScore: 70 },
  ];

  let coursesCreated = 0;
  for (const c of coursesToCreate) {
    if (existingCourseCodes.has(c.code)) continue;
    const refNumber = await nextRefNumber("COURSE");
    await db.course.create({
      data: {
        refNumber,
        code: c.code,
        title: c.title,
        titleAr: c.titleAr,
        category: c.category,
        durationHours: c.durationHours,
        language: c.language,
        validityMonths: c.validityMonths,
        passScore: c.passScore,
        maxTrainees: 20,
        hasPreTest: true,
        hasFinalTest: true,
        hasEvaluation: true,
        status: "ACTIVE",
      },
    });
    coursesCreated++;
  }
  const totalCourses = await db.course.count();
  console.log(`   ✓ ${coursesCreated} created, ${totalCourses} total (target: 20)`);

  // ─── 2. TRAINERS (8) ──────────────────────────────────────────────────
  console.log("→ Trainers (target: 8)");
  const existingTrainerEmails = new Set(
    (await db.trainer.findMany({ select: { email: true } })).map((t) => t.email).filter(Boolean)
  );

  const trainersData = [
    { nameEn: "Khalid Al-Otaibi", nameAr: "خالد العتيبي", email: "khalid.otaibi@gcclab.test", phone: "+966555000001", nationality: "Saudi", city: "Riyadh" },
    { nameEn: "Ahmed Al-Harbi", nameAr: "أحمد الحربي", email: "ahmed.harbi@gcclab.test", phone: "+966555000002", nationality: "Saudi", city: "Jeddah" },
    { nameEn: "Mohammed Al-Qahtani", nameAr: "محمد القحطاني", email: "mohammed.qahtani@gcclab.test", phone: "+966555000003", nationality: "Saudi", city: "Dammam" },
    { nameEn: "Saeed Al-Ghamdi", nameAr: "سعيد الغامدي", email: "saeed.ghamdi@gcclab.test", phone: "+966555000004", nationality: "Saudi", city: "Riyadh" },
    { nameEn: "Faisal Al-Dossari", nameAr: "فيصل الدوسري", email: "faisal.dossari@gcclab.test", phone: "+966555000005", nationality: "Saudi", city: "Mecca" },
    { nameEn: "Nasser Al-Subaie", nameAr: "ناصر السبيعي", email: "nasser.subaie@gcclab.test", phone: "+966555000006", nationality: "Saudi", city: "Medina" },
    { nameEn: "Abdullah Al-Shahrani", nameAr: "عبدالله الشهري", email: "abdullah.shahrani@gcclab.test", phone: "+966555000007", nationality: "Saudi", city: "Khobar" },
    { nameEn: "Turki Al-Anazi", nameAr: "تركي العنزي", email: "turki.anazi@gcclab.test", phone: "+966555000008", nationality: "Saudi", city: "Jubail" },
  ];

  let trainersCreated = 0;
  const trainerIds: string[] = [];
  for (const t of trainersData) {
    if (t.email && existingTrainerEmails.has(t.email)) {
      const existing = await db.trainer.findFirst({ where: { email: t.email } });
      if (existing) trainerIds.push(existing.id);
      continue;
    }
    const refNumber = await nextRefNumber("TRAINER");
    const trainer = await db.trainer.create({
      data: {
        refNumber,
        nameEn: t.nameEn,
        nameAr: t.nameAr,
        email: t.email,
        phone: t.phone,
        nationality: t.nationality,
        city: t.city,
        status: "ACTIVE",
      },
    });
    trainerIds.push(trainer.id);
    trainersCreated++;
  }
  console.log(`   ✓ ${trainersCreated} created, ${trainerIds.length} available`);

  // ─── 3. CERTIFY TRAINERS FOR COURSES ──────────────────────────────────
  console.log("→ Trainer certifications (each trainer certified for 3-5 courses)");
  const allCourses = await db.course.findMany({ select: { id: true, code: true, title: true, language: true, durationHours: true } });
  let certsCreated = 0;
  for (let i = 0; i < trainerIds.length; i++) {
    const trainerId = trainerIds[i];
    // Each trainer gets certified for 3-5 courses (rotating selection)
    const numCerts = 3 + (i % 3); // 3, 4, or 5
    const startIdx = (i * 3) % allCourses.length;
    for (let j = 0; j < numCerts; j++) {
      const course = allCourses[(startIdx + j) % allCourses.length];
      const existing = await db.trainerCertification.findFirst({
        where: { trainerId, courseId: course.id, deletedAt: null },
      });
      if (existing) continue;
      await db.trainerCertification.create({
        data: {
          trainerId,
          courseId: course.id,
          status: "VALID",
          validFrom: new Date(Date.now() - 90 * 86400000),
          validUntil: new Date(Date.now() + 365 * 86400000),
        },
      });
      certsCreated++;
    }
  }
  console.log(`   ✓ ${certsCreated} certifications created`);

  // ─── 4. COMPANIES (10 — 1 already exists, create 9 more) ──────────────
  console.log("→ Companies (target: 10)");
  const existingCompanyNames = new Set(
    (await db.company.findMany({ select: { name: true } })).map((c) => c.name.toLowerCase())
  );

  const companiesData = [
    { name: "Saudi Aramco Contractors Co.", nameAr: "مقاولو أرامكو السعودية", city: "Dhahran", industry: "Oil & Gas" },
    { name: "Al-Bahr Construction", nameAr: "البحر للمقاولات", city: "Jeddah", industry: "Construction" },
    { name: "Najd Industrial Services", nameAr: "نجد للخدمات الصناعية", city: "Riyadh", industry: "Industrial" },
    { name: "Eastern Province Electric", nameAr: "كهرباء المنطقة الشرقية", city: "Dammam", industry: "Electrical" },
    { name: "Hijaz Trading & Contracting", nameAr: "الحجاز للتجارة والمقاولات", city: "Mecca", industry: "Trading" },
    { name: "Al-Madina Facilities Management", nameAr: "المدينة لإدارة المرافق", city: "Medina", industry: "Facilities" },
    { name: "Royal Building Co.", nameAr: "الرويال للبناء", city: "Khobar", industry: "Construction" },
    { name: "Gulf Petrochemical Services", nameAr: "خدمات الخليج للبتروكيماويات", city: "Jubail", industry: "Petrochemical" },
    { name: "Al-Waha Transport", nameAr: "الواحة للنقل", city: "Riyadh", industry: "Transport" },
  ];

  let companiesCreated = 0;
  const companyIds: string[] = [];
  // Also include the existing company
  const existingCompanies = await db.company.findMany({ select: { id: true, name: true } });
  for (const ec of existingCompanies) companyIds.push(ec.id);

  for (const c of companiesData) {
    if (existingCompanyNames.has(c.name.toLowerCase())) continue;
    const refNumber = await nextRefNumber("COMPANY");
    const company = await db.company.create({
      data: {
        refNumber,
        name: c.name,
        nameAr: c.nameAr,
        city: c.city,
        country: "Saudi Arabia",
        industry: c.industry,
        status: "ACTIVE",
        contactPerson: "Contact Person",
        contactEmail: `info@${c.name.toLowerCase().replace(/[^a-z]/g, "")}.test`,
        contactPhone: "+966555000000",
      },
    });
    companyIds.push(company.id);
    companiesCreated++;
  }
  console.log(`   ✓ ${companiesCreated} created, ${companyIds.length} total`);

  // ─── 5. TRAINING SESSIONS (40 upcoming, different cities/trainers/capacities) ─
  console.log("→ Training Sessions (target: 40)");
  const existingSessionCount = await db.trainingSession.count();

  const cities = ["Riyadh", "Jeddah", "Dammam", "Mecca", "Medina", "Khobar", "Jubail", "Dhahran"];
  const venues = ["GCCLAB Training Center", "Hotel Intercontinental", "Hilton Conference Hall", "Golden Tulip", "Marriott Ballroom", "Crowne Plaza", "Radisson Blu", "On-Site (Client Facility)"];

  const sessionsToCreate = 40 - existingSessionCount;
  let sessionsCreated = 0;

  for (let i = 0; i < Math.max(0, sessionsToCreate); i++) {
    const course = allCourses[i % allCourses.length];
    const trainerId = trainerIds[i % trainerIds.length];
    const cityIdx = i % cities.length;
    const city = cities[cityIdx];
    const venue = venues[i % venues.length];

    // Verify the trainer is certified for this course
    const cert = await db.trainerCertification.findFirst({
      where: { trainerId, courseId: course.id, status: "VALID", deletedAt: null },
    });
    if (!cert) continue; // skip if not certified

    // Dates: spread over next 90 days, morning/evening shifts
    const daysAhead = 3 + Math.floor(i * 2.5); // spread sessions out
    const startDate = new Date(Date.now() + daysAhead * 86400000);
    startDate.setHours(i % 2 === 0 ? 8 : 13, 0, 0, 0); // 8 AM or 1 PM
    const endDate = new Date(startDate.getTime() + (course.durationHours || 8) * 3600000);

    const refNumber = await nextRefNumber("SESSION");
    const capacity = [10, 15, 20, 25, 30][i % 5]; // varying capacities
    const qrToken = randomBytes(16).toString("hex");

    await db.trainingSession.create({
      data: {
        refNumber,
        courseId: course.id,
        trainerId,
        title: `${course.title} — ${city}`,
        city,
        venue,
        region: city, // use city as region for now
        shift: i % 2 === 0 ? "MORNING" : "EVENING",
        capacity,
        expectedTrainees: 0,
        actualTrainees: 0,
        language: course.language,
        startDate,
        endDate,
        durationHours: course.durationHours,
        status: "SCHEDULED",
        lifecycleStatus: "NOT_STARTED",
        qrCodeToken: qrToken,
        qrActiveFrom: new Date(startDate.getTime() - 3600000),
        qrActiveTo: new Date(endDate.getTime() + 3600000),
      },
    });
    sessionsCreated++;
  }
  const totalSessions = await db.trainingSession.count();
  console.log(`   ✓ ${sessionsCreated} created, ${totalSessions} total (target: 40)`);

  // ─── 6. CONTRACTOR USER (if missing) ──────────────────────────────────
  console.log("→ Contractor test user");
  const contractorEmail = "contractor@gcclab.com";
  let contractor = await db.user.findUnique({ where: { email: contractorEmail } });
  if (!contractor) {
    // Create a company for the contractor
    let company = await db.company.findFirst({ where: { name: "Default Contractor Co." } });
    if (!company) {
      const refNumber = await nextRefNumber("COMPANY");
      company = await db.company.create({
        data: {
          refNumber,
          name: "Default Contractor Co.",
          nameAr: "شركة المقاول الافتراضية",
          city: "Riyadh",
          country: "Saudi Arabia",
          status: "ACTIVE",
        },
      });
    }
    const contractorRole = await db.role.findUnique({ where: { code: "CONTRACTOR" } });
    const password = "Contractor@123";
    const hash = await hashPassword(password);
    contractor = await db.user.create({
      data: {
        email: contractorEmail,
        fullName: "Default Contractor",
        passwordHash: hash,
        role: "CONTRACTOR",
        roleId: contractorRole?.id ?? null,
        companyId: company.id,
        language: "en",
        isActive: true,
        accountStatus: "ACTIVE",
        forcePasswordChange: false,
      },
    });
    console.log(`   ✓ Created contractor user: ${contractorEmail} (password: ${password})`);
  } else {
    console.log(`   → Contractor user already exists: ${contractorEmail}`);
  }

  // ─── SUMMARY ──────────────────────────────────────────────────────────
  console.log("\n✅ Test data seeding complete");
  console.log(`   - Courses: ${await db.course.count()}`);
  console.log(`   - Trainers: ${await db.trainer.count()}`);
  console.log(`   - Companies: ${await db.company.count()}`);
  console.log(`   - Training Sessions: ${await db.trainingSession.count()}`);
  console.log(`   - Trainer Certifications: ${await db.trainerCertification.count()}`);
  console.log(`   - Users: ${await db.user.count()}`);

  // Session breakdown
  const sessions = await db.trainingSession.findMany({
    select: { city: true, language: true, capacity: true, status: true },
  });
  const byCity = new Map<string, number>();
  const byLang = new Map<string, number>();
  const capacities = new Set<number>();
  for (const s of sessions) {
    byCity.set(s.city ?? "Unknown", (byCity.get(s.city ?? "Unknown") ?? 0) + 1);
    byLang.set(s.language ?? "Unknown", (byLang.get(s.language ?? "Unknown") ?? 0) + 1);
    capacities.add(s.capacity);
  }
  console.log(`   - Sessions by city: ${[...byCity.entries()].map(([c, n]) => `${c}(${n})`).join(", ")}`);
  console.log(`   - Sessions by language: ${[...byLang.entries()].map(([l, n]) => `${l}(${n})`).join(", ")}`);
  console.log(`   - Distinct capacities: ${[...capacities].sort((a, b) => a - b).join(", ")}`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
