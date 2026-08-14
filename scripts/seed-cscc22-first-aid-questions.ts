// GCCLAB TMS — Seed the bilingual question bank for "First Aid, CPR and AED" (CSCC22)
// =====================================================================
// Source: First Aid & CPR Training (CSCC22), Safety Short Course.
// Creates the course (if missing) with passScore=70 + pre/final tests enabled,
// then (re)seeds 10 PRE_TEST + 20 FINAL_TEST questions.
// Question types: TRUE_FALSE and SINGLE_CHOICE. text = English, textAr = Arabic.
// Idempotent: existing questions for the course are soft-deleted before re-insert.

import { PrismaClient } from "@prisma/client";
import { translateOptions } from "./options-ar";

const prisma = new PrismaClient();

const COURSE_CODE = "CSCC22";
const COURSE_TITLE = "First Aid, CPR and AED";
const COURSE_TITLE_AR = "الإسعافات الأولية والإنعاش القلبي الرئوي وجهاز الصدمات (AED)";

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
  handWashing: "/question-images/cscc22/figure-13-hand-washing.png",
  tourniquet: "/question-images/cscc22/figure-14-tourniquet.png",
  improvisedTourniquet: "/question-images/cscc22/figure-15-improvised-tourniquet.png",
  burnDegrees: "/question-images/cscc22/figure-16-burn-degrees.png",
  hypothermia: "/question-images/cscc22/figure-17-hypothermia.png",
  stroke: "/question-images/cscc22/figure-18-stroke-signs.png",
  amputation: "/question-images/cscc22/figure-19-amputation.png",
  nosebleed: "/question-images/cscc22/figure-20-nosebleed.png",
  chestCompressions: "/question-images/cscc22/figure-6-chest-compressions.png",
  airway: "/question-images/cscc22/figure-7-head-tilt-chin-lift.png",
  rescueBreathing: "/question-images/cscc22/figure-8-rescue-breathing.png",
  aed: "/question-images/cscc22/figure-9-aed.png",
  childCpr: "/question-images/cscc22/figure-10-child-cpr.png",
  infantCpr: "/question-images/cscc22/figure-11-infant-cpr.png",
  choking: "/question-images/cscc22/figure-12-choking-abdominal-thrusts.png",
};

const TRUE_FALSE_OPTIONS = ["True", "False"];

