// GCCLAB TMS — Seed the bilingual question bank for "Work Permit Issuer/Receiver" (CSCC14)
// =====================================================================
// Source: Work Permit Sender & Receiver (CSCC14), Safety Short Course.
// Creates the course (if missing) with passScore=70 + pre/final tests enabled,
// then (re)seeds 10 PRE_TEST + 20 FINAL_TEST questions.
// Question types: TRUE_FALSE and SINGLE_CHOICE. text = English, textAr = Arabic.
// Idempotent: existing questions for the course are soft-deleted before re-insert.

import { PrismaClient } from "@prisma/client";
import { translateOptions } from "./options-ar";

const prisma = new PrismaClient();

const COURSE_CODE = "CSCC14";
const COURSE_TITLE = "Work Permit Issuer/Receiver";
const COURSE_TITLE_AR = "تصريح العمل: المُصدر والمستلم";

type QType = "TRUE_FALSE" | "SINGLE_CHOICE";

interface SeedQuestion {
  type: QType;
  testType: "PRE_TEST" | "FINAL_TEST";
  text: string;
  textAr: string;
  options: string[];
  correctAnswers: number[];
  difficulty: "EASY" | "MEDIUM" | "HARD";
  imageUrl?: string;
}

const IMG = {
  ohsPolicy: "/question-images/cscc14/figure-1-1-ohs-policy.png",
  lifeSavingRules: "/question-images/cscc14/figure-1-2-life-saving-rules.png",
  employeeCommitment: "/question-images/cscc14/figure-1-3-employee-commitment.png",
  switchingProgram: "/question-images/cscc14/figure-2-1-switching-program.png",
  issuerCard: "/question-images/cscc14/figure-2-2-issuer-card.png",
  receiverCard: "/question-images/cscc14/figure-2-3-receiver-card.png",
  authorizationCards: "/question-images/cscc14/figure-2-6-authorization-cards.png",
  issuingWorkflow: "/question-images/cscc14/figure-2-8-issuing-workflow.png",
  stwWorkflow: "/question-images/cscc14/figure-3-1-stw-workflow.png",
  hlwWorkflow: "/question-images/cscc14/figure-3-3-hlw-workflow.png",
  peaWorkflow: "/question-images/cscc14/figure-3-4-pea-workflow.png",
  seniorAuthorized: "/question-images/cscc14/figure-2-16-senior-authorized-person.png",
  authorizedPerson: "/question-images/cscc14/figure-2-17-authorized-person.png",
  competentPerson: "/question-images/cscc14/figure-2-18-competent-person.png",
};

const TRUE_FALSE_OPTIONS = ["True", "False"];

