// GCCLAB TMS — Seed the bilingual question bank for "National Grid Electrical Safety" (CSCC08)
// =====================================================================
// Source: National Grid Safety Rules (CSCC08).
// Creates the course (if missing) with passScore=70 + pre/final tests enabled,
// then (re)seeds 10 PRE_TEST + 20 FINAL_TEST questions.
// Question types: TRUE_FALSE and SINGLE_CHOICE. text = English, textAr = Arabic.
// Idempotent: existing questions for the course are soft-deleted before re-insert.

import { PrismaClient } from "@prisma/client";
import { translateOptions } from "./options-ar";

const prisma = new PrismaClient();

const COURSE_CODE = "CSCC08";
const COURSE_TITLE = "National Grid Electrical Safety";
const COURSE_TITLE_AR = "السلامة الكهربائية للشبكة الوطنية";

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
  ppe: "/question-images/cscc08/figure-1-1-ppe.png",
  emergencyDuties: "/question-images/cscc08/figure-1-2-emergency-duties.png",
  groundConnection: "/question-images/cscc08/figure-1-10-ground-connection.png",
  portableGrounding: "/question-images/cscc08/figure-6-9-portable-grounding.png",
  hotStick: "/question-images/cscc08/figure-1-11-hot-stick.png",
  categoryLabels: "/question-images/cscc08/figure-2-8-category-labels.png",
  operationLock: "/question-images/cscc08/figure-5-1-operation-lock.png",
  safetyLock: "/question-images/cscc08/figure-5-2-safety-lock.png",
  safetyBoxes: "/question-images/cscc08/figure-5-3-safety-boxes.png",
  holdTags: "/question-images/cscc08/figure-5-5-hold-tags.png",
  lotoFlowChart: "/question-images/cscc08/figure-5-6-loto-flow-chart.png",
  dangerSign: "/question-images/cscc08/figure-6-1-danger-sign.png",
  warningSign: "/question-images/cscc08/figure-6-2-warning-sign.png",
  barriers: "/question-images/cscc08/figure-6-11-barriers.png",
  pipelineLabeling: "/question-images/cscc08/figure-6-25-pipeline-labeling.png",
  lotoCircuits: "/question-images/cscc08/figure-9-10-loto-circuits.png",
  preventionElectrocution: "/question-images/cscc08/figure-9-11-prevention-electrocution.png",
  craneOverheadWires: "/question-images/cscc08/figure-9-4-crane-overhead-wires.png",
  defectiveInsulation: "/question-images/cscc08/figure-9-6-defective-insulation.png",
  groundingCircuits: "/question-images/cscc08/figure-9-9-grounding-circuits.png",
  stwDocument: "/question-images/cscc08/figure-4-2-stw-document.png",
  hlwDocument: "/question-images/cscc08/figure-4-13-hlw-document.png",
};

const TRUE_FALSE_OPTIONS = ["True", "False"];

