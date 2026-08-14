// GCCLAB TMS — Seed the bilingual question bank for "Lockout/Tagout (LOTO) Procedures" (CSCC15)
// =====================================================================
// Source: Lockout/Tagout Procedures (CSCC15), Safety Short Course.
// Creates the course (if missing) with passScore=70 + pre/final tests enabled,
// then (re)seeds 10 PRE_TEST + 20 FINAL_TEST questions.
// Question types: TRUE_FALSE and SINGLE_CHOICE. text = English, textAr = Arabic.
// Idempotent: existing questions for the course are soft-deleted before re-insert.

import { PrismaClient } from "@prisma/client";
import { translateOptions } from "./options-ar";

const prisma = new PrismaClient();

const COURSE_CODE = "CSCC15";
const COURSE_TITLE = "Lockout/Tagout (LOTO) Procedures";
const COURSE_TITLE_AR = "إجراءات القفل والوسم (لوتو)";

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
  ppe: "/question-images/cscc15/figure-2-1-ppe.png",
  rubberGloves: "/question-images/cscc15/figure-2-14-rubber-gloves.png",
  samplePhotos: "/question-images/cscc15/figure-3-2-sample-loto-photos.png",
  holdTag: "/question-images/cscc15/figure-3-4-hold-tag.png",
  padlock: "/question-images/cscc15/figure-3-9-padlock.png",
  plugLockout: "/question-images/cscc15/figure-3-12-plug-prong-lockout.png",
  dangerTag: "/question-images/cscc15/figure-3-15-danger-tag.png",
  flowChart: "/question-images/cscc15/figure-3-16-loto-flow-chart.png",
  breakingLock: "/question-images/cscc15/figure-3-17-breaking-lock-flow-chart.png",
  cuttingForm: "/question-images/cscc15/figure-3-18-lockout-cutting-form.png",
  dosDonts: "/question-images/cscc15/figure-3-19-dos-and-donts.png",
  colorCoding: "/question-images/cscc15/figure-3-20-lock-color-coding.png",
  inspectionForm: "/question-images/cscc15/figure-3-21-inspection-form.png",
};

const TRUE_FALSE_OPTIONS = ["True", "False"];