const QUESTIONS: SeedQuestion[] = [
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What is first aid?",
    textAr: "ما هو الإسعاف الأولي؟",
    options: [
      "Immediate medical assistance given to an injured or suddenly ill person before professional help arrives",
      "The final medical treatment in hospital",
      "A long-term rehabilitation program",
      "The use of advanced surgical equipment",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What does the abbreviation CPR stand for?",
    textAr: "ماذا يعني اختصار CPR؟",
    options: [
      "Cardiopulmonary resuscitation",
      "Chest pressure release",
      "Cardiac pulse recovery",
      "Clinical patient review",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.chestCompressions,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What is the correct compression-to-breath ratio for one-rescuer adult CPR?",
    textAr: "ما هي النسبة الصحيحة للضغطات إلى النفخات في الإنعاش القلبي الرئوي لشخص بالغ بمنقذ واحد؟",
    options: ["30 compressions to 2 breaths", "15 compressions to 1 breath", "5 compressions to 1 breath", "10 compressions to 2 breaths"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.chestCompressions,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What is the recommended depth for adult chest compressions?",
    textAr: "ما هو العمق الموصى به لضغطات الصدر للبالغين؟",
    options: ["5 to 6 cm (2 inches)", "1 to 2 cm", "10 to 15 cm", "As deep as possible"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "At what rate should adult chest compressions be performed?",
    textAr: "بأي معدل يجب أداء ضغطات الصدر للبالغين؟",
    options: ["100 to 120 compressions per minute", "60 to 80 compressions per minute", "30 to 40 compressions per minute", "150 to 180 compressions per minute"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What does AED stand for?",
    textAr: "ماذا يعني اختصار AED؟",
    options: [
      "Automated External Defibrillator",
      "Automatic Energy Device",
      "Advanced Emergency Department",
      "Auxiliary Electric Defibrillator",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.aed,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "For how long should hands be washed with soap?",
    textAr: "لمدة كم يجب فرك اليدين بالصابون؟",
    options: ["At least 20 seconds", "5 seconds", "1 minute exactly", "Until the water runs out"],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.handWashing,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What should a first aider do first in an emergency?",
    textAr: "ماذا يجب أن يفعل مقدم الإسعاف أولاً في حالة الطوارئ؟",
    options: [
      "Check the scene for safety",
      "Move the victim immediately",
      "Give water to the victim",
      "Call the victim's family first",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which emergency number can be called in Saudi Arabia?",
    textAr: "أي رقم طوارئ يمكن الاتصال به في المملكة العربية السعودية؟",
    options: ["997 or 911", "311", "188", "12345"],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "First aid is only given by doctors and nurses.",
    textAr: "الإسعاف الأولي لا يُقدم إلا من قبل الأطباء والممرضين.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "In adult CPR, which sequence is followed?",
    textAr: "في الإنعاش القلبي الرئوي للبالغين، ما التسلسل المتبع؟",
    options: [
      "C-A-B (Circulation, Airway, Breathing)",
      "B-A-C (Breathing, Airway, Circulation)",
      "A-B-C (Airway, Breathing, Circulation)",
      "C-B-A (Circulation, Breathing, Airway)",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.airway,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Before giving rescue breaths, how is the airway opened?",
    textAr: "قبل إعطاء النفخات الإنقاذية، كيف يتم فتح مجرى الهواء؟",
    options: [
      "Head-tilt and chin-lift maneuver",
      "By shaking the head strongly",
      "By pressing on the stomach",
      "By lifting both legs",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.airway,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What is used as a barrier during rescue breathing?",
    textAr: "ما الذي يُستخدم كحاجز أثناء التنفس الإنقاذي؟",
    options: [
      "A pocket mask or face shield",
      "A cotton cloth only",
      "A plastic bag",
      "Bare hands",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.rescueBreathing,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "When using an AED, what must you ensure before delivering a shock?",
    textAr: "عند استخدام جهاز الصدمات الكهربائية (AED)، ما الذي يجب التأكد منه قبل إعطاء الصدمة؟",
    options: [
      "Nobody is touching the victim",
      "The victim is sitting up",
      "The room is completely dark",
      "The victim is covered with a blanket",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.aed,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "For an adult who is choking and cannot cough, speak, or breathe, you should:",
    textAr: "لشخص بالغ مختنق لا يستطيع السعال أو الكلام أو التنفس، يجب عليك:",
    options: [
      "Perform abdominal thrusts (Heimlich maneuver)",
      "Give him water immediately",
      "Pat him on the back gently",
      "Wait and watch",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.choking,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "For an infant who is choking, which action is correct?",
    textAr: "بالنسبة لرضيع مختنق، ما التصرف الصحيح؟",
    options: [
      "Give 5 back blows and 5 chest thrusts",
      "Perform abdominal thrusts",
      "Slap the infant on the head",
      "Hold the infant upside down",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Where should chest compressions be performed on an adult?",
    textAr: "أين يجب أداء ضغطات الصدر لشخص بالغ؟",
    options: [
      "On the lower half of the breastbone (sternum) in the center of the chest",
      "On the left side of the chest",
      "On the abdomen",
      "On the neck",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.chestCompressions,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "For infant CPR, chest compressions are performed with:",
    textAr: "في الإنعاش القلبي الرئوي للرضع، تُؤدى ضغطات الصدر باستخدام:",
    options: [
      "Two fingers on the center of the chest just below the nipple line",
      "The whole palm",
      "Both fists",
      "One knee",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
    imageUrl: IMG.infantCpr,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "A tourniquet should be used:",
    textAr: "يجب استخدام العاصبة:",
    options: [
      "As a last resort to control severe bleeding that cannot be stopped otherwise, and only by trained persons",
      "For any small cut",
      "For a nosebleed",
      "For a headache",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.tourniquet,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "For a minor external bleeding wound, the first step is:",
    textAr: "بالنسبة لجرح نازف بسيط، الخطوة الأولى هي:",
    options: [
      "Apply direct pressure with a clean dressing",
      "Wash the wound with hot water only",
      "Tie a tight rope above the wound",
      "Leave the wound open and wet",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "How should a nosebleed victim be positioned?",
    textAr: "كيف يجب أن تكون وضعية شخص مصاب بنزيف الأنف؟",
    options: [
      "Sitting up, leaning forward, and pinching the nostrils",
      "Lying flat on the back",
      "Bending the head backwards",
      "Standing upside down",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.nosebleed,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Burns are classified according to their severity into:",
    textAr: "تصنف الحروق حسب شدتها إلى:",
    options: [
      "First, second, and third degree burns",
      "Mild and severe only",
      "Red and blue burns",
      "Wet and dry burns",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.burnDegrees,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "If a person's clothes catch fire, what should he do?",
    textAr: "إذا اشتعلت النيران في ملابس شخص، ماذا يجب أن يفعل؟",
    options: [
      "Stop, drop to the ground, and roll",
      "Run as fast as possible",
      "Jump into a confined area",
      "Fan the flames",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What is a sign of a stroke (using the FAST rule)?",
    textAr: "ما هي علامة من علامات السكتة الدماغية (وفق قاعدة FAST)؟",
    options: [
      "Face drooping or weakness of one arm",
      "Pain in the big toe",
      "Excessive appetite",
      "Runny nose",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.stroke,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Heat stroke is a life-threatening emergency caused by:",
    textAr: "ضربة الشمس حالة طارئة تهدد الحياة تنتج عن:",
    options: [
      "Failure of the body's temperature regulator, causing dangerously high body temperature",
      "Drinking too much water",
      "Wearing warm clothes in winter",
      "Skipping breakfast",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Hypothermia occurs when the core body temperature drops below:",
    textAr: "يحدث انخفاض درجة حرارة الجسم عندما تنخفض الحرارة الداخلية إلى أقل من:",
    options: ["35°C (95°F)", "20°C (68°F)", "30°C (86°F)", "38°C (100°F)"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.hypothermia,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "For a severed finger (amputation), the first aider should:",
    textAr: "بالنسبة لإصبع مقطوع (بتر)، يجب على مقدم الإسعاف أن:",
    options: [
      "Control bleeding, preserve the severed part in a clean damp cloth, and call emergency",
      "Reattach the part immediately",
      "Wash the part with hot water",
      "Throw the severed part away",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
    imageUrl: IMG.amputation,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "After every 30 compressions in one-rescuer CPR, the rescuer should allow the chest to fully recoil.",
    textAr: "بعد كل 30 ضغطة في الإنعاش القلبي الرئوي بمنقذ واحد، يجب السماح للصدر بالارتداد الكامل.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "An improvised tourniquet may be used as a last resort to stop severe bleeding.",
    textAr: "يجوز استخدام عاصبة مرتجلة كحل أخير لإيقاف النزيف الشديد.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.improvisedTourniquet,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "If a victim is unconscious but breathing, he should be placed in:",
    textAr: "إذا كان المصاب فاقداً للوعي ولكنه يتنفس، فيجب وضعه في:",
    options: [
      "The recovery position",
      "A sitting upright position",
      "An upside-down position",
      "Standing against a wall",
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
          category: "FIRST_AID",
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

  console.log("=== SEED CSCC22 FIRST AID QUESTIONS COMPLETE ===");
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