const QUESTIONS: SeedQuestion[] = [
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which of the following is required personal protective equipment for electrical work?",
    textAr: "أي مما يلي يعد من معدات الحماية الشخصية المطلوبة للأعمال الكهربائية؟",
    options: [
      "Insulating gloves, helmet, and appropriate clothing",
      "Only a cotton cap",
      "Only safety shoes",
      "Only gloves for cold weather",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.ppe,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "When a person is in contact with a live conductor, the first step is to:",
    textAr: "عند ملامسة شخص لموصل كهربائي نشط، الخطوة الأولى هي:",
    options: [
      "Isolate the power and rescue the person safely without touching him directly",
      "Touch the person to pull him away",
      "Pour water on the person",
      "Wait for the police",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.emergencyDuties,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Why must portable grounding be connected before working on de-energized conductors?",
    textAr: "لماذا يجب توصيل التأريض المحمول قبل العمل على الموصلات المفصولة عن الطاقة؟",
    options: [
      "To provide a safe path for any residual or induced current",
      "To light the work area",
      "To reduce the noise",
      "To mark the work site",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.portableGrounding,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What is the 'Operation Lock' used for?",
    textAr: "ما هو استخدام «قفل التشغيل»؟",
    options: [
      "A safety lock used by authorized personnel during switching or isolation",
      "A lock for the office door",
      "A lock for the tool store",
      "A lock for the locker room",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.operationLock,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What does S.T.W stand for in transmission safety documents?",
    textAr: "ماذا يعني اختصار S.T.W في مستندات السلامة الخاصة بنقل الطاقة؟",
    options: [
      "Sanction To Work",
      "Safety Training Workshop",
      "Switch Test Warning",
      "System Technical Work",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.stwDocument,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Working near overhead power lines with cranes or equipment is hazardous because:",
    textAr: "العمل بالقرب من خطوط الطاقة العلوية باستخدام الرافعات أو المعدات خطير لأن:",
    options: [
      "Lines are usually not insulated and can cause electrocution",
      "The lines are very heavy",
      "The lines block the view",
      "The lines make noise",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.craneOverheadWires,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Before entering a transmission substation, the worker must:",
    textAr: "قبل دخول محطة تحويل نقل الطاقة، يجب على العامل:",
    options: [
      "Obtain the required authorization and follow the entry procedure",
      "Enter quickly without checks",
      "Open the fence by himself",
      "Skip the safety briefing",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Insulation that is defective or inadequate is:",
    textAr: "العزل التالف أو غير الكافي هو:",
    options: [
      "An electrical hazard",
      "A comfortable feature",
      "An improvement",
      "Not important",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.defectiveInsulation,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which of the following is a transmission safety document?",
    textAr: "أي مما يلي يعد من مستندات سلامة النقل؟",
    options: [
      "Sanction For Test (S.F.T)",
      "Parking Permit",
      "Lunch Break Card",
      "Visitor Badge",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.hlwDocument,
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Grounding circuits and equipment protects people from electric shock.",
    textAr: "تأريض الدوائر والمعدات يحمي الأشخاص من الصدمة الكهربائية.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.groundingCircuits,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The minimum safe distance from energized parts depends on:",
    textAr: "المسافة الآمنة الدنيا من الأجزاء النشطة تعتمد على:",
    options: [
      "The voltage level and the approach boundary tables",
      "The height of the worker",
      "The time of the day",
      "The color of the equipment",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What is a 'hot stick'?",
    textAr: "ما هي «عصا الجهد» (الهوت ستيك)؟",
    options: [
      "A high voltage insulated tool used to work on energized equipment from a distance",
      "A metal rod for testing soil",
      "A rod for lifting weights",
      "A spare antenna",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.hotStick,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which safety document is used when testing after de-energizing?",
    textAr: "أي مستند سلامة يُستخدم عند الاختبار بعد فصل الطاقة؟",
    options: [
      "Sanction For Test (S.F.T)",
      "Sanction To Work (S.T.W)",
      "Work Permit for office cleaning",
      "Driver License",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
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
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Hot Line Work (H.L.W) is allowed only for:",
    textAr: "العمل على الخط الساخن (H.L.W) مسموح به فقط لـ:",
    options: [
      "Specially trained and authorized personnel with the required documents and tools",
      "Any worker on site",
      "New trainees without supervision",
      "Visitors",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Lockout and tagout of circuits and equipment is performed to:",
    textAr: "يتم إجراء القفل والوسم على الدوائر والمعدات لـ:",
    options: [
      "Prevent accidental energization and protect workers from hazardous energy",
      "Speed up the work",
      "Reduce the number of workers",
      "Decorate the equipment",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.lotoCircuits,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Before touching a conductor after isolation, it must be:",
    textAr: "قبل لمس موصل بعد فصله عن الطاقة، يجب:",
    options: [
      "Tested to verify zero energy and grounded if required",
      "Painted",
      "Oiled",
      "Labeled with a price",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.groundConnection,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Portable earth connections must be applied:",
    textAr: "يجب تطبيق وصلات التأريض المحمولة:",
    options: [
      "In the suitable location before work and removed only after work is completed",
      "Only at the end of the day",
      "After the work is finished",
      "Only during rain",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.portableGrounding,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The 'DANGER' sign is used when:",
    textAr: "تُستخدم لافتة «الخطر» عندما:",
    options: [
      "There is an imminently hazardous situation",
      "There is a rest area",
      "The cafeteria is open",
      "Parking is available",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.dangerSign,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The 'WARNING' sign is used when:",
    textAr: "تُستخدم لافتة «التحذير» عندما:",
    options: [
      "A potentially hazardous situation exists that could cause injury if not avoided",
      "The office is closed",
      "The weather is clear",
      "The site is clean",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.warningSign,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Barriers and caution tapes are used to:",
    textAr: "تُستخدم الحواجز وأشرطة الحذر لـ:",
    options: [
      "Protect people from hazards and define restricted areas",
      "Decorate the site",
      "Block all emergency exits",
      "Hide equipment",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.barriers,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What is the purpose of pipeline labeling?",
    textAr: "ما الغرض من وضع العلامات على خطوط الأنابيب؟",
    options: [
      "To identify the content and flow direction for safety",
      "To make the pipes look nice",
      "To increase the pressure",
      "To warm the pipes",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.pipelineLabeling,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "To prevent electrocution, workers must never:",
    textAr: "لمنع الصعق الكهربائي، يجب على العمال أبداً:",
    options: [
      "Touch unverified conductors or use damaged tools",
      "Wear PPE",
      "Use the hot stick",
      "Check the voltage tester",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.preventionElectrocution,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The safety boxes used in LOTO contain:",
    textAr: "صناديق الأمان المستخدمة في القفل والوسم تحتوي على:",
    options: [
      "Locks and keys that secure the isolation of equipment",
      "Spare tools",
      "Lunch supplies",
      "Cleaning materials",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.safetyBoxes,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Hold tags are used to:",
    textAr: "تُستخدم بطاقات الإيقاف (Hold Tags) لـ:",
    options: [
      "Warn that equipment must not be operated",
      "Record attendance",
      "Label spare parts",
      "Mark parking spaces",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.holdTags,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Each worker applies his own personal lock during a group LOTO activity.",
    textAr: "كل عامل يضع قفله الشخصي الخاص به أثناء نشاط القفل والوسم الجماعي.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.lotoFlowChart,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Overhead power lines are usually not insulated.",
    textAr: "خطوط الطاقة العلوية عادةً ليست معزولة.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "After any incident that may have damaged insulating equipment, the equipment must be:",
    textAr: "بعد أي حادث قد يكون ألحق ضرراً بالمعدات العازلة، يجب أن تكون المعدات:",
    options: [
      "Inspected immediately before further use",
      "Stored without inspection",
      "Used as normal",
      "Discarded without a record",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The correct sequence before working on a de-energized line includes:",
    textAr: "التسلسل الصحيح قبل العمل على خط مفصول عن الطاقة يشمل:",
    options: [
      "Isolate, verify zero energy, apply earths, and obtain authorization",
      "Apply earths first, then isolate",
      "Start work directly",
      "Only sign the permit",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Electrical equipment labels (category 1 to 4) indicate:",
    textAr: "ملصقات المعدات الكهربائية (الفئات من 1 إلى 4) تشير إلى:",
    options: [
      "The hazard level and required PPE for the equipment",
      "The price of the equipment",
      "The manufacturing year",
      "The equipment color code",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.categoryLabels,
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
    durationHours: 24,
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

  console.log("=== SEED CSCC08 NG ELECTRICAL QUESTIONS COMPLETE ===");
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
