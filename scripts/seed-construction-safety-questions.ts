// GCCLAB TMS — Seed the bilingual question bank for "Construction Safety" (CSCC10)
// =====================================================================
// Source: Construction Safety Textbook (SAF07), Safety Short Course, April 2021.
// Creates the course (if missing) with passScore=70 + pre/final tests enabled,
// then (re)seeds 10 PRE_TEST + 20 FINAL_TEST questions.
// Idempotent: existing questions for the course are soft-deleted before re-insert.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COURSE_CODE = "CSCC10";
const COURSE_TITLE = "Construction Safety";
const COURSE_TITLE_AR = "السلامة في الإنشاءات";

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
  hira: "/question-images/cst01/figure-2-4-hira.png",
  sawGuard: "/question-images/cst01/figure-2-9-saw-guard.png",
  barricadeTape: "/question-images/cst01/figure-2-14-barricade-tape.png",
  fullBodyHarness: "/question-images/cst01/figure-2-15-full-body-harness.png",
  lanyard: "/question-images/cst01/figure-2-16-lanyard.png",
  arcFlashSuit: "/question-images/cst01/figure-2-25-arc-flash-suit.png",
};

const QUESTIONS: SeedQuestion[] = [
  // ─────────────────────────── PRE-TEST (10) ───────────────────────────
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "A hazard is a source or situation with a potential for harm in terms of injury or ill health, damage to property, damage to the workplace environment, or a combination of these.",
    textAr: "الخطر هو مصدر أو حالة تحمل احتمالية التسبب في ضرر سواء بإصابة أو مرض مهني أو تلف في الممتلكات أو تلف في بيئة مكان العمل أو مزيج من ذلك.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Personal Protective Equipment (PPE) is considered the last line of defense and shall only be used after other control measures have been applied.",
    textAr: "تُعتبر معدات الحماية الشخصية خط الدفاع الأخير ولا يجوز استخدامها إلا بعد تطبيق إجراءات التحكم الأخرى.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Standing or walking under a suspended load is prohibited.",
    textAr: "الوقوف أو المشي تحت حمولة معلقة ممنوع.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Contractors' employees are involved in incidents more frequently than SE employees, and they may be less familiar with site-specific hazards.",
    textAr: "يشارك موظفو المقاولين في الحوادث أكثر من موظفي الشركة، وقد يكونون أقل دراية بمخاطر الموقع المحددة.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "JSP stands for:",
    textAr: "اختصار JSP يعني:",
    options: ["Job Safe Procedure", "Job Safety Program", "Joint Safety Permit", "Job Service Procedure"],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Risk is defined as the combination of the ______ and consequence(s) of a specified undesirable event occurring.",
    textAr: "يُعرف الخطر بأنه مزيج من ______ وعواقب حدوث حدث غير مرغوب فيه محدد.",
    options: ["Likelihood (probability)", "Cost", "Duration of the task", "Number of workers"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The three vital components of a personal fall arrest system are known as the ABC and are:",
    textAr: "المكونات الحيوية الثلاثة لنظام الحماية من السقوط تعرف باسم ABC وهي:",
    options: ["Anchorage, Body Support, Connection", "Alloy, Belt, Clamp", "Anchor, Buckle, Cable", "Angle, Brace, Clasp"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The recommended safe lifting angle for slings is 60 degrees; sling angles less than ______ degrees above the horizontal shall not be used.",
    textAr: "زاوية الرفع الآمنة الموصى بها للرافعات هي 60 درجة؛ ويجب عدم استخدام زوايا أقل من ______ درجة فوق المستوى الأفقي.",
    options: ["30 degrees", "45 degrees", "20 degrees", "15 degrees"],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which of the following is NOT a scaffold tagging system color?",
    textAr: "أي من الألوان التالية ليس من ألوان نظام وضع العلامات على السقالات؟",
    options: ["Red", "Yellow", "Green", "Blue"],
    correctAnswers: [3],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Red and white danger tape may only be crossed or removed by:",
    textAr: "لا يجوز عبور أو إزالة شريط الخطر الأحمر والأبيض إلا بواسطة:",
    options: [
      "Personnel authorized to fix or remove the hazard",
      "Any worker with a valid work permit",
      "The site nurse",
      "Any visitor with a safety briefing",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },

  // ─────────────────────────── FINAL TEST (20) ───────────────────────────
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Prequalification is a mandatory requirement for all those who wish to work for SEC; contracts can only be awarded to pre-qualified contractors.",
    textAr: "تأهيل المقاولين مسبقاً متطلب إلزامي لكل من يرغب في العمل مع الشركة؛ ولا يجوز منح العقود إلا للمقاولين المؤهلين مسبقاً.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "No work shall be commenced on any SE location without an approved OHS work commencement certificate being issued.",
    textAr: "لا يجوز البدء بأي عمل في أي موقع تابع للشركة دون إصدار شهادة بدء عمل معتمدة للسلامة والصحة المهنية.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "A full body harness is an assembly of interconnected shoulder and leg straps designed to spread the load over the body and prevent the wearer from falling out.",
    textAr: "الحزام الواقي الكامل للجسم هو مجموعة من أشرطة الكتف والساق المترابطة المصممة لتوزيع الحمل على الجسم ومنع مرتديها من السقوط خارجها.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.fullBodyHarness,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "The use of body belts with web lanyards for fall arrest is strictly prohibited on all SE facilities, projects and sites.",
    textAr: "استخدام الأحزمة الجسدية مع الحبال القماشية لمنع السقوط ممنوع منعاً باتاً في جميع مرافق الشركة ومشاريعها ومواقعها.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "A personal fall arrest system is designed to arrest only one fall; once used to arrest a fall, it must be removed from service.",
    textAr: "نظام الحماية من السقوط مصمم لإيقاف سقوط واحد فقط؛ وبمجرد استخدامه لإيقاف سقوط يجب إخراجه من الخدمة.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Aluminum or metal ladders are strictly prohibited in substations and near electrical equipment; only non-conductive fiberglass ladders shall be used.",
    textAr: "سلالم الألمنيوم أو المعدنية ممنوعة منعاً باتاً في المحطات وبالقرب من المعدات الكهربائية؛ ويجب استخدام سلالم الألياف الزجاجية غير الموصلة فقط.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Electrical equipment and lines shall be considered energized until determined to be de-energized by testing and grounding by an authorized electrician.",
    textAr: "يجب اعتبار المعدات والخطوط الكهربائية موصلة بالطاقة حتى يتم التأكد من فصلها عن طريق الاختبار والتأريض بواسطة كهربائي معتمد.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Scaffolding shall not be erected, used or worked on in storm or high wind conditions in excess of 40 miles per hour (65 km/h).",
    textAr: "لا يجوز تركيب السقالات أو استخدامها أو العمل عليها في ظروف العواصف أو الرياح العاتية التي تتجاوز 40 ميلاً في الساعة (65 كم/ساعة).",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Work shall not be performed on energized electrical equipment unless the nature of the task requires the work to be performed while the equipment is energized.",
    textAr: "لا يجوز تنفيذ أعمال على المعدات الكهربائية الحية إلا إذا كانت طبيعة المهمة تتطلب تنفيذ العمل بينما المعدة موصلة بالطاقة.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Using the risk matrix, the risk rating for each combination of consequence and likelihood could be:",
    textAr: "باستخدام مصفوفة المخاطر، يمكن أن يكون تصنيف الخطر لكل مجموعة من الشدة والاحتمالية:",
    options: ["Extreme, High, Moderate or Low", "Critical, Severe or Minor", "High, Medium or Low", "Level 1 to Level 10"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The most significant step in the risk management process is:",
    textAr: "أهم خطوة في عملية إدارة المخاطر هي:",
    options: [
      "Hazard identification",
      "Establishing the scope",
      "Treating the risks",
      "Communication and consultation",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.hira,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Portable ladders shall be constructed to have a load rating of not less than:",
    textAr: "يجب أن تكون السلالم المحمولة مصممة لتحمل حمولة لا تقل عن:",
    options: ["120 kg", "80 kg", "150 kg", "200 kg"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "A dual (twin) lanyard system is used to ensure that:",
    textAr: "يُستخدم نظام الحبل المزدوج (اللانيارد المزدوج) لضمان:",
    options: [
      "At least one connection point is maintained at all times",
      "Two workers can be secured simultaneously",
      "The lanyard can support twice the load",
      "The worker can work without a harness",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.lanyard,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Slings and other rigging hardware shall have a minimum design safety factor of:",
    textAr: "يجب أن يكون عامل الأمان التصميمي الأدنى للرافعات ومعدات الرفع الأخرى:",
    options: ["5", "2", "3", "10"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which of the following requires a documented Critical Lift Plan?",
    textAr: "أي مما يلي يتطلب خطة رفع حرجة موثقة؟",
    options: [
      "Lifting a load of 10 tons or more",
      "Lifting a load of less than 1 ton",
      "Moving a load within a warehouse using a forklift",
      "Lifting with hand chain blocks",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Crane lifts shall not be performed in wind speeds exceeding:",
    textAr: "لا يجوز إجراء رافعات الرفع في سرعات رياح تتجاوز:",
    options: ["32 km/h (20 mph)", "50 km/h (31 mph)", "60 km/h (37 mph)", "25 km/h (15 mph)"],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Residual current devices (RCDs) used with portable electric power tools shall have a maximum rated tripping current of:",
    textAr: "يجب أن يكون الحد الأقصى لتيار الفصل المقدر لأجهزة التيار المتبقي (RCD) المستخدمة مع الأدوات الكهربائية المحمولة:",
    options: ["10 mA", "30 mA", "100 mA", "500 mA"],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "White and blue barricade tape is used to delineate:",
    textAr: "شريط الحواجز الأبيض والأزرق يستخدم لتحديد:",
    options: [
      "Areas where specific commissioning activities are taking place",
      "Hazards to people, plant and the environment",
      "Work areas requiring supervisor authorization",
      "Excavation boundaries",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.barricadeTape,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "An arc flash suit shall be worn as required when working on or near electrical equipment, in addition to PPE such as flame resistant clothing, hardhat, safety glasses and rubber gloves with leather protectors.",
    textAr: "يجب ارتداء بدلة وميض القوس الكهربائي عند الحاجة عند العمل على أو بالقرب من المعدات الكهربائية، بالإضافة إلى معدات الوقاية مثل الملابس المقاومة للهب والخوذة ونظارات السلامة والقفازات المطاطية مع الواقيات الجلدية.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.arcFlashSuit,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Hand-operated circular saws (e.g., Skilsaws) shall be fitted with:",
    textAr: "يجب أن تكون المناشير الدائرية اليدوية (مثل Skilsaw) مزودة بـ:",
    options: [
      "A retractable spring-loaded guard that allows only the working part of the blade to be exposed",
      "A fixed guard covering the whole blade",
      "A trigger lock to hold the switch on",
      "A homemade guard made on site",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.sawGuard,
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
    durationHours: 6,
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
          category: "Construction Safety",
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

  console.log("=== SEED CONSTRUCTION SAFETY QUESTIONS COMPLETE ===");
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
