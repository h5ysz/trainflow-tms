// GCCLAB TMS — Seed the bilingual question bank for "Distribution Safety Rules" (CSCC04)
// =====================================================================
// Source: Distribution Safety Rules, Safe Isolation & Switching Procedures (CSCC04).
// Creates the course (if missing) with passScore=70 + pre/final tests enabled,
// then (re)seeds 10 PRE_TEST + 20 FINAL_TEST questions.
// Question types: TRUE_FALSE and SINGLE_CHOICE. text = English, textAr = Arabic.
// Idempotent: existing questions for the course are soft-deleted before re-insert.

import { PrismaClient } from "@prisma/client";
import { translateOptions } from "./options-ar";

const prisma = new PrismaClient();

const COURSE_CODE = "CSCC04";
const COURSE_TITLE = "Distribution Safety Rules, Safe Isolation and Switching Procedures";
const COURSE_TITLE_AR = "قواعد سلامة التوزيع والعزل الآمن وإجراءات التشغيل (التحويل)";

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
  headProtection: "/question-images/cscc04/figure-2-1-head-protection.png",
  eyeProtection: "/question-images/cscc04/figure-2-2-eye-protection.png",
  arcFlashBoundaryPpe: "/question-images/cscc04/figure-2-4-arc-flash-boundary-ppe.png",
  arcRatedClothing: "/question-images/cscc04/figure-2-5-arc-rated-clothing.png",
  arcFlash: "/question-images/cscc04/figure-1-3-arc-flash.png",
  arcFireExplosion: "/question-images/cscc04/figure-1-4-arc-fire-explosion.png",
  stepPotential: "/question-images/cscc04/figure-1-6-step-potential.png",
  touchPotential: "/question-images/cscc04/figure-1-7-touch-potential.png",
  exposedParts: "/question-images/cscc04/figure-1-16-exposed-parts-hazard.png",
  defectiveInsulation: "/question-images/cscc04/figure-1-17-defective-insulation.png",
  overheadLine: "/question-images/cscc04/figure-1-18-overhead-line-hazard.png",
  overload: "/question-images/cscc04/figure-1-19-overload-hazard.png",
  extensionCord: "/question-images/cscc04/figure-1-22-extension-cord.png",
  dangerSign: "/question-images/cscc04/figure-6-1-danger-sign.png",
  warningSign: "/question-images/cscc04/figure-6-2-warning-sign.png",
  fireSafetySigns: "/question-images/cscc04/figure-6-6-fire-safety-signs.png",
  hvTestBarriers: "/question-images/cscc04/figure-8-15-hv-test-barriers.png",
  securityLocks: "/question-images/cscc04/figure-9-4-security-locks.png",
  safetyLocks: "/question-images/cscc04/figure-9-5-safety-locks.png",
  isolationCard: "/question-images/cscc04/figure-9-1-isolation-card.png",
  grounding: "/question-images/cscc04/figure-7-2-grounding-connections.png",
  groundResistance: "/question-images/cscc04/figure-5-8-ground-resistance-table.png",
};

const TRUE_FALSE_OPTIONS = ["True", "False"];

