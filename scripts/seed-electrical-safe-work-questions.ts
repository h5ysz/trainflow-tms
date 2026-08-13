// GCCLAB TMS — Seed the bilingual question bank for "Safe Working Procedures for Electrical" (CSCC02)
// =====================================================================
// Source: Safe Work Procedures (GC04), Technical Short Course (TSC), May 2025.
// Creates the course (if missing) with passScore=70 + pre/final tests enabled,
// then (re)seeds 10 PRE_TEST + 20 FINAL_TEST questions.
// Question types: TRUE_FALSE and SINGLE_CHOICE. text = English, textAr = Arabic.
// Idempotent: existing questions for the course are soft-deleted before re-insert.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COURSE_CODE = "CSCC02";
const COURSE_TITLE = "Safe working Procedures for Electrical";
const COURSE_TITLE_AR = "إجراءات العمل الآمن للكهرباء";

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

const TRUE_FALSE_OPTIONS = ["True", "False"];

const IMG = {
  electricArc: "/question-images/elt01/figure-1-3-4-electric-arc.png",
  energyIsolation: "/question-images/elt01/figure-4-1-energy-isolation.png",
  ptwAssessment: "/question-images/elt01/figure-4-10-ptw-assessment.png",
  jccChart: "/question-images/elt01/figure-4-12-jcc-chart.png",
  toolboxTalk: "/question-images/elt01/figure-4-13-toolbox-talk.png",
};

