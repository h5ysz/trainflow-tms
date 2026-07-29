// GCCLAB TMS — DEMO / TEST data seed
// =====================================================================
// This is NOT the production seed. `scripts/seed.ts` stays clean by design
// (roles, permissions, settings, super admin only). This script layers fake
// business data on top of it so the whole app can be exercised end to end:
//
//   Companies → Contacts → Trainees → Requests → Sessions → Enrollments
//     → Attendance → Pre-Test → Final-Test → Evaluation → Certificate
//
// Usage:
//   npm run db:seed:demo            # add demo data
//   npm run db:seed:demo -- --reset # wipe business data first, then add
//
// Refuses to run when NODE_ENV=production unless --force is passed.
//
// Every demo user's password is: Demo@1234

import { PrismaClient } from "@prisma/client";
import type { Course, Trainer, TrainerQualification, Trainee } from "@prisma/client";
import { randomBytes, pbkdf2Sync } from "node:crypto";

const db = new PrismaClient();

// Mirrors src/lib/auth/jwt.ts hashPassword. Inlined rather than imported because
// that module resolves the "@/" alias and throws at load without JWT_SECRET.
const PBKDF2_ITERATIONS = 600_000;
function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256");
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

const RESET = process.argv.includes("--reset");
const FORCE = process.argv.includes("--force");
const DEMO_PASSWORD = "Demo@1234";
const ACTOR = "demo-seed";

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic RNG — reruns produce the same data, so screenshots and
// bug reports stay reproducible.
// ─────────────────────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260709);
const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T,>(arr: readonly T[]): T => arr[int(0, arr.length - 1)];
const chance = (p: number) => rand() < p;
const shuffled = <T,>(arr: readonly T[]): T[] => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = int(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const DAY = 24 * 60 * 60 * 1000;
const now = new Date();
const daysFromNow = (d: number) => new Date(now.getTime() + d * DAY);
const atHour = (d: Date, h: number) => {
  const c = new Date(d);
  c.setHours(h, 0, 0, 0);
  return c;
};

// ─────────────────────────────────────────────────────────────────────────────
// Ref numbers — local counters that stay in sync with RefNumberCounter so the
// app keeps issuing non-colliding refs after the seed.
// ─────────────────────────────────────────────────────────────────────────────
const pad = (n: number) => n.toString().padStart(6, "0");
const YEAR = now.getFullYear();

async function refNumber(
  entityType: "TRAINING_REQUEST" | "CERTIFICATE" | "EXAM" | "TRAINER" | "COMPANY" | "COURSE" | "SESSION" | "TRAINEE",
): Promise<string> {
  const prefixes = {
    TRAINING_REQUEST: "TR", CERTIFICATE: "CERT", EXAM: "EXAM",
    TRAINER: "TRN", COMPANY: "COM", COURSE: "CRS", SESSION: "SES", TRAINEE: "TRA",
  } as const;
  const yearly = entityType === "TRAINING_REQUEST" || entityType === "CERTIFICATE" || entityType === "EXAM";
  const yearKey = yearly ? YEAR : 0;
  const counter = await db.refNumberCounter.upsert({
    where: { entityType_year: { entityType, year: yearKey } },
    update: { sequence: { increment: 1 } },
    create: { entityType, year: yearKey, sequence: 1 },
  });
  return yearly
    ? `${prefixes[entityType]}-${YEAR}-${pad(counter.sequence)}`
    : `${prefixes[entityType]}-${pad(counter.sequence)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Name pools
// ─────────────────────────────────────────────────────────────────────────────
const FIRST_NAMES = [
  "Abdullah", "Mohammed", "Faisal", "Khalid", "Omar", "Yousef", "Salem", "Nasser",
  "Turki", "Bandar", "Majed", "Saud", "Hamad", "Ibrahim", "Ahmed", "Rayan",
  "Ziyad", "Waleed", "Tariq", "Fahad", "Sultan", "Rakan", "Anas", "Bilal",
  "Hassan", "Mustafa", "Adel", "Ammar", "Basel", "Ghassan", "Imran", "Jamal",
];
const LAST_NAMES = [
  "Al-Harbi", "Al-Qahtani", "Al-Otaibi", "Al-Ghamdi", "Al-Zahrani", "Al-Shehri",
  "Al-Dossari", "Al-Anzi", "Al-Mutairi", "Al-Subaie", "Al-Rashidi", "Al-Malki",
  "Al-Amri", "Al-Juhani", "Al-Balawi", "Haddad", "Nasser", "Khoury", "Mansour",
];
const NATIONALITIES = ["Saudi", "Egyptian", "Indian", "Pakistani", "Jordanian", "Filipino", "Sudanese", "Yemeni"];
const JOB_TITLES = [
  "Site Engineer", "Safety Officer", "Electrician", "Welder", "Rigger", "Scaffolder",
  "Crane Operator", "Foreman", "Technician", "Maintenance Supervisor", "Warehouse Keeper",
  "Pipefitter", "Mechanic", "HSE Coordinator", "Quality Inspector",
];

const usedNames = new Set<string>();
function personName(): string {
  for (let i = 0; i < 200; i++) {
    const n = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    if (!usedNames.has(n)) {
      usedNames.add(n);
      return n;
    }
  }
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)} ${usedNames.size}`;
}

let nationalIdSeq = 1088000000;
const nextNationalId = () => String(++nationalIdSeq);
let mobileSeq = 500100000;
const nextMobile = () => `+9665${String(++mobileSeq).slice(1)}`;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");

// ─────────────────────────────────────────────────────────────────────────────
// Static catalogs
// ─────────────────────────────────────────────────────────────────────────────
const COMPANIES = [
  { name: "Arabian Gulf Contracting Co.", nameAr: "شركة الخليج العربي للمقاولات", industry: "Construction", city: "Dammam" },
  { name: "Najd Petrochemical Industries", nameAr: "صناعات نجد البتروكيماوية", industry: "Petrochemical", city: "Jubail" },
  { name: "Red Sea Marine Services", nameAr: "خدمات البحر الأحمر البحرية", industry: "Marine & Logistics", city: "Jeddah" },
  { name: "Riyadh Power Solutions", nameAr: "حلول الرياض للطاقة", industry: "Utilities", city: "Riyadh" },
  { name: "Tabuk Facilities Management", nameAr: "تبوك لإدارة المرافق", industry: "Facilities", city: "Tabuk" },
];

const COURSES = [
  { code: "HSE-101", title: "Basic Occupational Safety", titleAr: "السلامة المهنية الأساسية", category: "Safety", durationHours: 8, validityMonths: 24, passScore: 70, maxTrainees: 20 },
  { code: "HSE-205", title: "Working at Height", titleAr: "العمل على المرتفعات", category: "Safety", durationHours: 16, validityMonths: 12, passScore: 75, maxTrainees: 16 },
  { code: "HSE-310", title: "Confined Space Entry", titleAr: "الدخول إلى الأماكن المغلقة", category: "Safety", durationHours: 16, validityMonths: 12, passScore: 80, maxTrainees: 12 },
  { code: "FIR-120", title: "Fire Warden & Emergency Response", titleAr: "مسؤول الحريق والاستجابة للطوارئ", category: "Emergency", durationHours: 8, validityMonths: 12, passScore: 70, maxTrainees: 20 },
  { code: "MED-100", title: "First Aid & CPR", titleAr: "الإسعافات الأولية والإنعاش القلبي", category: "Medical", durationHours: 12, validityMonths: 24, passScore: 75, maxTrainees: 15 },
  { code: "ELC-240", title: "Electrical Safety & LOTO", titleAr: "السلامة الكهربائية وإجراءات العزل", category: "Technical", durationHours: 16, validityMonths: 12, passScore: 80, maxTrainees: 14 },
];

// Six pre-test + six final-test questions per course, generated from a shared bank
// of safety concepts so exam-taking flows have real content to render.
const QUESTION_BANK = [
  { text: "What is the first step before starting any high-risk task?", options: ["Obtain a valid work permit", "Inform a colleague", "Start and adjust later", "Wait for the supervisor to leave"], correct: [0], difficulty: "EASY" },
  { text: "Personal Protective Equipment (PPE) is the first line of defence against hazards.", options: ["True", "False"], correct: [1], difficulty: "MEDIUM", type: "TRUE_FALSE" },
  { text: "Which of the following are recognised hazard controls?", options: ["Elimination", "Substitution", "Engineering controls", "Ignoring the hazard"], correct: [0, 1, 2], difficulty: "MEDIUM", type: "MULTIPLE_CHOICE" },
  { text: "Who has the authority to stop unsafe work on site?", options: ["Only the site manager", "Any worker", "Only the HSE department", "Only the client representative"], correct: [1], difficulty: "EASY" },
  { text: "What does a red safety sign normally indicate?", options: ["Mandatory action", "Prohibition or fire equipment", "Safe condition", "General information"], correct: [1], difficulty: "EASY" },
  { text: "How often should safety equipment be inspected?", options: ["Once a year", "Before each use and on a scheduled basis", "Only after an incident", "Never, if it looks fine"], correct: [1], difficulty: "MEDIUM" },
  { text: "Which document lists the hazards of a chemical substance?", options: ["Safety Data Sheet (SDS)", "Purchase order", "Delivery note", "Site diary"], correct: [0], difficulty: "EASY" },
  { text: "A near-miss does not need to be reported because nobody was hurt.", options: ["True", "False"], correct: [1], difficulty: "EASY", type: "TRUE_FALSE" },
  { text: "What is the correct order of the hierarchy of controls?", options: ["PPE → Admin → Engineering → Elimination", "Elimination → Substitution → Engineering → Admin → PPE", "Engineering → PPE → Elimination", "Admin → PPE → Substitution"], correct: [1], difficulty: "HARD" },
  { text: "During an emergency evacuation you should:", options: ["Collect your belongings first", "Use the lift", "Proceed to the designated assembly point", "Return to check on equipment"], correct: [2], difficulty: "EASY" },
  { text: "Which factors increase the risk of heat stress on site?", options: ["High humidity", "Heavy PPE", "Insufficient hydration", "Working in shade"], correct: [0, 1, 2], difficulty: "HARD", type: "MULTIPLE_CHOICE" },
  { text: "A permit to work expires when:", options: ["The task is finished or the permit period ends", "The worker takes a break", "The shift supervisor changes", "It never expires"], correct: [0], difficulty: "MEDIUM" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Reset
// ─────────────────────────────────────────────────────────────────────────────
async function resetBusinessData() {
  console.log("→ Resetting business data (roles, permissions, settings, super admin kept)");
  await db.certificateVerification.deleteMany({});
  await db.certificate.deleteMany({});
  await db.courseEvaluation.deleteMany({});
  await db.examAttempt.deleteMany({});
  await db.testResult.deleteMany({});
  await db.checkInAttempt.deleteMany({});
  await db.attendance.deleteMany({});
  await db.sessionLifecycleEvent.deleteMany({});
  await db.sessionEnrollment.deleteMany({});
  await db.sessionCompany.deleteMany({});
  await db.trainingSession.deleteMany({});
  await db.trainingRequestCourseTrainee.deleteMany({});
  await db.trainingRequestCourse.deleteMany({});
  await db.trainingRequest.deleteMany({});
  await db.question.deleteMany({});
  await db.trainerCertification.deleteMany({});
  await db.trainerQualification.deleteMany({});
  await db.notification.deleteMany({});
  await db.auditLog.deleteMany({});
  await db.loginHistory.deleteMany({});
  await db.user.deleteMany({ where: { role: { not: "SUPER_ADMIN" } } });
  await db.trainee.deleteMany({});
  await db.companyContact.deleteMany({});
  await db.trainer.deleteMany({});
  await db.company.deleteMany({});
  await db.course.deleteMany({});
  await db.refNumberCounter.deleteMany({});
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  if (process.env.NODE_ENV === "production" && !FORCE) {
    throw new Error("Refusing to seed demo data with NODE_ENV=production (pass --force to override)");
  }

  console.log("🌱 Seeding GCCLAB TMS DEMO data...\n");
  if (RESET) await resetBusinessData();

  const passwordHash = hashPassword(DEMO_PASSWORD);
  const roles = await db.role.findMany();
  const roleId = (code: string) => roles.find((r) => r.code === code)?.id;
  if (!roleId("SUPER_ADMIN")) {
    throw new Error("System roles missing — run `bun run db:seed` first, then this script.");
  }

  // ── COURSES ────────────────────────────────────────────────────────────
  console.log("→ Courses + question bank");
  const courses: Course[] = [];
  for (const c of COURSES) {
    const course = await db.course.create({
      data: {
        refNumber: await refNumber("COURSE"),
        code: c.code,
        title: c.title,
        titleAr: c.titleAr,
        description: `${c.title} — a ${c.durationHours}-hour certified programme covering regulations, hazard identification, and practical field application.`,
        category: c.category,
        durationHours: c.durationHours,
        validityMonths: c.validityMonths,
        passScore: c.passScore,
        maxTrainees: c.maxTrainees,
        hasPreTest: true,
        hasFinalTest: true,
        hasEvaluation: true,
        status: "ACTIVE",
        createdBy: ACTOR,
      },
    });
    courses.push(course);

    for (const testType of ["PRE_TEST", "FINAL_TEST"] as const) {
      const bank = shuffled(QUESTION_BANK).slice(0, 6);
      for (const [i, q] of bank.entries()) {
        await db.question.create({
          data: {
            courseId: course.id,
            type: (q.type ?? "SINGLE_CHOICE") as any,
            testType,
            text: q.text,
            options: JSON.stringify(q.options),
            correctAnswers: JSON.stringify(q.correct),
            points: 1,
            order: i + 1,
            isActive: true,
            category: c.category,
            difficulty: q.difficulty,
            source: "MANUAL",
            createdBy: ACTOR,
          },
        });
      }
    }
  }

  // ── TRAINERS ───────────────────────────────────────────────────────────
  console.log("→ Trainers + qualifications + course certifications");
  const trainers: Trainer[] = [];
  for (let i = 0; i < 5; i++) {
    const fullName = personName();
    const trainer = await db.trainer.create({
      data: {
        refNumber: await refNumber("TRAINER"),
        fullName,
        nationalId: nextNationalId(),
        email: `${slug(fullName)}@gcclab.com`,
        phone: nextMobile(),
        mobile: nextMobile(),
        gender: "MALE",
        nationality: pick(NATIONALITIES),
        country: "Saudi Arabia",
        city: pick(["Riyadh", "Jeddah", "Dammam", "Jubail"]),
        bio: `Certified HSE instructor with ${int(6, 20)} years of field and classroom experience across industrial and construction sectors.`,
        status: "ACTIVE",
        hireDate: daysFromNow(-int(400, 2500)),
        createdBy: ACTOR,
      },
    });
    trainers.push(trainer);

    // One expiring-soon and one expired qualification exist across the set so the
    // qualification-expiry warnings have something to surface.
    const qualSpecs = [
      { title: "NEBOSH International General Certificate", issuer: "NEBOSH", offsetDays: int(200, 900) },
      { title: "OSHA 30-Hour General Industry", issuer: "OSHA Training Institute", offsetDays: i === 1 ? 20 : int(120, 700) },
      { title: "Certified Train-the-Trainer", issuer: "IOSH", offsetDays: i === 3 ? -30 : int(300, 1200) },
    ];
    const quals: TrainerQualification[] = [];
    for (const q of qualSpecs) {
      const expiry = daysFromNow(q.offsetDays);
      const status = q.offsetDays < 0 ? "EXPIRED" : q.offsetDays <= 60 ? "EXPIRING_SOON" : "VALID";
      quals.push(
        await db.trainerQualification.create({
          data: {
            trainerId: trainer.id,
            title: q.title,
            issuer: q.issuer,
            credentialNumber: `${q.issuer.slice(0, 3).toUpperCase()}-${int(100000, 999999)}`,
            issueDate: daysFromNow(q.offsetDays - 730),
            expiryDate: expiry,
            status,
            createdBy: ACTOR,
          },
        }),
      );
    }

    // Certify each trainer for a subset of courses (every course gets ≥2 trainers)
    for (const course of shuffled(courses).slice(0, int(3, 5))) {
      await db.trainerCertification.create({
        data: {
          trainerId: trainer.id,
          courseId: course.id,
          qualificationId: quals[0].id,
          validFrom: daysFromNow(-int(200, 800)),
          validUntil: daysFromNow(int(200, 900)),
          status: "VALID",
          createdBy: ACTOR,
        },
      });
    }

    await db.user.create({
      data: {
        email: trainer.email!,
        passwordHash,
        fullName,
        phone: trainer.mobile,
        jobTitle: "Trainer",
        role: "TRAINER",
        roleId: roleId("TRAINER"),
        trainerId: trainer.id,
        isActive: true,
        accountStatus: "ACTIVE",
        lastLoginAt: daysFromNow(-int(0, 14)),
        createdBy: ACTOR,
      },
    });
  }

  // Guarantee every course has at least one certified trainer.
  for (const course of courses) {
    const count = await db.trainerCertification.count({ where: { courseId: course.id } });
    if (count === 0) {
      await db.trainerCertification.create({
        data: { trainerId: trainers[0].id, courseId: course.id, validFrom: daysFromNow(-100), validUntil: daysFromNow(500), status: "VALID", createdBy: ACTOR },
      });
    }
  }
  const trainersForCourse = async (courseId: string) => {
    const certs = await db.trainerCertification.findMany({ where: { courseId, status: "VALID" } });
    return certs.map((c) => trainers.find((t) => t.id === c.trainerId)!).filter(Boolean);
  };

  // ── COORDINATOR ────────────────────────────────────────────────────────
  console.log("→ Coordinator user");
  await db.user.create({
    data: {
      email: "coordinator@gcclab.com",
      passwordHash,
      fullName: "Layla Al-Faisal",
      phone: nextMobile(),
      jobTitle: "Training Coordinator",
      role: "COORDINATOR",
      roleId: roleId("COORDINATOR"),
      isActive: true,
      accountStatus: "ACTIVE",
      lastLoginAt: daysFromNow(-1),
      createdBy: ACTOR,
    },
  });

  // ── COMPANIES + CONTACTS + TRAINEES + CONTRACTOR USERS ─────────────────
  console.log("→ Companies, contacts, trainees, contractor users");
  const companies: { id: string; name: string; trainees: { id: string; fullName: string; nationalId: string; email: string | null }[] }[] = [];
  for (const [ci, c] of COMPANIES.entries()) {
    const domain = `${slug(c.name).split(".").slice(0, 2).join("")}.com`;
    const company = await db.company.create({
      data: {
        refNumber: await refNumber("COMPANY"),
        name: c.name,
        nameAr: c.nameAr,
        legalName: `${c.name} LLC`,
        crNumber: String(int(1010000000, 4030999999)),
        vatNumber: `3${int(10000000000, 99999999999)}`,
        industry: c.industry,
        country: "Saudi Arabia",
        city: c.city,
        address: `${int(1000, 9999)} King Fahd Road, ${c.city}`,
        postalCode: String(int(11000, 34999)),
        phone: nextMobile(),
        email: `info@${domain}`,
        website: `https://www.${domain}`,
        status: ci === 4 ? "INACTIVE" : "ACTIVE",
        createdBy: ACTOR,
      },
    });

    // Contacts — first one is primary
    const contactCount = int(2, 3);
    let primaryContact: { fullName: string; email: string } | null = null;
    for (let k = 0; k < contactCount; k++) {
      const fullName = personName();
      const email = `${slug(fullName)}@${domain}`;
      await db.companyContact.create({
        data: {
          companyId: company.id,
          fullName,
          jobTitle: pick(["HSE Manager", "Training Coordinator", "HR Manager", "Operations Manager"]),
          email,
          phone: nextMobile(),
          mobile: nextMobile(),
          preferredContact: pick(["EMAIL", "MOBILE", "WHATSAPP"]),
          isPrimary: k === 0,
          isActive: true,
          createdBy: ACTOR,
        },
      });
      if (k === 0) primaryContact = { fullName, email };
    }
    await db.company.update({
      where: { id: company.id },
      data: { contactPerson: primaryContact!.fullName, contactEmail: primaryContact!.email, contactPhone: nextMobile() },
    });

    // Contractor login for this company
    await db.user.create({
      data: {
        email: primaryContact!.email,
        passwordHash,
        fullName: primaryContact!.fullName,
        phone: nextMobile(),
        jobTitle: "HSE Manager",
        role: "CONTRACTOR",
        roleId: roleId("CONTRACTOR"),
        companyId: company.id,
        isActive: ci !== 4,
        accountStatus: ci === 4 ? "SUSPENDED" : "ACTIVE",
        lastLoginAt: chance(0.8) ? daysFromNow(-int(0, 21)) : null,
        createdBy: ACTOR,
      },
    });

    // Trainees
    const trainees: Trainee[] = [];
    for (let k = 0; k < int(18, 26); k++) {
      const fullName = personName();
      trainees.push(
        await db.trainee.create({
          data: {
            refNumber: await refNumber("TRAINEE"),
            fullName,
            nationalId: nextNationalId(),
            nationality: pick(NATIONALITIES),
            jobTitle: pick(JOB_TITLES),
            mobile: nextMobile(),
            email: `${slug(fullName)}@${domain}`,
            companyId: company.id,
            status: chance(0.93) ? "ACTIVE" : "INACTIVE",
            createdBy: ACTOR,
          },
        }),
      );
    }
    companies.push({ id: company.id, name: company.name, trainees });
  }

  // One pending-approval contractor registration, so the approvals queue is not empty.
  await db.user.create({
    data: {
      email: "pending.contractor@newvendor.com",
      passwordHash,
      fullName: "Saif Al-Nuaimi",
      phone: nextMobile(),
      jobTitle: "Safety Lead",
      role: "CONTRACTOR",
      roleId: roleId("CONTRACTOR"),
      isActive: false,
      accountStatus: "PENDING_APPROVAL",
      registrationData: JSON.stringify({
        companyName: "New Vendor Industrial Services",
        crNumber: "4030887711",
        contactPerson: "Saif Al-Nuaimi",
        nationalId: nextNationalId(),
        mobile: nextMobile(),
      }),
      createdBy: ACTOR,
    },
  });

  // ── TRAINING REQUESTS ──────────────────────────────────────────────────
  console.log("→ Training requests (all workflow states)");
  type ReqPlan = { status: string; offset: number; makeSession: boolean; sessionStatus?: string };
  const REQUEST_PLANS: ReqPlan[] = [
    { status: "COMPLETED", offset: -75, makeSession: true, sessionStatus: "COMPLETED" },
    { status: "COMPLETED", offset: -55, makeSession: true, sessionStatus: "COMPLETED" },
    { status: "COMPLETED", offset: -38, makeSession: true, sessionStatus: "COMPLETED" },
    { status: "IN_PROGRESS", offset: -12, makeSession: true, sessionStatus: "IN_PROGRESS" },
    { status: "SCHEDULED", offset: -6, makeSession: true, sessionStatus: "SCHEDULED" },
    { status: "SCHEDULED", offset: -4, makeSession: true, sessionStatus: "SCHEDULED" },
    { status: "APPROVED", offset: -3, makeSession: false },
    { status: "UNDER_REVIEW", offset: -2, makeSession: false },
    { status: "SUBMITTED", offset: -1, makeSession: false },
    { status: "DRAFT", offset: 0, makeSession: false },
    { status: "REJECTED", offset: -20, makeSession: false },
    { status: "CANCELLED", offset: -30, makeSession: false },
  ];

  const sessionsToBuild: {
    sessionId: string;
    courseId: string;
    status: string;
    traineeIds: string[];
    startDate: Date;
  }[] = [];

  for (const [i, plan] of REQUEST_PLANS.entries()) {
    const company = companies[i % companies.length];
    const course = courses[i % courses.length];
    const created = daysFromNow(plan.offset - 7);

    const traineePool = shuffled(company.trainees).slice(0, int(10, Math.min(course.maxTrainees, 18)));

    const request = await db.trainingRequest.create({
      data: {
        refNumber: await refNumber("TRAINING_REQUEST"),
        companyId: company.id,
        courseId: course.id,
        traineeCount: traineePool.length,
        preferredDateFrom: daysFromNow(plan.offset),
        preferredDateTo: daysFromNow(plan.offset + 5),
        preferredLocation: pick(["Client Site", "GCCLAB Training Centre", "Onsite — Plant 2"]),
        preferredLanguage: chance(0.7) ? "en" : "ar",
        notes: `Requested by ${company.name} for the ${course.title} programme.`,
        status: plan.status as any,
        priority: pick(["LOW", "NORMAL", "NORMAL", "HIGH", "URGENT"]),
        createdAt: created,
        submittedAt: plan.status === "DRAFT" ? null : created,
        reviewedAt: ["UNDER_REVIEW", "APPROVED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "REJECTED"].includes(plan.status) ? daysFromNow(plan.offset - 5) : null,
        approvedAt: ["APPROVED", "SCHEDULED", "IN_PROGRESS", "COMPLETED"].includes(plan.status) ? daysFromNow(plan.offset - 4) : null,
        scheduledAt: ["SCHEDULED", "IN_PROGRESS", "COMPLETED"].includes(plan.status) ? daysFromNow(plan.offset - 3) : null,
        startedAt: ["IN_PROGRESS", "COMPLETED"].includes(plan.status) ? daysFromNow(plan.offset) : null,
        completedAt: plan.status === "COMPLETED" ? daysFromNow(plan.offset + 2) : null,
        cancelledAt: plan.status === "CANCELLED" ? daysFromNow(plan.offset + 1) : null,
        rejectedAt: plan.status === "REJECTED" ? daysFromNow(plan.offset + 1) : null,
        rejectionReason: plan.status === "REJECTED" ? "Trainee count below the minimum of 10 for this course." : null,
        createdBy: ACTOR,
      },
    });

    const requestCourse = await db.trainingRequestCourse.create({
      data: {
        requestId: request.id,
        courseId: course.id,
        traineeCount: traineePool.length,
        minTrainees: 10,
        maxTrainees: course.maxTrainees,
        createdBy: ACTOR,
      },
    });
    for (const t of traineePool) {
      await db.trainingRequestCourseTrainee.create({
        data: { requestCourseId: requestCourse.id, traineeId: t.id, createdBy: ACTOR },
      });
    }

    if (!plan.makeSession) continue;

    const eligible = await trainersForCourse(course.id);
    const trainer = eligible.length ? pick(eligible) : trainers[0];
    const startDate = atHour(daysFromNow(plan.offset), 8);
    const endDate = atHour(daysFromNow(plan.offset + Math.max(1, Math.ceil(course.durationHours / 8)) - 1), 15);
    const city = pick(["Riyadh", "Jeddah", "Dammam", "Jubail"]);

    const session = await db.trainingSession.create({
      data: {
        refNumber: await refNumber("SESSION"),
        courseId: course.id,
        requestId: request.id,
        requestCourseId: requestCourse.id,
        trainerId: trainer.id,
        title: `${course.title} — ${company.name}`,
        location: `${city} Training Centre`,
        city,
        region: pick(["Central", "Western", "Eastern"]),
        venue: `Hall ${pick(["A", "B", "C"])}`,
        shift: chance(0.75) ? "MORNING" : "EVENING",
        durationHours: course.durationHours,
        capacity: course.maxTrainees,
        language: "en",
        startDate,
        endDate,
        expectedTrainees: traineePool.length,
        actualTrainees: plan.sessionStatus === "SCHEDULED" ? 0 : traineePool.length,
        status: plan.sessionStatus as any,
        qrCodeToken: `qr-${request.refNumber.toLowerCase()}-${int(100000, 999999)}`,
        qrCodeGeneratedAt: startDate,
        qrActiveFrom: startDate,
        qrActiveTo: endDate,
        lifecycleStatus: plan.sessionStatus === "COMPLETED" ? "COMPLETED" : plan.sessionStatus === "IN_PROGRESS" ? "STARTED" : "NOT_STARTED",
        startedAt: plan.sessionStatus === "SCHEDULED" ? null : startDate,
        completedAt: plan.sessionStatus === "COMPLETED" ? endDate : null,
        createdBy: ACTOR,
      },
    });

    if (plan.sessionStatus !== "SCHEDULED") {
      await db.sessionLifecycleEvent.create({ data: { sessionId: session.id, eventType: "STARTED", eventTime: startDate, createdBy: ACTOR } });
      if (plan.sessionStatus === "COMPLETED") {
        await db.sessionLifecycleEvent.create({ data: { sessionId: session.id, eventType: "BREAK", eventTime: atHour(startDate, 11), createdBy: ACTOR } });
        await db.sessionLifecycleEvent.create({ data: { sessionId: session.id, eventType: "RESUMED", eventTime: atHour(startDate, 12), createdBy: ACTOR } });
        await db.sessionLifecycleEvent.create({ data: { sessionId: session.id, eventType: "COMPLETED", eventTime: endDate, createdBy: ACTOR } });
      }
    }

    await db.sessionCompany.create({
      data: { sessionId: session.id, companyId: company.id, traineeCount: traineePool.length, createdBy: ACTOR },
    });

    sessionsToBuild.push({
      sessionId: session.id,
      courseId: course.id,
      status: plan.sessionStatus!,
      traineeIds: traineePool.map((t) => t.id),
      startDate,
    });
  }

  // ── ENROLLMENTS → ATTENDANCE → EXAMS → EVALUATIONS → CERTIFICATES ──────
  console.log("→ Enrollments, attendance, exams, evaluations, certificates");
  let certCount = 0;
  let examCount = 0;

  for (const s of sessionsToBuild) {
    const course = courses.find((c) => c.id === s.courseId)!;
    const session = await db.trainingSession.findUniqueOrThrow({ where: { id: s.sessionId } });
    const questions = await db.question.findMany({ where: { courseId: course.id } });

    for (const traineeId of s.traineeIds) {
      const trainee = await db.trainee.findUniqueOrThrow({ where: { id: traineeId } });

      // Not-yet-run sessions only have pending enrollments.
      if (s.status === "SCHEDULED") {
        await db.sessionEnrollment.create({
          data: {
            sessionId: s.sessionId,
            traineeId,
            companyId: trainee.companyId,
            enrollmentStatus: "CONFIRMED",
            enrolledBy: ACTOR,
            enrollmentDate: daysFromNow(-int(3, 10)),
            attendanceStatus: "NOT_STARTED",
            preTestStatus: "PENDING",
            finalTestStatus: "PENDING",
            evaluationStatus: "PENDING",
            certificateStatus: "NOT_ELIGIBLE",
            createdBy: ACTOR,
          },
        });
        continue;
      }

      const absent = chance(0.07);
      const late = !absent && chance(0.12);
      const attendanceStatus = absent ? "ABSENT" : late ? "LATE" : "PRESENT";
      const completed = s.status === "COMPLETED" && !absent;

      const attendance = await db.attendance.create({
        data: {
          sessionId: s.sessionId,
          traineeName: trainee.fullName,
          traineeIdNational: trainee.nationalId,
          traineeEmail: trainee.email,
          traineePhone: trainee.mobile,
          company: companies.find((c) => c.id === trainee.companyId)!.name,
          companyId: trainee.companyId,
          checkInAt: absent ? null : new Date(s.startDate.getTime() + (late ? int(20, 55) : -int(2, 25)) * 60000),
          checkOutAt: completed ? new Date(session.endDate) : null,
          status: absent ? "ABSENT" : late ? "LATE" : "PRESENT",
          checkInMethod: absent ? null : chance(0.8) ? "QR" : "MANUAL",
          deviceInfo: absent ? null : JSON.stringify({ platform: pick(["iOS", "Android"]), ipAddress: `10.0.${int(0, 20)}.${int(2, 250)}` }),
          createdBy: ACTOR,
        },
      });

      await db.checkInAttempt.create({
        data: {
          sessionId: s.sessionId,
          qrToken: session.qrCodeToken,
          traineeName: trainee.fullName,
          traineeEmail: trainee.email,
          traineeIdNational: trainee.nationalId,
          ipAddress: `10.0.${int(0, 20)}.${int(2, 250)}`,
          userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36",
          success: !absent,
          failureReason: absent ? "Trainee did not attend" : null,
          attendedAt: s.startDate,
        },
      });

      // Build a randomized question set snapshot, the way the exam engine does.
      const buildQuestionSet = (testType: "PRE_TEST" | "FINAL_TEST") =>
        JSON.stringify(
          shuffled(questions.filter((q) => q.testType === testType)).map((q, order) => ({
            questionId: q.id,
            order,
            optionsOrder: shuffled(JSON.parse(q.options).map((_: string, k: number) => k)),
          })),
        );

      let preScore: number | null = null;
      let finalScore: number | null = null;
      let passed = false;

      if (!absent) {
        // Pre-test — deliberately low scores; it measures baseline knowledge.
        preScore = int(30, 65);
        examCount++;
        await db.examAttempt.create({
          data: {
            refNumber: await refNumber("EXAM"),
            sessionId: s.sessionId,
            attendanceId: attendance.id,
            testType: "PRE_TEST",
            traineeName: trainee.fullName,
            traineeEmail: trainee.email,
            traineeIdNational: trainee.nationalId,
            companyId: trainee.companyId,
            questionSet: buildQuestionSet("PRE_TEST"),
            status: "GRADED",
            scorePercent: preScore,
            passed: preScore >= course.passScore,
            passScore: course.passScore,
            assignedAt: s.startDate,
            startedAt: new Date(s.startDate.getTime() + 30 * 60000),
            submittedAt: new Date(s.startDate.getTime() + 55 * 60000),
            durationSec: int(600, 1500),
            createdBy: ACTOR,
          },
        });
        await db.testResult.create({
          data: {
            refNumber: await refNumber("EXAM"),
            sessionId: s.sessionId,
            testType: "PRE_TEST",
            traineeName: trainee.fullName,
            traineeEmail: trainee.email,
            traineeIdNational: trainee.nationalId,
            companyId: trainee.companyId,
            scorePercent: preScore,
            passed: preScore >= course.passScore,
            attemptedAt: new Date(s.startDate.getTime() + 55 * 60000),
            durationSec: int(600, 1500),
            createdBy: ACTOR,
          },
        });
      }

      if (completed) {
        // Final test — most pass, a realistic minority fail.
        finalScore = chance(0.85) ? int(course.passScore, 100) : int(40, course.passScore - 1);
        passed = finalScore >= course.passScore;
        examCount++;
        await db.examAttempt.create({
          data: {
            refNumber: await refNumber("EXAM"),
            sessionId: s.sessionId,
            attendanceId: attendance.id,
            testType: "FINAL_TEST",
            traineeName: trainee.fullName,
            traineeEmail: trainee.email,
            traineeIdNational: trainee.nationalId,
            companyId: trainee.companyId,
            questionSet: buildQuestionSet("FINAL_TEST"),
            status: "GRADED",
            scorePercent: finalScore,
            passed,
            passScore: course.passScore,
            assignedAt: session.endDate,
            startedAt: session.endDate,
            submittedAt: new Date(session.endDate.getTime() + 40 * 60000),
            durationSec: int(900, 2400),
            createdBy: ACTOR,
          },
        });
        await db.testResult.create({
          data: {
            refNumber: await refNumber("EXAM"),
            sessionId: s.sessionId,
            testType: "FINAL_TEST",
            traineeName: trainee.fullName,
            traineeEmail: trainee.email,
            traineeIdNational: trainee.nationalId,
            companyId: trainee.companyId,
            scorePercent: finalScore,
            passed,
            attemptedAt: new Date(session.endDate.getTime() + 40 * 60000),
            durationSec: int(900, 2400),
            createdBy: ACTOR,
          },
        });

        // Evaluation — most, not all, trainees submit one.
        if (chance(0.8)) {
          const base = int(3, 5);
          await db.courseEvaluation.create({
            data: {
              sessionId: s.sessionId,
              trainerId: session.trainerId,
              traineeName: trainee.fullName,
              traineeEmail: trainee.email,
              traineeIdNational: trainee.nationalId,
              companyId: trainee.companyId,
              attendanceId: attendance.id,
              trainerRating: Math.min(5, base + int(0, 1)),
              contentRating: base,
              venueRating: Math.max(1, base - int(0, 1)),
              materialsRating: base,
              overallRating: base,
              comments: pick([
                "Very practical course, the field examples were useful.",
                "The trainer explained the material clearly.",
                "Good content overall, the venue was a little cold.",
                "Would like more hands-on time with the equipment.",
                "Excellent session, well organised.",
              ]),
              suggestions: chance(0.5) ? pick(["More practical exercises.", "Provide the slides in Arabic as well.", "Longer break between modules."]) : null,
              wouldRecommend: base >= 4,
              submittedAt: new Date(session.endDate.getTime() + 60 * 60000),
              createdBy: ACTOR,
            },
          });
        }
      }

      // Certificate — only for trainees who attended and passed the final test.
      let certificateId: string | null = null;
      if (completed && passed) {
        const issuedAt = new Date(session.endDate.getTime() + 2 * DAY);
        const validUntil = new Date(issuedAt.getTime() + course.validityMonths * 30 * DAY);
        const cert = await db.certificate.create({
          data: {
            refNumber: await refNumber("CERTIFICATE"),
            sessionId: s.sessionId,
            courseId: course.id,
            companyId: trainee.companyId,
            attendanceId: attendance.id,
            traineeName: trainee.fullName,
            traineeIdNational: trainee.nationalId,
            traineeEmail: trainee.email,
            finalScore: finalScore!,
            issuedAt,
            validUntil,
            status: "VALID",
            verificationToken: `vt-${crypto.randomUUID()}`,
            createdBy: ACTOR,
          },
        });
        certificateId = cert.id;
        certCount++;

        // A few certificates have been scanned publicly.
        if (chance(0.3)) {
          const scans = int(1, 4);
          for (let v = 0; v < scans; v++) {
            await db.certificateVerification.create({
              data: {
                certificateId: cert.id,
                verificationToken: cert.verificationToken,
                ipAddress: `84.23.${int(0, 255)}.${int(1, 254)}`,
                userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)",
                countryCode: pick(["SA", "AE", "EG", "IN"]),
                verifiedAt: daysFromNow(-int(0, 20)),
              },
            });
          }
          await db.certificate.update({
            where: { id: cert.id },
            data: { verificationCount: scans, lastVerifiedAt: daysFromNow(-int(0, 20)) },
          });
        }
      }

      await db.attendance.update({
        where: { id: attendance.id },
        data: {
          preTestAssignedAt: absent ? null : s.startDate,
          preTestCompletedAt: absent ? null : new Date(s.startDate.getTime() + 55 * 60000),
          finalTestAssignedAt: completed ? session.endDate : null,
          finalTestCompletedAt: completed ? new Date(session.endDate.getTime() + 40 * 60000) : null,
          finalTestPassed: completed ? passed : null,
          evaluationCompletedAt: completed ? new Date(session.endDate.getTime() + 60 * 60000) : null,
          certificateEligible: Boolean(certificateId),
          certificateId,
        },
      });

      await db.sessionEnrollment.create({
        data: {
          sessionId: s.sessionId,
          traineeId,
          companyId: trainee.companyId,
          enrollmentStatus: absent ? "NO_SHOW" : completed ? "COMPLETED" : "TRAINING",
          enrolledBy: ACTOR,
          enrollmentDate: daysFromNow(-int(10, 25)),
          completedDate: completed ? session.endDate : null,
          attendanceStatus,
          preTestStatus: absent ? "PENDING" : "COMPLETED",
          finalTestStatus: absent ? "PENDING" : completed ? (passed ? "PASSED" : "FAILED") : "IN_PROGRESS",
          evaluationStatus: completed ? "COMPLETED" : "PENDING",
          certificateStatus: certificateId ? "ISSUED" : completed && !passed ? "NOT_ELIGIBLE" : "NOT_ELIGIBLE",
          attendanceId: attendance.id,
          createdBy: ACTOR,
        },
      });
    }
  }

  // ── NOTIFICATIONS / AUDIT LOG / LOGIN HISTORY ──────────────────────────
  console.log("→ Notifications, audit log, login history");
  const allUsers = await db.user.findMany({ where: { accountStatus: "ACTIVE" } });
  const NOTIFS = [
    { title: "New training request submitted", message: "Arabian Gulf Contracting Co. submitted a request for Working at Height.", type: "REQUEST", category: "REQUEST", link: "/requests" },
    { title: "Session scheduled", message: "Confined Space Entry has been scheduled for next week.", type: "INFO", category: "SESSION", link: "/sessions" },
    { title: "Certificates issued", message: "18 certificates were issued for Basic Occupational Safety.", type: "SUCCESS", category: "CERTIFICATE", link: "/certificates" },
    { title: "Trainer qualification expiring", message: "An OSHA 30-Hour qualification expires in 20 days.", type: "WARNING", category: "SYSTEM", link: "/trainers" },
    { title: "Low attendance detected", message: "A session recorded attendance below 80%.", type: "WARNING", category: "SESSION", link: "/attendance" },
    { title: "Final test results available", message: "Fire Warden final test results have been graded.", type: "INFO", category: "TEST", link: "/final-test" },
  ];
  for (const u of allUsers) {
    for (const n of shuffled(NOTIFS).slice(0, int(2, 4))) {
      const isRead = chance(0.4);
      await db.notification.create({
        data: {
          userId: u.id,
          title: n.title,
          message: n.message,
          type: n.type,
          category: n.category,
          link: n.link,
          isRead,
          readAt: isRead ? daysFromNow(-int(0, 5)) : null,
          channels: JSON.stringify(["in_app", "email"]),
          createdAt: daysFromNow(-int(0, 14)),
        },
      });
    }
  }

  const AUDIT = [
    { action: "LOGIN", entity: "USER", description: "User signed in" },
    { action: "CREATE", entity: "COMPANY", description: "Created company record" },
    { action: "APPROVE", entity: "REQUEST", description: "Approved training request" },
    { action: "CREATE", entity: "SESSION", description: "Scheduled training session" },
    { action: "QR_REGENERATE", entity: "SESSION", description: "Regenerated session QR token" },
    { action: "EXAM_SUBMIT", entity: "EXAM", description: "Trainee submitted final test" },
    { action: "CERTIFICATE_GENERATE", entity: "CERTIFICATE", description: "Generated certificate PDF" },
    { action: "UPDATE", entity: "TRAINER", description: "Updated trainer qualification" },
    { action: "STATUS_CHANGE", entity: "REQUEST", description: "Request moved to Under Review" },
    { action: "DELETE", entity: "TRAINEE", description: "Soft-deleted trainee record" },
  ];
  for (let i = 0; i < 60; i++) {
    const a = pick(AUDIT);
    const u = pick(allUsers);
    await db.auditLog.create({
      data: {
        userId: u.id,
        action: a.action,
        entity: a.entity,
        description: `${a.description} (${u.fullName})`,
        ipAddress: `10.0.${int(0, 20)}.${int(2, 250)}`,
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        createdAt: daysFromNow(-int(0, 45)),
      },
    });
  }

  for (const u of allUsers) {
    for (let i = 0; i < int(2, 6); i++) {
      const success = chance(0.85);
      await db.loginHistory.create({
        data: {
          userId: u.id,
          email: u.email,
          success,
          failureReason: success ? null : "Invalid password",
          ipAddress: `10.0.${int(0, 20)}.${int(2, 250)}`,
          userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
          attemptedAt: daysFromNow(-int(0, 30)),
        },
      });
    }
  }

  // ── SUMMARY ────────────────────────────────────────────────────────────
  const counts = {
    companies: await db.company.count(),
    contacts: await db.companyContact.count(),
    trainees: await db.trainee.count(),
    trainers: await db.trainer.count(),
    courses: await db.course.count(),
    questions: await db.question.count(),
    users: await db.user.count(),
    requests: await db.trainingRequest.count(),
    sessions: await db.trainingSession.count(),
    enrollments: await db.sessionEnrollment.count(),
    attendance: await db.attendance.count(),
    examAttempts: await db.examAttempt.count(),
    evaluations: await db.courseEvaluation.count(),
    certificates: await db.certificate.count(),
    notifications: await db.notification.count(),
    auditLogs: await db.auditLog.count(),
  };

  console.log("\n✅ Demo seed completed\n");
  for (const [k, v] of Object.entries(counts)) {
    console.log(`   ${k.padEnd(16)} ${v}`);
  }
  console.log(`\n   Exams graded: ${examCount}, certificates issued: ${certCount}`);
  console.log("\n🔑 Demo logins (password for all: " + DEMO_PASSWORD + ")");
  const logins = await db.user.findMany({
    where: { createdBy: ACTOR },
    select: { email: true, role: true, accountStatus: true },
    orderBy: { role: "asc" },
  });
  for (const l of logins) {
    console.log(`   ${l.role.padEnd(12)} ${l.email}${l.accountStatus !== "ACTIVE" ? `  (${l.accountStatus})` : ""}`);
  }
  console.log("\n   Super admin remains as seeded by scripts/seed.ts");
}

main()
  .catch((e) => {
    console.error("❌ Demo seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
