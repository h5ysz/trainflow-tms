// GCCLAB TMS — Seed the bilingual question bank for "Basic Fire Fighting" (SAF02)
// =====================================================================
// Source: Basics of Firefighting (SAF02), Safety Short Course, April 2026.
// Creates the course (if missing) with passScore=70 + pre/final tests enabled,
// then (re)seeds 10 PRE_TEST + 20 FINAL_TEST questions.
// Question types: TRUE_FALSE and SINGLE_CHOICE. text = English, textAr = Arabic.
// Idempotent: existing questions for the course are soft-deleted before re-insert.

import { PrismaClient } from "@prisma/client";
import { translateOptions } from "./options-ar";

const prisma = new PrismaClient();

const COURSE_CODE = "SAF02";
const COURSE_TITLE = "Basic Fire Fighting";
const COURSE_TITLE_AR = "أساسيات مكافحة الحرائق";

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
  fireTriangle: "/question-images/saf02/figure-1-2-fire-triangle.png",
  fireClasses: "/question-images/saf02/figure-1-12-fire-classes.png",
  water: "/question-images/saf02/figure-3-2-water-extinguisher.png",
  co2: "/question-images/saf02/figure-3-8-co2-extinguisher.png",
  dryPowder: "/question-images/saf02/figure-3-9-dry-powder-extinguisher.png",
  pass: "/question-images/saf02/figure-3-11-pass-method.png",
};

const TRUE_FALSE_OPTIONS = ["True", "False"];

