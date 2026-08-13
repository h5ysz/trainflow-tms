// GCCLAB TMS — Seed the bilingual question bank for "Confined Space Safety" (SSF02)
// =====================================================================
// Source: Confined Space Safety (SSF02), Specific Safety Short Course.
// Creates the course (if missing) with passScore=70 + pre/final tests enabled,
// then (re)seeds 10 PRE_TEST + 20 FINAL_TEST questions.
// Question types: TRUE_FALSE and SINGLE_CHOICE. text = English, textAr = Arabic.
// Idempotent: existing questions for the course are soft-deleted before re-insert.

import { PrismaClient } from "@prisma/client";
import { translateOptions } from "./options-ar";

const prisma = new PrismaClient();

const COURSE_CODE = "SSF02";
const COURSE_TITLE = "Confined Space Safety";
const COURSE_TITLE_AR = "سلامة الأماكن المغلقة";

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
  entry: "/question-images/ssf02/figure-1-2-confined-space-entry.png",
  gasTesting: "/question-images/ssf02/figure-1-6-gas-testing.png",
  preEntry: "/question-images/ssf02/figure-1-9-pre-entry-preparations.png",
  ppe: "/question-images/ssf02/figure-1-11-rescue.png",
};

const QUESTIONS: SeedQuestion[] = [
  // ─────────────────────────── PRE-TEST (10) ───────────────────────────
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "A confined space is designed for continuous human occupancy.",
    textAr: "الأماكن المغلقة مصممة لشغل مستمر من قبل البشر.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "An excavated trench that is 1.2 m (4 ft) or more in depth is considered a confined space.",
    textAr: "الخندق المحفور بعمق 1.2 متر (4 أقدام) أو أكثر يُعتبر مكانًا مغلقًا.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.entry,
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "A valid Confined Space Entry (CSE) permit must be issued before anyone enters a confined space.",
    textAr: "يجب إصدار تصريح دخول صالح للأماكن المغلقة قبل دخول أي شخص إلى المكان المغلق.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.preEntry,
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "CO₂ fire extinguishers may be used inside confined spaces because they are safe for breathing.",
    textAr: "يجوز استخدام طفايات ثاني أكسيد الكربون داخل الأماكن المغلقة لأنها آمنة للتنفس.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The acceptable oxygen concentration range for entering a confined space is:",
    textAr: "نطاق تركيز الأكسجين المقبول لدخول الأماكن المغلقة هو:",
    options: ["19.5% – 21%", "18% – 20%", "20.5% – 23.5%", "17% – 19.5%"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.gasTesting,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which of the following is an example of a confined space?",
    textAr: "أي مما يلي يُعد مثالاً على الأماكن المغلقة؟",
    options: ["Storage tanks", "Manholes", "Boilers and steam generators", "All of the above"],
    correctAnswers: [3],
    difficulty: "EASY",
    imageUrl: IMG.entry,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Who is responsible for monitoring the internal and external activities of a confined space entry?",
    textAr: "من المسؤول عن مراقبة الأنشطة الداخلية والخارجية للدخول إلى المكان المغلق؟",
    options: ["The entrant", "The standby man (attendant)", "The rescue team", "The gas tester"],
    correctAnswers: [1],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "A standby man must never:",
    textAr: "يجب على رجل الاستعداد (المراقب) أبدًا أن:",
    options: ["Leave the entry point without relief", "Enter the confined space", "Perform other duties that interfere with standby duties", "All of the above"],
    correctAnswers: [3],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which of the following is a characteristic of a permit-required confined space?",
    textAr: "أي مما يلي يُعد من خصائص الأماكن المغلقة التي تتطلب تصريحًا؟",
    options: ["Contains or could contain a hazardous atmosphere", "Has the potential for engulfing the entrant", "Has an internal configuration where the entrant could be trapped or asphyxiated", "All of the above"],
    correctAnswers: [3],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The standby man must maintain continuous ______ with the entrants.",
    textAr: "يجب على رجل الاستعداد الحفاظ على ______ مستمرة مع الداخلين.",
    options: ["two-way communication", "written notes", "one-way voice contact", "visual signals only"],
    correctAnswers: [0],
    difficulty: "EASY",
  },

  // ─────────────────────────── FINAL TEST (20) ───────────────────────────
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "A confined space has limited or restricted means of entry or exit and is not designed for continuous occupancy.",
    textAr: "المكان المغلق له وسائل دخول أو خروج محدودة وليس مصممًا للإشغال المستمر.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Only gas testers certified by Saudi Energy (Saudi Electrical Company) can perform atmospheric gas tests.",
    textAr: "فقط مختبرو الغازات المعتمدون من شركة الطاقة السعودية (الشركة السعودية للكهرباء) يمكنهم إجراء اختبارات الغاز في الأجواء.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.gasTesting,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Initial gas testing must be performed before entry with all mechanical ventilation shut down at least 15 minutes before testing.",
    textAr: "يجب إجراء اختبار الغاز الأولي قبل الدخول مع إيقاف جميع التهوية الميكانيكية قبل الاختبار بـ 15 دقيقة على الأقل.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.gasTesting,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "A single closed valve is an acceptable method of isolation for confined space entry.",
    textAr: "الصمام المغلق المفرد طريقة مقبولة للعزل قبل دخول الأماكن المغلقة.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Each authorized entrant shall wear a full body harness with a retrieval line attached.",
    textAr: "يجب أن يرتدي كل شخص مصرح له بالدخول حزام جسم كامل مع حبل استرجاع مثبت.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.ppe,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which of the following must be checked during atmospheric gas testing of a confined space?",
    textAr: "أي مما يلي يجب فحصه أثناء اختبار الغاز الجوي للمكان المغلق؟",
    options: ["Oxygen concentration", "Flammability (LEL) of combustible gases", "Toxic gases such as CO and H₂S", "All of the above"],
    correctAnswers: [3],
    difficulty: "MEDIUM",
    imageUrl: IMG.gasTesting,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "According to the gas test information table, if the combustible gas reading is 10% LEL or above, the action required is:",
    textAr: "وفقًا لجدول معلومات اختبار الغاز، إذا كانت قراءة الغاز القابل للاشتعال 10% LEL أو أكثر، فإن الإجراء المطلوب هو:",
    options: ["Continue work with normal PPE", "Breathing apparatus must be used", "No work or confined space entry is allowed", "Notify the fire watch only"],
    correctAnswers: [2],
    difficulty: "HARD",
    imageUrl: IMG.gasTesting,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "At least one ______ fire extinguisher must be near each designated confined space entry point.",
    textAr: "يجب توفير طفاية حريق ______ واحدة على الأقل بالقرب من كل نقطة دخول مخصصة للأماكن المغلقة.",
    options: ["30-lb non-CO₂", "10-lb CO₂", "5-lb dry powder", "20-lb foam"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Hot work in, or on the exterior surfaces of, an occupied confined space shall not commence until:",
    textAr: "لا يجوز بدء الأعمال الساخنة داخل أو على الأسطح الخارجية لمكان مغلق مشغول حتى:",
    options: ["A hot work permit has been issued", "The worker calls the supervisor", "The standby man gives verbal permission", "The space is evacuated for one hour"],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which of the following is part of the standby man's responsibilities?",
    textAr: "أي مما يلي يُعد جزءًا من مسؤوليات رجل الاستعداد؟",
    options: ["Monitors activities inside and outside the confined space", "Maintains two-way communication with entrants", "Orders evacuation when an unsafe condition develops", "All of the above"],
    correctAnswers: [3],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which statement about the Confined Space Entry (CSE) supervisor is correct?",
    textAr: "أي عبارة حول مشرف دخول الأماكن المغلقة صحيحة؟",
    options: ["He must be trained and experienced in gas tests and gas monitoring", "He terminates an entry when job conditions change or an emergency arises", "He documents safety requirements on the CSE permit", "All of the above"],
    correctAnswers: [3],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Portable electric equipment and lighting used in confined spaces shall be operated at ______ volts or less.",
    textAr: "يجب أن تعمل المعدات الكهربائية المحمولة والإضاءة المستخدمة في الأماكن المغلقة بجهد ______ فولت أو أقل.",
    options: ["18", "110", "220", "380"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "If a hazardous atmosphere cannot be made safe for entry, the entrant must use:",
    textAr: "إذا تعذر جعل الجو الخطر آمنًا للدخول، فيجب على الداخل استخدام:",
    options: ["A simple dust mask", "Self-contained or supplied-air breathing apparatus", "A half-face filter respirator", "A paper surgical mask"],
    correctAnswers: [1],
    difficulty: "MEDIUM",
    imageUrl: IMG.ppe,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The medical fitness certificate for confined space entrants is valid for a period not exceeding:",
    textAr: "شهادة اللياقة الطبية للداخلين إلى الأماكن المغلقة صالحة لمدة لا تتجاوز:",
    options: ["6 months", "1 year", "2 years", "5 years"],
    correctAnswers: [2],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Where a hazardous atmosphere or the potential for engulfment exists, every entrant must wear:",
    textAr: "عند وجود جو خطر أو احتمال ابتلاع، يجب على كل داخل ارتداء:",
    options: ["A full body harness with a retrieval line attached", "A reflective vest only", "Wrist bands for identification", "A cotton coverall only"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.ppe,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Residual flammable product inside equipment is usually purged using:",
    textAr: "عادةً ما يتم إزالة المنتج القابل للاشتعال المتبقي داخل المعدات باستخدام:",
    options: ["An inert gas such as nitrogen", "Compressed air", "Steam only", "Water flooding"],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "If visual or oral communication with entrants is not possible, the standby man may use:",
    textAr: "إذا تعذر التواصل البصري أو الشفهي مع الداخلين، فقد يستخدم رجل الاستعداد:",
    options: ["A system of rope signals", "Knocking on the wall", "Smoke signals", "No communication is needed"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The Confined Space Entry permit shall be revalidated when there is:",
    textAr: "يجب إعادة التحقق من تصريح دخول الأماكن المغلقة عند وجود:",
    options: ["A change in the person responsible for the work", "A significant break in work continuity", "A significant change in the atmosphere or work performed", "All of the above"],
    correctAnswers: [3],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Before starting a CSE job, the entrant must:",
    textAr: "قبل بدء عمل الدخول إلى مكان مغلق، يجب على الداخل:",
    options: ["Review the CSE plan and work permits", "Understand hazards, precautions and emergency procedures", "Know the effects of exposure to hazardous substances", "All of the above"],
    correctAnswers: [3],
    difficulty: "EASY",
    imageUrl: IMG.preEntry,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Confined space entry points must be kept clear for easy access and egress, especially for emergency vehicles and personnel.",
    textAr: "يجب إبقاء نقاط دخول الأماكن المغلقة خالية لسهولة الدخول والخروج، خاصة لمركبات وأفراد الطوارئ.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
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
          optionsAr: JSON.stringify(translateOptions(q.options)),
          correctAnswers: JSON.stringify(q.correctAnswers),
          points: 1,
          order: q.order,
          isActive: true,
          category: "Confined Space",
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

  console.log("=== SEED CONFINED SPACE QUESTIONS COMPLETE ===");
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