const QUESTIONS: SeedQuestion[] = [
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What is the purpose of 'safe isolation'?",
    textAr: "ما الغرض من 'العزل الآمن'؟",
    options: [
      "To ensure equipment is de-energized and cannot be re-energized during work",
      "To speed up the work",
      "To isolate the worker from his supervisor",
      "To reduce the number of workers",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Before starting switching operations, the worker must:",
    textAr: "قبل البدء بعمليات التحويل (التشغيل)، يجب على العامل:",
    options: [
      "Be authorized and follow the approved switching program",
      "Act quickly without documents",
      "Work without coordination",
      "Skip the safety signs",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "An arc flash can reach a temperature of approximately:",
    textAr: "يمكن أن يصل وميض القوس الكهربائي إلى درجة حرارة تبلغ تقريباً:",
    options: ["20,000 °C", "5,000 °C", "50,000 °C", "1,000 °C"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.arcFlash,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which PPE must be worn when working within the arc flash boundary?",
    textAr: "ما هي معدات الحماية الشخصية التي يجب ارتداؤها عند العمل داخل حدود وميض القوس الكهربائي؟",
    options: [
      "Arc-rated clothing, hearing protection, eye protection and head protection",
      "Only cotton gloves",
      "Only a safety vest",
      "No PPE is required",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.arcFlashBoundaryPpe,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "High voltage test barriers are colored:",
    textAr: "حواجز اختبار الجهد العالي تكون ملوّنة بـ:",
    options: [
      "Red and white",
      "Green and yellow",
      "Blue and black",
      "Pink and grey",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.hvTestBarriers,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What is step potential?",
    textAr: "ما هو جهد الخطوة؟",
    options: [
      "The voltage difference between two points one step apart on energized ground",
      "The voltage of a battery",
      "The voltage of a street light",
      "The voltage of the human heart",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.stepPotential,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The 'DANGER' sign indicates:",
    textAr: "لافتة «الخطر» تشير إلى:",
    options: [
      "An imminently hazardous situation that will cause death or serious injury if not avoided",
      "A general information message",
      "A direction to the exit",
      "A parking instruction",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.dangerSign,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Head protection worn during electrical work must be:",
    textAr: "حماية الرأس المستخدمة أثناء الأعمال الكهربائية يجب أن تكون:",
    options: [
      "Non-conductive",
      "Metallic",
      "Made of aluminum foil",
      "Coated with wet paint",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.headProtection,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Before working on electrical equipment, the equipment must be:",
    textAr: "قبل العمل على المعدات الكهربائية، يجب أن تكون المعدات:",
    options: [
      "Isolated, locked out, and verified de-energized",
      "Painted",
      "Cleaned only",
      "Photographed",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.isolationCard,
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Overhead power lines are usually insulated and safe to touch.",
    textAr: "خطوط الطاقة العلوية عادةً تكون معزولة وآمنة للمس.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "EASY",
    imageUrl: IMG.overheadLine,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Employees shall wear protective equipment for the eyes whenever there is danger of injury from:",
    textAr: "يجب على الموظفين ارتداء معدات حماية العينين كلما وُجد خطر الإصابة من:",
    options: [
      "Electric arcs, flashes, or flying objects resulting from an electrical explosion",
      "Bright office lighting",
      "Reading documents",
      "Wind",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.eyeProtection,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Arc-rated clothing must be worn wherever exposure to an electric arc flash above the threshold level is possible because it:",
    textAr: "يجب ارتداء ملابس مقاومة للقوس الكهربائي حيث يكون التعرض لميض القوس فوق المستوى الحدّي محتملاً لأنها:",
    options: [
      "Prevents or reduces burns from the arc flash",
      "Keeps the worker warm",
      "Looks professional",
      "Replaces the arc flash hazard",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.arcRatedClothing,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "An arc flash can cause:",
    textAr: "يمكن أن يسبب وميض القوس الكهربائي:",
    options: [
      "Fire, explosion, burns, and injury from metal fragments",
      "Only a small light",
      "No damage at all",
      "A change in the weather",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.arcFireExplosion,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What is touch potential?",
    textAr: "ما هو جهد اللمس؟",
    options: [
      "The voltage that appears when a person touches energized equipment while standing on lower-voltage ground",
      "The voltage of the car battery",
      "The voltage used to charge phones",
      "The voltage of household lighting",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.touchPotential,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The 'WARNING' sign indicates:",
    textAr: "لافتة «التحذير» تشير إلى:",
    options: [
      "A potentially hazardous situation that could result in death or serious injury if not avoided",
      "A normal notice",
      "A safety suggestion",
      "A rest area sign",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.warningSign,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Safety barriers are used to:",
    textAr: "تُستخدم حواجز السلامة لـ:",
    options: [
      "Keep people away from hazards and protect work areas",
      "Decorate the site",
      "Block the emergency exits",
      "Hide the equipment",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Wires and parts that are exposed or have defective insulation are an electrical hazard because they:",
    textAr: "الأسلاك والأجزاء المكشوفة أو ذات العزل المعيب تمثل خطراً كهربائياً لأنها:",
    options: [
      "May be energized and cause shock if touched",
      "Increase the light in the area",
      "Improve ventilation",
      "Reduce the room temperature",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.exposedParts,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Overloads in an electrical system are hazardous because they can produce:",
    textAr: "الأحمال الزائدة في النظام الكهربائي خطرة لأنها يمكن أن تنتج:",
    options: [
      "Heat or arcing",
      "Extra light",
      "Cooling",
      "Fresh air",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.overload,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "LOTO safety locks for electrical work are padlocks that:",
    textAr: "أقفال الأمان الكهربائية الخاصة بالقفل والوسم هي أقفال عشوائية:",
    options: [
      "Have different colors and an individual key differing from normal system locks",
      "All share one common key",
      "Are never locked",
      "Can be opened by any person",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.safetyLocks,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "A properly grounded electrical system protects people by:",
    textAr: "النظام الكهربائي المؤرّض بشكل صحيح يحمي الأشخاص من خلال:",
    options: [
      "Providing a low-resistance path that trips protective devices and prevents shock",
      "Increasing the voltage",
      "Making the wires heavier",
      "Decorating the installation",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.grounding,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Only qualified and authorized personnel may perform:",
    textAr: "فقط الأفراد المؤهلون والمصرح لهم يمكنهم القيام بـ:",
    options: [
      "Switching operations and work on energized equipment",
      "Office cleaning",
      "Food preparation",
      "Vehicle maintenance",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Insulating equipment must be inspected for damage:",
    textAr: "يجب فحص المعدات العازلة بحثاً عن التلف:",
    options: [
      "Daily before use and immediately after any incident",
      "Once a year only",
      "Every five years",
      "Never",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "When working near energized conductors, the worker must always be aware of:",
    textAr: "عند العمل بالقرب من الموصلات النشطة، يجب أن يكون العامل دائماً على دراية بـ:",
    options: [
      "The arcing hazard",
      "The wind direction",
      "The room temperature",
      "The noise level",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "An arc flash can propagate several feet away from the source of the arc.",
    textAr: "يمكن أن ينتشر وميض القوس الكهربائي عدة أقدام بعيداً عن مصدر القوس.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Security locks on electrical panels must never be forced open or removed without authorization.",
    textAr: "أقفال الأمان على اللوحات الكهربائية يجب ألا تُكسر أو تُزال دون إذن.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.securityLocks,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Rubber insulating gloves used for electrical work must be:",
    textAr: "القفازات المطاطية العازلة المستخدمة في الأعمال الكهربائية يجب أن تكون:",
    options: [
      "Rated for the voltage of the work and inspected before each use",
      "Worn only in winter",
      "Used for handling chemicals",
      "Kept wet during work",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Before using an electrical extension cord, it must be checked for:",
    textAr: "قبل استخدام سلك التمديد الكهربائي، يجب فحصه من أجل:",
    options: [
      "Damage and proper insulation",
      "Its color",
      "Its length only",
      "The brand name",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.extensionCord,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What is the maximum recommended ground resistance for a distribution installation?",
    textAr: "ما هي القيمة القصوى الموصى بها لمقاومة الأرض لتركيبات التوزيع؟",
    options: [
      "As specified in the ground resistance table for the installation type",
      "10 ohms for all cases without exception",
      "1000 ohms minimum",
      "Any value is acceptable",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
    imageUrl: IMG.groundResistance,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The minimum distance a person must stay from exposed energized conductors is called the:",
    textAr: "الحد الأدنى للمسافة التي يجب أن يبقى عندها الشخص بعيداً عن الموصلات النشطة المكشوفة يسمى:",
    options: [
      "Approach (approach boundary) distance",
      "Car parking distance",
      "Office door distance",
      "Lunch break distance",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What must be done immediately after any incident that could have damaged insulating equipment?",
    textAr: "ما الذي يجب فعله فوراً بعد أي حادث قد يكون ألحق ضرراً بالمعدات العازلة؟",
    options: [
      "Inspect the equipment for damage",
      "Store the equipment away",
      "Paint the equipment",
      "Discard the inspection record",
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
    durationHours: 32,
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

  console.log("=== SEED CSCC04 DISTRIBUTION QUESTIONS COMPLETE ===");
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