const QUESTIONS: SeedQuestion[] = [
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What is the main purpose of the Lockout/Tagout (LOTO) procedure?",
    textAr: "ما الغرض الرئيسي من إجراءات القفل والوسم (لوتو)؟",
    options: [
      "To prevent accidental startup or release of hazardous energy during maintenance",
      "To speed up equipment repairs",
      "To keep tools in the workshop",
      "To replace the equipment operator",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which of the following forms of hazardous energy requires LOTO?",
    textAr: "أي من الأشكال التالية للطاقة الخطرة يتطلب إجراءات القفل والوسم؟",
    options: ["Electrical", "Mechanical", "Thermal", "All of the above"],
    correctAnswers: [3],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which color has been adopted for all LOTO locks and tags used on electrical energy sources?",
    textAr: "ما اللون المعتمد لجميع أقفال وبطاقات القفل والوسم المستخدمة على مصادر الطاقة الكهربائية؟",
    options: ["Red", "Green", "Blue", "Yellow"],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.colorCoding,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "How many keys does each LOTO padlock have?",
    textAr: "كم عدد المفاتيح الخاصة بكل قفل عشوائي (بادلوك) في نظام القفل والوسم؟",
    options: ["One key", "Two keys only", "Three keys", "Any number of keys"],
    correctAnswers: [1],
    difficulty: "EASY",
    imageUrl: IMG.padlock,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "When must a lockout tag be used?",
    textAr: "متى يجب استخدام بطاقة القفل (الوسم)؟",
    options: [
      "Whenever work is done near moving machinery",
      "When a worker owns a padlock",
      "Only when an energy-isolating device cannot be locked",
      "At the end of each shift",
    ],
    correctAnswers: [2],
    difficulty: "MEDIUM",
    imageUrl: IMG.holdTag,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What must each worker apply before starting work on isolated equipment?",
    textAr: "ما الذي يجب على كل عامل وضعه قبل بدء العمل على المعدات المعزولة؟",
    options: [
      "His own lock with his own key",
      "A shared lock used by all workers",
      "A copy of the work permit",
      "A warning sign only",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.samplePhotos,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Are workers allowed to keep master keys for LOTO padlocks?",
    textAr: "هل يُسمح للعمال بالاحتفاظ بمفاتيح رئيسية لأقفال القفل والوسم؟",
    options: [
      "No, master keys are forbidden for workers",
      "Yes, if they are experienced",
      "Yes, if the supervisor agrees",
      "Only during night shifts",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What is the first step in the LOTO procedure?",
    textAr: "ما هي الخطوة الأولى في إجراءات القفل والوسم؟",
    options: [
      "Notify all affected employees",
      "Apply the lock",
      "Verify zero energy",
      "Release stored energy",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.flowChart,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What is the final step before starting work in a LOTO activity?",
    textAr: "ما هي الخطوة الأخيرة قبل بدء العمل في نشاط القفل والوسم؟",
    options: [
      "Verify that the equipment is de-energized (zero energy)",
      "Remove the lock",
      "Inform the plant operator",
      "Start the equipment",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.flowChart,
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "A tag alone is a physical barrier that prevents equipment operation.",
    textAr: "البطاقة وحدها تمثل حاجزاً فيزيائياً يمنع تشغيل المعدات.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
    imageUrl: IMG.dangerTag,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What does LOTO stand for?",
    textAr: "ماذا يعني اختصار LOTO؟",
    options: [
      "Lockout/Tagout",
      "Load and Test Operations",
      "Loss of Tool Output",
      "Level of Thermal Output",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which of the following is an energy-isolating device?",
    textAr: "أي من التالي يعتبر جهازاً لعزل الطاقة؟",
    options: [
      "A circuit breaker or a disconnect switch",
      "A safety sign",
      "A fire extinguisher",
      "An emergency light",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The two persons involved in a LOTO activity are the authorized employee and the:",
    textAr: "الشخصان المشاركان في نشاط القفل والوسم هما الموظف المصرح له و:",
    options: [
      "Affected employee",
      "Site nurse",
      "External auditor",
      "Equipment supplier",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What is the correct order of the LOTO procedure?",
    textAr: "ما هو الترتيب الصحيح لإجراءات القفل والوسم؟",
    options: [
      "Notify, shutdown, isolate, apply lock/tag, release stored energy, verify",
      "Apply lock, notify, verify, shutdown, release energy",
      "Shutdown, verify, notify, apply lock, release energy",
      "Isolate, notify, apply tag, verify, shutdown",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
    imageUrl: IMG.flowChart,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Why is the red color used for LOTO locks and tags on electrical sources?",
    textAr: "لماذا يُستخدم اللون الأحمر لأقفال وبطاقات القفل والوسم على المصادر الكهربائية؟",
    options: [
      "To identify that the equipment is energized and locked for electrical work",
      "Because red paint is cheaper",
      "To match the company logo",
      "To attract visitors",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.colorCoding,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Each LOTO padlock has two keys: one key for the worker and:",
    textAr: "كل قفل عشوائي (بادلوك) في نظام القفل والوسم له مفتاحان: مفتاح للعامل و:",
    options: [
      "A master key kept by the authorized person",
      "A spare key hidden near the lock",
      "A key for every worker on site",
      "A key stored in the toolbox",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.padlock,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Workers are allowed to possess master keys for LOTO padlocks.",
    textAr: "يُسمح للعمال بحيازة المفاتيح الرئيسية لأقفال القفل والوسم.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "How should a lock be removed when its owner is not available?",
    textAr: "كيف يجب إزالة قفل عندما لا يكون صاحبه متاحاً؟",
    options: [
      "Only after following the approved procedure and verifying no hazardous energy exists",
      "Immediately with bolt cutters",
      "By any worker on shift",
      "After one hour of waiting",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
    imageUrl: IMG.breakingLock,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Before starting work, how do you verify that the equipment is truly de-energized?",
    textAr: "قبل بدء العمل، كيف تتحقق من أن المعدات فعلاً غير نشطة كهربائياً؟",
    options: [
      "Test the equipment using an approved voltage tester",
      "Trust that the lock is applied",
      "Ask a coworker",
      "Listen for a humming sound",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What should be done with stored energy before maintenance work begins?",
    textAr: "ماذا يجب فعله بالطاقة المخزنة قبل بدء أعمال الصيانة؟",
    options: [
      "Discharge, depressurize, and drain all stored energy sources",
      "Ignore it because it is small",
      "Wait for it to disappear automatically",
      "Cover it with a tarp",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What PPE protects the worker from electric shock during LOTO activities?",
    textAr: "ما هي معدات الحماية الشخصية التي تحمي العامل من الصدمة الكهربائية أثناء أعمال القفل والوسم؟",
    options: [
      "Rubber insulating gloves",
      "Leather work gloves",
      "Cotton gloves",
      "Plastic gloves",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.rubberGloves,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "How often should PPE used with electrical work be inspected?",
    textAr: "كم مرة يجب فحص معدات الحماية الشخصية المستخدمة في الأعمال الكهربائية؟",
    options: [
      "Monthly",
      "Once a year",
      "Every five years",
      "Only after an accident",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What is the purpose of a hold tag?",
    textAr: "ما الغرض من بطاقة الإيقاف (Hold Tag)؟",
    options: [
      "To identify equipment that must not be operated",
      "To advertise a product",
      "To record attendance",
      "To label the storage room",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.holdTag,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The message on a danger tagout tells everyone that the equipment is:",
    textAr: "الرسالة على بطاقة الخطر (Danger Tagout) تخبر الجميع بأن المعدات:",
    options: [
      "Out of service and must not be operated",
      "Ready for operation",
      "Under annual inspection only",
      "Available for use",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.dangerTag,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which device is used to lock out an electrical plug?",
    textAr: "أي جهاز يُستخدم لعزل قابس كهربائي؟",
    options: [
      "A plug prong lockout device",
      "A gate valve lockout",
      "A ball valve lockout",
      "A cylinder lockout",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.plugLockout,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "When several workers work on the same equipment, how are their locks applied?",
    textAr: "عندما يعمل عدة عمال على نفس المعدات، كيف يتم وضع أقفالهم؟",
    options: [
      "Each worker adds his own personal lock to a lockout hasp",
      "Only the supervisor applies one lock",
      "They share one lock between them",
      "Locks are not needed when working together",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Lockout is preferred over tagout because a lock is a physical barrier while a tag is only a warning.",
    textAr: "القفل مفضل على الوسم لأن القفل حاجز فيزيائي بينما البطاقة مجرد تحذير.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What does the LOTO 'Do and Not Do' poster warn against?",
    textAr: "ماذا يحذر ملصق (افعل ولا تفعل) الخاص بالقفل والوسم من؟",
    options: [
      "Removing locks, shortcuts, and operating locked equipment",
      "Wearing safety glasses",
      "Using the correct personal lock",
      "Applying your own lock",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.dosDonts,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Why is a LOTO inspection form used?",
    textAr: "لماذا يُستخدم نموذج تفتيش القفل والوسم؟",
    options: [
      "To record that LOTO procedures are inspected and verified periodically",
      "To record employee attendance",
      "To list spare parts",
      "To calculate overtime",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.inspectionForm,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which document is used when a lock or tag must be cut and removed from equipment?",
    textAr: "أي مستند يُستخدم عندما يجب قص وإزالة قفل أو بطاقة من المعدات؟",
    options: [
      "The LOTO lock and tag cutting and removal form",
      "The monthly PPE inspection form",
      "The hazard identification form",
      "The training attendance form",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
    imageUrl: IMG.cuttingForm,
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

  console.log("=== SEED CSCC15 LOTO QUESTIONS COMPLETE ===");
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