const QUESTIONS: SeedQuestion[] = [
  // ─────────────────────────── PRE-TEST (10) ───────────────────────────
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "A hazard is the potential for harm.",
    textAr: "الخطر هو احتمالية حدوث ضرر.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Personal Protective Equipment (PPE) cannot be a substitute for effective engineering controls; it is considered the last line of defense.",
    textAr: "لا يمكن لمعدات الحماية الشخصية أن تكون بديلاً عن الضوابط الهندسية الفعالة؛ فهي تعتبر خط الدفاع الأخير.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Working on energized (hot) circuits is one of the most dangerous things any worker could do.",
    textAr: "العمل على الدوائر الحية (الموصلة بالكهرباء) من أخطر الأشياء التي قد يقوم بها أي عامل.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Red and white barricade tape is called Danger tape and may only be crossed by personnel authorized to fix or remove the hazard.",
    textAr: "شريط الحواجز الأحمر والأبيض يسمى شريط الخطر، ولا يجوز عبوره إلا من قبل الأفراد المصرح لهم بإصلاح الخطر أو إزالته.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "JSA stands for:",
    textAr: "اختصار JSA يعني:",
    options: ["Job Safety Analysis", "Joint Safety Audit", "Job Service Agreement", "Junior Safety Assessor"],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which of the following is NOT one of the six types of work permits?",
    textAr: "أي مما يلي ليس أحد أنواع تصاريح العمل الستة؟",
    options: [
      "Hot Work Permit",
      "Electrical Work Permit",
      "Sanction for Test (SFT)",
      "Parking Permit",
    ],
    correctAnswers: [3],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "DANGER signs shall have the signal word in white letters on a ______ background.",
    textAr: "يجب أن تكون كلمة التحذير في لافتات الخطر (DANGER) بحروف بيضاء على خلفية ______.",
    options: ["Safety red", "Safety blue", "Orange", "Yellow"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "If you find yourself on energized ground and need to move away, you should:",
    textAr: "إذا وجدت نفسك على أرض موصلة بالكهرباء وتحتاج إلى الابتعاد، يجب عليك:",
    options: [
      "Shuffle your feet, keeping them touching at all times",
      "Run quickly away from the area",
      "Jump with both feet together",
      "Walk normally with long steps",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The Arc Flash Boundary is the boundary where an arc flash hazard exists with incident energy equal to or greater than:",
    textAr: "حدود وميض القوس الكهربائي هي الحدود التي يوجد عندها خطر وميض القوس بطاقة حادثة تساوي أو تزيد عن:",
    options: ["1.2 cal/cm²", "5 J/cm²", "0.5 cal/cm²", "2.0 cal/cm²"],
    correctAnswers: [0],
    difficulty: "HARD",
    imageUrl: IMG.electricArc,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The only PPE-free zones within SEC and proponent organizations are:",
    textAr: "مناطق الخلو من معدات الحماية الشخصية الوحيدة داخل شركة الطاقة السعودية والمنظمات الداعمة هي:",
    options: [
      "Administrative buildings in non-restricted areas",
      "All offices including work areas",
      "Substations and switchyards",
      "Any area inside the arc flash boundary",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },

  // ─────────────────────────── FINAL TEST (20) ───────────────────────────
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Electrical insulating rubber gloves should meet or exceed the requirements of ASTM D120.",
    textAr: "يجب أن تتوافق قفازات المطاط العازلة للكهرباء أو تتجاوز متطلبات ASTM D120.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "There are more injuries from low-voltage systems (especially 347 V) than there are from high-voltage systems.",
    textAr: "عدد الإصابات الناتجة عن أنظمة الجهد المنخفض (خاصة 347 فولت) أكثر من تلك الناتجة عن أنظمة الجهد العالي.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "According to OSHA standards, hot sticks should be inspected and electrically tested every two years.",
    textAr: "وفقًا لمعايير OSHA، يجب فحص العصي الحية (Hot Sticks) واختبارها كهربائيًا كل عامين.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Lock Out and Tag Out (LOTO) involves placing locks and tags on the designated control equipment to ensure that all energy sources are correctly isolated.",
    textAr: "القفل والوسم (LOTO) يتضمن وضع الأقفال والملصقات على معدات التحكم المخصصة لضمان عزل جميع مصادر الطاقة بشكل صحيح.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.energyIsolation,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "The Electrical Work Permit is valid for a maximum of 10 consecutive calendar days.",
    textAr: "تصريح العمل الكهربائي صالح لمدة أقصاها 10 أيام تقويمية متتالية.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "The General Work Permit covers excavation work, working at height, lifting operations, diving operations and working with radioactive material.",
    textAr: "تصريح العمل العام يغطي أعمال الحفر، والعمل على المرتفعات، وعمليات الرفع، وعمليات الغوص، والعمل بالمواد المشعة.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "The DANGER signal word may be used for property-damage hazards.",
    textAr: "يجوز استخدام كلمة تحذير الخطر (DANGER) لمخاطر تلف الممتلكات.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Yellow and black caution tape is used to delineate work areas which require authorization (typically from a supervisor) to enter.",
    textAr: "شريط التنبيه الأصفر والأسود يستخدم لتحديد مناطق العمل التي تتطلب تصريحًا (عادةً من المشرف) للدخول.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "A Sanction for Test (SFT) permit cannot be transferred unless testing is completed and closed by the Permit Receiver.",
    textAr: "لا يمكن نقل تصريح الإذن بالاختبار (SFT) إلا بعد اكتمال الاختبار وإغلاقه من قبل مستقبل التصريح.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "HARD",
    imageUrl: IMG.ptwAssessment,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Overhead power lines are usually not insulated.",
    textAr: "خطوط الكهرباء العلوية عادةً غير معزولة.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The conductive material in a power arc is vaporized by temperatures that can be as high as:",
    textAr: "تتبخر المادة الموصلة في القوس الكهربائي بدرجات حرارة يمكن أن تصل إلى:",
    options: ["20,000 °C", "5,000 °C", "50,000 °C", "1,000 °C"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.electricArc,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Within the Restricted Approach Boundary (RAB), only ______ are permitted to enter.",
    textAr: "داخل حدود الاقتراب المقيدة (RAB)، يُسمح فقط لـ ______ بالدخول.",
    options: [
      "Qualified personnel wearing appropriate PPE",
      "Any worker with a valid work permit",
      "Visitors with supervision",
      "The site nurse",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The most common electrical violation is:",
    textAr: "المخالفة الكهربائية الأكثر شيوعًا هي:",
    options: ["Improper grounding of equipment and circuitry", "Using LED lighting", "Installing too many outlets", "Using aluminum wire"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The Hot Work Permit is valid for a maximum of:",
    textAr: "تصريح العمل الساخن صالح لمدة أقصاها:",
    options: ["2 consecutive calendar days", "10 consecutive calendar days", "7 consecutive calendar days", "1 calendar day"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The Line Breaking Work Permit is valid for a maximum of:",
    textAr: "تصريح كسر الخطوط صالح لمدة أقصاها:",
    options: ["1 calendar day", "2 consecutive calendar days", "7 consecutive calendar days", "10 consecutive calendar days"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The Electrical Work Permit Threshold Voltage (EWPTV) at SEC is set at:",
    textAr: "جهد العتبة لتصريح العمل الكهربائي (EWPTV) لدى شركة الطاقة السعودية محدد عند:",
    options: ["400 VAC", "110 VAC", "1000 VAC", "220 VAC"],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Who is responsible for delivering the Toolbox Talk (TBT) to workers before commencing work?",
    textAr: "من المسؤول عن إلقاء حديث صندوق الأدوات (Toolbox Talk) على العمال قبل بدء العمل؟",
    options: ["Permit Receiver", "The fire watcher", "The site visitor", "The safety equipment supplier"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.toolboxTalk,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The Job Classification Chart (JCC) is used to identify:",
    textAr: "مخطط تصنيف المهام (JCC) يستخدم لتحديد:",
    options: [
      "The type of permits/certificates to be issued and whether a JSA is required",
      "The salary level of the workers",
      "The color of the barricade tape",
      "The number of workers on site",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.jccChart,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Inherent risk is calculated by estimating the likelihood and impact of each identified hazard:",
    textAr: "يُحسب الخطر الجوهري من خلال تقدير احتمالية وتأثير كل خطر محدد:",
    options: [
      "Without considering existing controls",
      "After all controls have been implemented",
      "Only considering the financial cost",
      "After the residual risk is determined",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "CAUTION signs shall have the signal word in black letters on a ______ background.",
    textAr: "يجب أن تكون كلمة التحذير (CAUTION) بحروف سوداء على خلفية ______.",
    options: ["Yellow", "Safety red", "Safety blue", "Orange"],
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
    durationHours: 18,
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
          correctAnswers: JSON.stringify(q.correctAnswers),
          points: 1,
          order: q.order,
          isActive: true,
          category: "Electrical Safety",
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

  console.log("=== SEED SAFE WORKING PROCEDURES FOR ELECTRICAL QUESTIONS COMPLETE ===");
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