const QUESTIONS: SeedQuestion[] = [
  // ─────────────────────────── PRE-TEST (10) ───────────────────────────
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "The three essential elements required for a fire to start are a combustible material (fuel), heat, and oxygen.",
    textAr: "العناصر الثلاثة الأساسية اللازمة لاشتعال الحريق هي المادة القابلة للاحتراق (الوقود) والحرارة والأكسجين.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.fireTriangle,
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Water is a good conductor of electricity, so water fire extinguishers must not be used on electrical fires.",
    textAr: "الماء موصل جيد للكهرباء، لذلك لا يجوز استخدام طفايات المياه على الحرائق الكهربائية.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Class A fires involve flammable liquids such as gasoline, kerosene, and oils.",
    textAr: "تشمل حرائق الفئة (أ) السوائل القابلة للاشتعال مثل البنزين والكيروسين والزيوت.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
    imageUrl: IMG.fireClasses,
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "In the PASS method, the first step 'P' stands for pulling the safety pin.",
    textAr: "في طريقة PASS، الحرف الأول P يعني سحب دبوس الأمان.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.pass,
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Carbon dioxide (CO₂) fire extinguishers are equipped with a pressure gauge.",
    textAr: "طفايات ثاني أكسيد الكربون (CO₂) مزودة بمقياس ضغط.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which three elements must be present for a fire to start?",
    textAr: "ما العناصر الثلاثة التي يجب توفرها لنشوب الحريق؟",
    options: ["Fuel, heat, and oxygen", "Fuel, water, and smoke", "Heat, smoke, and gas", "Oxygen, carbon dioxide, and fuel"],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.fireTriangle,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Fires involving flammable liquids such as gasoline, kerosene, and oils are classified as which class of fire?",
    textAr: "ما تصنيف الحرائق التي تشمل السوائل القابلة للاشتعال مثل البنزين والكيروسين والزيوت؟",
    options: ["Class A", "Class B", "Class C", "Class D"],
    correctAnswers: [1],
    difficulty: "EASY",
    imageUrl: IMG.fireClasses,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What is the main extinguishing principle of water fire extinguishers?",
    textAr: "ما مبدأ الإطفاء الرئيسي لطفايات المياه؟",
    options: ["Smothering (blanketing)", "Cooling", "Starvation (removing fuel)", "Chemical inhibition"],
    correctAnswers: [1],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Fires involving combustible metals such as magnesium and sodium are classified as which class of fire?",
    textAr: "ما تصنيف الحرائق التي تشمل المعادن القابلة للاشتعال مثل المغنيسيوم والصوديوم؟",
    options: ["Class B", "Class C", "Class D", "Class F"],
    correctAnswers: [2],
    difficulty: "MEDIUM",
    imageUrl: IMG.fireClasses,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "In the PASS method, what does the letter 'A' stand for?",
    textAr: "في طريقة PASS، ماذا يعني الحرف A؟",
    options: ["Aim at the base of the flames", "Activate the fire alarm", "Approach the fire", "Assess the situation"],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.pass,
  },

  // ─────────────────────────── FINAL TEST (20) ───────────────────────────
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "A fire cannot ignite unless three essential elements are present: a combustible material, a heat source, and oxygen.",
    textAr: "لا يمكن أن يشتعل الحريق إلا بتوفر ثلاثة عناصر أساسية: مادة قابلة للاحتراق، ومصدر حرارة، والأكسجين.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Class B fires involve solid combustible materials such as wood, paper, and textiles.",
    textAr: "تشمل حرائق الفئة (ب) المواد الصلبة القابلة للاحتراق مثل الخشب والورق والمنسوجات.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
    imageUrl: IMG.fireClasses,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Foam fire extinguishers must not be used on electrical fires.",
    textAr: "لا يجوز استخدام طفايات الرغوة على الحرائق الكهربائية.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "The extinguishing principle of carbon dioxide (CO₂) extinguishers is mainly smothering by cutting off the oxygen supply.",
    textAr: "يعتمد مبدأ إطفاء طفايات ثاني أكسيد الكربون بشكل أساسي على الخنق بقطع إمداد الأكسجين.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.co2,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Dry chemical powder fire extinguishers provide a strong cooling effect.",
    textAr: "توفر طفايات المسحوق الكيميائي الجاف تأثير تبريد قوي.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "All standard fire extinguishers have a pressure gauge except carbon dioxide (CO₂) extinguishers.",
    textAr: "جميع طفايات الحريق القياسية مزودة بمقياس ضغط باستثناء طفايات ثاني أكسيد الكربون.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "In the PASS method, the second letter 'S' stands for sweeping the nozzle from side to side.",
    textAr: "في طريقة PASS، الحرف الثاني S يعني كنس الفوهة من جانب إلى آخر.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.pass,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Fires involving cooking oils and fats are classified as Class D fires.",
    textAr: "تصنف الحرائق الناتجة عن زيوت ودهون الطهي ضمن حرائق الفئة (د).",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "When fighting a fire with a portable extinguisher, you should fight with the wind at your back.",
    textAr: "عند مكافحة الحريق باستخدام طفاية محمولة، يجب أن تكون الرياح خلفك.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Foam should be directed straight onto the surface of the burning liquid to extinguish the fire.",
    textAr: "يجب توجيه الرغوة مباشرة على سطح السائل المشتعل لإطفاء الحريق.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Fires involving flammable gases are classified as which class of fire?",
    textAr: "ما تصنيف الحرائق التي تشمل الغازات القابلة للاشتعال؟",
    options: ["Class A", "Class B", "Class C", "Class D"],
    correctAnswers: [2],
    difficulty: "MEDIUM",
    imageUrl: IMG.fireClasses,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which fire extinguisher is used to combat Class A fires only?",
    textAr: "أي نوع من طفايات الحريق يُستخدم لمكافحة حرائق الفئة (أ) فقط؟",
    options: ["Water fire extinguisher", "Carbon dioxide (CO₂) extinguisher", "Dry chemical powder extinguisher", "Foam fire extinguisher"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.water,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What is the recommended safe distance when using a portable fire extinguisher?",
    textAr: "ما المسافة الآمنة الموصى بها عند استخدام طفاية الحريق المحمولة؟",
    options: ["At least 4 feet", "At least 6 feet", "At least 8 feet", "At least 10 feet"],
    correctAnswers: [2],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which of the following is a main component of a portable fire extinguisher?",
    textAr: "أي مما يلي يُعد مكونًا رئيسيًا من مكونات طفاية الحريق المحمولة؟",
    options: ["Safety pin", "Discharge hose", "Pressure gauge", "All of the above"],
    correctAnswers: [3],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which type of automatic sprinkler system is the most common, simplest, and most effective?",
    textAr: "أي نوع من أنظمة الرشاشات الأوتوماتيكية هو الأكثر شيوعًا وأبسطها وأكثرها فعالية؟",
    options: ["Dry pipe system", "Wet pipe system", "Pre-action system", "Deluge system"],
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Carbon dioxide (CO₂) extinguishers are highly effective on fires caused by which of the following?",
    textAr: "طفايات ثاني أكسيد الكربون فعالة جدًا في الحرائق الناتجة عن أي مما يلي؟",
    options: ["Electrical equipment", "Combustible metals", "Deep-seated carbonaceous fires", "Chemicals that contain their own oxygen"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.co2,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which extinguishing method works by preventing oxygen from reaching the fire?",
    textAr: "ما طريقة الإطفاء التي تعمل على منع وصول الأكسجين إلى النار؟",
    options: ["Cooling", "Blanketing (smothering)", "Removing fuel (starvation)", "Dilution"],
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Fixed foam systems are primarily used to protect which of the following?",
    textAr: "تُستخدم أنظمة الرغوة الثابتة بشكل أساسي لحماية أي مما يلي؟",
    options: ["Liquid storage tanks and fuel transfer areas", "General office buildings", "Computer and server rooms", "Residential apartments"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "When using a portable fire extinguisher, where should you aim the discharge?",
    textAr: "عند استخدام طفاية الحريق المحمولة، أين يجب توجيه مادة الإطفاء؟",
    options: ["At the top of the flames", "At the base of the flames", "At the middle of the flames", "Above the fire"],
    correctAnswers: [1],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Dry chemical powder fire extinguishers are suitable for which classes of fire?",
    textAr: "طفايات المسحوق الكيميائي الجاف مناسبة لحرائق أي فئة؟",
    options: ["Class A and B only", "Class B and C only", "Class A, B, and C", "Class D only"],
    correctAnswers: [2],
    difficulty: "MEDIUM",
    imageUrl: IMG.dryPowder,
  },
];

function pad(n: number, width = 6) {
  return n.toString().padStart(width, "0");
}

async function nextCourseRef() {
  const yearKey = 0; // non-yearly continuous sequence
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
          category: "Fire Safety",
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

  console.log("=== SEED BASIC FIRE FIGHTING QUESTIONS COMPLETE ===");
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
