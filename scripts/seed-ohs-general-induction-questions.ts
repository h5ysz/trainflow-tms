// GCCLAB TMS — Seed the bilingual question bank for "OHS General Induction" (CSCC09)
// =====================================================================
// Source: OHS General Induction Including Office Safety (CSCC09), Contractor's Safety Course.
// Creates the course (if missing) with passScore=70 + pre/final tests enabled,
// then (re)seeds 10 PRE_TEST + 20 FINAL_TEST questions.
// Question types: TRUE_FALSE and SINGLE_CHOICE. text = English, textAr = Arabic.
// Idempotent: existing questions for the course are soft-deleted before re-insert.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const COURSE_CODE = "CSCC09";
const COURSE_TITLE = "OHS General Induction";
const COURSE_TITLE_AR = "التعريف العام بالصحة والسلامة المهنية";

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
  safetyPolicy: "/question-images/ohs01/figure-2-2-safety-policy.png",
  ppe: "/question-images/ohs01/figure-3-1-ppe.png",
  officeComputer: "/question-images/ohs01/figure-4-1-office-computer.png",
  firePyramid: "/question-images/ohs01/figure-4-2-fire-pyramid.png",
  electricShock: "/question-images/ohs01/figure-7-3-electric-shock.png",
};

const QUESTIONS: SeedQuestion[] = [
  // ─────────────────────────── PRE-TEST (10) ───────────────────────────
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Safety is everybody's responsibility, and effective cooperation is required among all to implement safety rules and procedures.",
    textAr: "السلامة مسؤولية الجميع، ويتطلب الأمر تعاونًا فعالاً بين الجميع لتنفيذ قواعد وإجراءات السلامة.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Fires of group (A), confined to normal dry flammable materials, are put out by water and foam.",
    textAr: "حرائق المجموعة (أ) التي تقتصر على المواد الجافة القابلة للاشتعال العادية تُطفأ بالماء والرغوة.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "The fire pyramid is based on a combination of four factors: fuel, oxygen, heat, and the chemical chain reaction.",
    textAr: "هرم الحريق يقوم على مزيج من أربعة عوامل: الوقود، والأكسجين، والحرارة، والتفاعل الكيميائي المتسلسل.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.firePyramid,
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Personal protective equipment must be chosen so that it conforms to international standards in order to reduce risks to the minimum level.",
    textAr: "يجب اختيار معدات الحماية الشخصية لتتوافق مع المعايير الدولية من أجل تقليل المخاطر إلى أدنى مستوى.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.ppe,
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "The human body's resistance to electric shock is the same whether the skin is dry or wet.",
    textAr: "مقاومة جسم الإنسان للصدمة الكهربائية هي نفسها سواء كان الجلد جافًا أم رطبًا.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
    imageUrl: IMG.electricShock,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Safety in general is best defined as:",
    textAr: "السلامة بشكل عام تُعرّف بأنها:",
    options: [
      "The science that seeks to protect people from dangers and prevent loss of life and property",
      "The science of increasing production speed",
      "The rules for using office machines only",
      "A procedure followed after an accident only",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Occupational safety is the science concerned with:",
    textAr: "السلامة المهنية هي العلم المعني بـ:",
    options: [
      "Protecting human safety and health from work risks by providing a safe work environment",
      "Increasing the number of workers in the workplace",
      "Designing office furniture only",
      "Reducing the cost of insurance premiums",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The basic elements of the occupational health and safety management system can be summarized in the cycle:",
    textAr: "يمكن تلخيص العناصر الأساسية لنظام إدارة الصحة والسلامة المهنية في دورة:",
    options: ["Plan, Do, Check, Act", "Plan, Act, Do, Check", "Do, Plan, Check, Act", "Check, Do, Act, Plan"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Fires confined to electrical equipment such as electrical transformers, computers, and wires belong to group:",
    textAr: "الحرائق المحصورة في المعدات الكهربائية مثل المحولات الكهربائية وأجهزة الكمبيوتر والأسلاك تنتمي إلى المجموعة:",
    options: ["A", "B", "C", "D"],
    correctAnswers: [2],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The primary, immediate and temporary care that an injured person receives until specialized medical care is provided is called:",
    textAr: "الرعاية الأولية والفورية والمؤقتة التي يتلقاها المصاب حتى يتم توفير الرعاية الطبية المتخصصة تسمى:",
    options: ["First aid", "Occupational therapy", "Preventive medicine", "Physical rehabilitation"],
    correctAnswers: [0],
    difficulty: "EASY",
  },

  // ─────────────────────────── FINAL TEST (20) ───────────────────────────
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Occupational health and safety contribute to the development of the national economy.",
    textAr: "تساهم الصحة والسلامة المهنية في تنمية الاقتصاد الوطني.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "The success of implementing occupational safety programs depends mainly on the amount of interest of the higher management.",
    textAr: "يعتمد نجاح تنفيذ برامج السلامة المهنية بشكل أساسي على مدى اهتمام الإدارة العليا.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "The worker must not operate any equipment or tools unless he is trained and authorized to do so.",
    textAr: "يجب ألا يشغّل العامل أي معدات أو أدوات إلا إذا كان مدربًا ومصرحًا له بذلك.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Any dangerous action or accident, including a near miss, must be reported to the supervisor immediately.",
    textAr: "يجب الإبلاغ عن أي تصرف خطير أو حادث، بما في ذلك الحادث الوشيك، للمشرف فورًا.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Fires of group (D) are confined to light metal materials such as aluminum and magnesium.",
    textAr: "حرائق المجموعة (د) تقتصر على المعادن الخفيفة مثل الألومنيوم والمغنيسيوم.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Smothering the fire means depriving the fire of its flammable materials (fuel).",
    textAr: "الاختناق/التغطية على الحريق يعني حرمان الحريق من المواد القابلة للاشتعال (الوقود).",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Electric current is what causes injury to humans, and not the electrical voltage.",
    textAr: "التيار الكهربائي هو الذي يسبب الإصابة للإنسان، وليس الجهد الكهربائي.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.electricShock,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Dust particles of more than 10 microns are the most dangerous because they deposit deep in the lungs.",
    textAr: "جزيئات الغبار الأكبر من 10 ميكرون هي الأخطر لأنها تترسب في أعماق الرئتين.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "HARD",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "The most important component of the OHS management system in Saudi Energy is the safety policy signed by the CEO and all representatives.",
    textAr: "أهم مكونات نظام إدارة الصحة والسلامة المهنية في شركة الطاقة السعودية هو سياسة السلامة الموقعة من الرئيس التنفيذي وجميع الممثلين.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.safetyPolicy,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The occupational health and safety management system approved by Saudi Energy is called:",
    textAr: "نظام إدارة الصحة والسلامة المهنية المعتمد لدى شركة الطاقة السعودية يسمى:",
    options: ["ISMS (Integrated Safety Management System)", "OSHA", "ISO 9001", "MSDS"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Physical ergonomics (human factors engineering) deals with:",
    textAr: "العوامل البشرية/الإرغونوميا الفيزيائية تتعامل مع:",
    options: [
      "The human response to physical loads",
      "The mind's treatment of perception and memory",
      "Improving social systems and teamwork",
      "Marketing and sales strategies",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Organizational ergonomics is concerned with:",
    textAr: "الإرغونوميا التنظيمية تهتم بـ:",
    options: [
      "Improving social systems such as work schedules, employee satisfaction and teamwork",
      "The human response to physical loads",
      "Perception and attention of the mind",
      "Designing machines and equipment",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which of the following is NOT one of the four factors of the fire pyramid?",
    textAr: "أي مما يلي ليس أحد العوامل الأربعة لهرم الحريق؟",
    options: ["Fuel", "Oxygen", "Heat", "Smoke"],
    correctAnswers: [3],
    difficulty: "EASY",
    imageUrl: IMG.firePyramid,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Fires of group (B) are confined to:",
    textAr: "حرائق المجموعة (ب) محصورة في:",
    options: [
      "Flammable liquids and gases such as petroleum, oils and acetylene",
      "Normal dry flammable materials such as wood and paper",
      "Light metals such as aluminum and magnesium",
      "Vegetable oil in kitchens",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Leather gloves protect the hands from:",
    textAr: "القفازات الجلدية تحمي اليدين من:",
    options: ["Burns and heat", "Chemicals", "Electricity", "Abrasion and infection"],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "In case of an electric shock accident, the first action must be to:",
    textAr: "في حالة حادث صدمة كهربائية، يجب أن يكون الإجراء الأول هو:",
    options: [
      "Disconnect the electrical current and remove the person using an insulating material",
      "Touch the injured person directly to pull him away",
      "Pour water on the injured person",
      "Call the police before doing anything",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.electricShock,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The resistance of dry skin to electric shock ranges from:",
    textAr: "تتراوح مقاومة الجلد الجاف للصدمة الكهربائية من:",
    options: ["3000 to 100,000 ohms", "400 to 600 ohms", "About 100 ohms", "About 1000 ohms"],
    correctAnswers: [0],
    difficulty: "HARD",
    imageUrl: IMG.electricShock,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "An electric current of 50–100 mA passing through the human body may cause:",
    textAr: "قد يتسبب تيار كهربائي مقداره 50-100 مللي أمبير يمر عبر جسم الإنسان في:",
    options: [
      "Heart disorder that may cause death",
      "A feeling of shock without pain",
      "No effect on the body",
      "Only mild discomfort",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "All exits in the office should be at least ______ wide.",
    textAr: "يجب أن تكون جميع مخارج المكتب بعرض ______ على الأقل.",
    options: ["28 inches", "18 inches", "12 inches", "36 inches"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "For a comfortable computer workstation, the screen should be ______ away from the user's eyes.",
    textAr: "للحصول على محطة عمل حاسوب مريحة، يجب أن تكون الشاشة على بعد ______ من عيني المستخدم.",
    options: ["45–60 cm", "10–20 cm", "100–120 cm", "150 cm"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.officeComputer,
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

  console.log("=== SEED OHS GENERAL INDUCTION QUESTIONS COMPLETE ===");
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