const QUESTIONS: SeedQuestion[] = [
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What is a work permit?",
    textAr: "ما هو تصريح العمل؟",
    options: [
      "A formal document that authorizes specific work after safety conditions are met",
      "A document to enter the office",
      "A lunch voucher",
      "A vehicle registration",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Who is the permit issuer?",
    textAr: "من هو مُصدر التصريح؟",
    options: [
      "The authorized person who checks the safety conditions and issues the permit",
      "The visitor",
      "The site nurse",
      "The security guard",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.issuerCard,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Who is the permit receiver?",
    textAr: "من هو مستلم التصريح؟",
    options: [
      "The authorized person who receives the permit and is responsible for the work team",
      "The person who prints the permit",
      "The person who stores the permits",
      "The visitor who watches the work",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.receiverCard,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The OHS policy statement is:",
    textAr: "بيان سياسة الصحة والسلامة المهنية هو:",
    options: [
      "A formal commitment by the organization to protect its people and property",
      "A list of office supplies",
      "A parking plan",
      "A lunch menu",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.ohsPolicy,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Life Saving Rules are:",
    textAr: "قواعد إنقاذ الحياة هي:",
    options: [
      "Key safety rules that must never be violated because they prevent fatal incidents",
      "Rules for saving money",
      "Instructions for swimming",
      "Rules for using the elevator",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.lifeSavingRules,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Before issuing a work permit, the issuer must:",
    textAr: "قبل إصدار تصريح العمل، يجب على المُصدر:",
    options: [
      "Verify that the work can be done safely and that hazards are controlled",
      "Count the tools quickly",
      "Ask for a gift",
      "Skip the site visit",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The switching program (S.P) is used to:",
    textAr: "يُستخدم برنامج التحويل (S.P) لـ:",
    options: [
      "Plan and authorize the isolation and de-energizing of equipment",
      "Arrange the parking",
      "Schedule the lunch break",
      "Plan the office cleaning",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.switchingProgram,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "An authorization card proves that the holder:",
    textAr: "بطاقة التفويض تثبت أن حاملها:",
    options: [
      "Is qualified and authorized to perform specific safety roles",
      "Works in the cafeteria",
      "Owns a car",
      "Is a new employee",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.authorizationCards,
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "A work permit can be issued without visiting and inspecting the work site.",
    textAr: "يمكن إصدار تصريح عمل دون زيارة وفحص موقع العمل.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "The receiver must understand and comply with all conditions written in the work permit.",
    textAr: "يجب على مستلم التصريح فهم والالتزام بجميع الشروط المكتوبة في تصريح العمل.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.employeeCommitment,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What is the main responsibility of the permit issuer?",
    textAr: "ما هي المسؤولية الرئيسية لمُصدر التصريح؟",
    options: [
      "To ensure the work site is safe and the permit conditions are correct before signing",
      "To do the work on the equipment",
      "To bring tools to the site",
      "To prepare the meals",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What is the main responsibility of the permit receiver?",
    textAr: "ما هي المسؤولية الرئيسية لمستلم التصريح؟",
    options: [
      "To carry out the work safely and comply with all permit conditions",
      "To design new equipment",
      "To sign permits for other teams",
      "To supervise unrelated departments",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "When the work is completed, the permit receiver must:",
    textAr: "عند انتهاء العمل، يجب على مستلم التصريح:",
    options: [
      "Return the permit to the issuer after the site is restored and safe",
      "Leave the permit at the site",
      "Destroy the permit",
      "Keep the permit as a souvenir",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The Senior Authorized Person card is colored:",
    textAr: "بطاقة الشخص الأعلى تفويضاً تكون ملوّنة بـ:",
    options: [
      "Pink",
      "White",
      "Green",
      "Black",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.seniorAuthorized,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The Authorized Person card is colored:",
    textAr: "بطاقة الشخص المصرح له تكون ملوّنة بـ:",
    options: [
      "Yellow",
      "Pink",
      "Grey",
      "Brown",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.authorizedPerson,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The Competent Person card is colored:",
    textAr: "بطاقة الشخص الكفء (المختص) تكون ملوّنة بـ:",
    options: [
      "White",
      "Red",
      "Blue",
      "Black",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.competentPerson,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What does S.T.W stand for?",
    textAr: "ماذا يعني اختصار S.T.W؟",
    options: [
      "Sanction To Work",
      "Safety To Work",
      "Switch Test Window",
      "Standard Training Work",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.stwWorkflow,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What does H.L.W stand for?",
    textAr: "ماذا يعني اختصار H.L.W؟",
    options: [
      "Hot Line Work",
      "High Load Work",
      "Heavy Lifting Work",
      "Hazard Level Warning",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.hlwWorkflow,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What does P.E.A stand for?",
    textAr: "ماذا يعني اختصار P.E.A؟",
    options: [
      "Portable Earth Application",
      "Power Equipment Area",
      "Personal Emergency Alarm",
      "Primary Energy Assessment",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.peaWorkflow,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "If the work conditions change significantly while the permit is valid, the receiver must:",
    textAr: "إذا تغيرت ظروف العمل بشكل جوهري أثناء سريان التصريح، يجب على المستلم:",
    options: [
      "Stop work and inform the issuer",
      "Continue working quietly",
      "Change the permit himself",
      "Ignore the change",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The purpose of the qualification card workflow is to:",
    textAr: "الغرض من سير عمل إصدار بطاقات التأهيل هو:",
    options: [
      "Ensure only qualified persons receive authorization",
      "Print cards faster",
      "Reduce paperwork",
      "Track visitor attendance",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.issuingWorkflow,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "The receiver may hand over the work to another person only after proper handover arrangements are made.",
    textAr: "يجوز للمستلم تسليم العمل لشخص آخر فقط بعد ترتيبات تسليم مناسبة.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "A permit becomes invalid if the conditions on it are not met.",
    textAr: "يصبح التصريح غير ساري إذا لم يتم استيفاء شروطه.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Life Saving Rules must be followed:",
    textAr: "يجب اتباع قواعد إنقاذ الحياة:",
    options: [
      "At all times without exception",
      "Only during audits",
      "Only by managers",
      "Only on rainy days",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Isolation and de-energizing of equipment before work requires:",
    textAr: "عزل المعدات وفصلها عن الطاقة قبل العمل يتطلب:",
    options: [
      "An approved switching program and LOTO application",
      "Only a verbal order",
      "Removing the locks",
      "Working live",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.switchingProgram,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "A contractor employee working under an issued permit must:",
    textAr: "موظف المقاول الذي يعمل بموجب تصريح صادر يجب أن:",
    options: [
      "Comply with all permit conditions and the site safety rules",
      "Follow only his own instructions",
      "Skip the safety briefing",
      "Use the equipment without authorization",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "If a life saving rule is violated on site, the work must:",
    textAr: "إذا تم انتهاك قاعدة إنقاذ حياة في الموقع، يجب أن:",
    options: [
      "Be stopped immediately and the violation reported",
      "Continue until the end of the shift",
      "Be completed quickly",
      "Be ignored",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "The issuer and the receiver must jointly inspect the site before the permit is signed.",
    textAr: "يجب على المُصدر والمستلم معاً فحص الموقع قبل التوقيع على التصريح.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What should the receiver do if the permit conditions cannot be met?",
    textAr: "ماذا يجب على المستلم فعله إذا تعذر استيفاء شروط التصريح؟",
    options: [
      "Do not start the work and return the permit to the issuer",
      "Start the work anyway",
      "Modify the permit quietly",
      "Proceed with a verbal agreement",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which document records that all safety checks are completed before authorization?",
    textAr: "أي مستند يوثق أن جميع فحوصات السلامة اكتملت قبل التفويض؟",
    options: [
      "The work permit and its approval workflow",
      "The vehicle registration",
      "The lunch menu",
      "The office attendance sheet",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
];

function pad(n: number, width = 6) {
  return n.toString().padStart(width, "0");
}

async function nextCourseRef() {
  const yearKey = 0;
  const counter = await prisma.refNumberCounter.upsert({
    where: { entityType_year: { entityType: "COURSE", year: yearKey } },
    update: { sequence: { increment: 1 } },
    create: { entityType: "COURSE", year: yearKey, sequence: 1 },
  });
  return `CRS-${pad(counter.sequence)}`;
}

async function findOrCreateCourse() {
  let course = await prisma.course.findUnique({ where: { code: COURSE_CODE } });
  const fields = {
    title: COURSE_TITLE,
    titleAr: COURSE_TITLE_AR,
    category: "Safety",
    durationHours: 8,
    language: "bilingual",
    validityMonths: 12,
    passScore: 70,
    maxTrainees: 20,
    hasPreTest: true,
    hasFinalTest: true,
    hasEvaluation: true,
    status: "ACTIVE",
  };
  if (!course) {
    const refNumber = await nextCourseRef();
    course = await prisma.course.create({ data: { ...fields, code: COURSE_CODE, refNumber } });
    console.log(`Created course ${COURSE_CODE} (${refNumber}).`);
  } else {
    course = await prisma.course.update({ where: { id: course.id }, data: { ...fields, deletedAt: null } });
    console.log(`Found existing course ${COURSE_CODE} (${course.refNumber}); synced settings.`);
  }
  return course;
}

async function seedQuestions(courseId: string) {
  const byTestType = (tt: "PRE_TEST" | "FINAL_TEST") =>
    QUESTIONS.filter((q) => q.testType === tt).map((q, i) => ({ ...q, order: i + 1 }));

  let created = 0;
  let softDeleted = 0;

  for (const testType of ["PRE_TEST", "FINAL_TEST"] as const) {
    const stale = await prisma.question.updateMany({
      where: { courseId, testType, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    softDeleted += stale.count;

    for (const q of byTestType(testType)) {
      await prisma.question.create({
        data: {
          courseId,
          type: q.type,
          testType: q.testType,
          text: q.text,
          textAr: q.textAr,
          options: JSON.stringify(q.options),
          optionsAr: JSON.stringify(translateOptions(q.options)),
          correctAnswers: JSON.stringify(q.correctAnswers),
          points: 1,
          order: q.order,
          isActive: true,
          category: "Occupational Health & Safety",
          difficulty: q.difficulty,
          imageUrl: q.imageUrl ?? null,
          source: "IMPORTED",
        },
      });
      created++;
    }
  }

  return { created, softDeleted };
}

async function run() {
  const course = await findOrCreateCourse();
  const { created, softDeleted } = await seedQuestions(course.id);

  const preCount = QUESTIONS.filter((q) => q.testType === "PRE_TEST").length;
  const finalCount = QUESTIONS.filter((q) => q.testType === "FINAL_TEST").length;

  console.log("=== SEED CSCC14 WORK PERMIT QUESTIONS COMPLETE ===");
  console.log(`Course : ${COURSE_CODE} — ${COURSE_TITLE} (passScore=70, hasPreTest=true, hasFinalTest=true)`);
  console.log(`Inserted ${created} questions (PRE_TEST=${preCount}, FINAL_TEST=${finalCount})`);
  console.log(`Soft-deleted ${softDeleted} previously seeded question(s).`);
}

run()
  .catch((e) => {
    console.error("SEED FAILED:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
