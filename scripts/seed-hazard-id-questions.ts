// GCCLAB TMS — Seed the bilingual question bank for "Hazard Identification & Risk Assessment" (SAF04)
// =====================================================================
// Source: Hazard Identification & Risk Assessment (HIRA) SAF04, Safety Short Course, March 2026.
// Creates the course (if missing) with passScore=70 + pre/final tests enabled,
// then (re)seeds 10 PRE_TEST + 20 FINAL_TEST questions.
// Question types: TRUE_FALSE and SINGLE_CHOICE. text = English, textAr = Arabic.
// Idempotent: existing questions for the course are soft-deleted before re-insert.

import { PrismaClient } from "@prisma/client";
import { translateOptions } from "./options-ar";

const prisma = new PrismaClient();

const COURSE_CODE = "SAF04";
const COURSE_TITLE = "Hazard Identification & Risk Assessment";
const COURSE_TITLE_AR = "تحديد المخاطر وتقييمها";

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
  hiraProcess: "/question-images/hra01/figure-2-1-hira-process.png",
  riskManagement: "/question-images/hra01/figure-2-2-risk-management.png",
  riskAnalysis: "/question-images/hra01/figure-2-3-risk-analysis.png",
  riskMatrix: "/question-images/hra01/figure-2-4-risk-matrix.png",
  raci: "/question-images/hra01/figure-2-5-raci-matrix.png",
};

const QUESTIONS: SeedQuestion[] = [
  // ─────────────────────────── PRE-TEST (10) ───────────────────────────
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "A hazard is a condition or practice with the potential for accidental loss or harm.",
    textAr: "الخطر هو حالة أو ممارسة تحمل احتمالية حدوث فقدان أو ضرر عرضي.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Risk is the combination of the probability of an event and its consequence.",
    textAr: "الخطر هو مزيج من احتمالية وقوع حدث ونتيجته.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.riskManagement,
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Personal Protective Equipment (PPE) is the most effective control in the hierarchy of risk controls.",
    textAr: "معدات الحماية الشخصية هي الأكثر فعالية في التسلسل الهرمي للتحكم في المخاطر.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "Substitution means physically removing the hazard from the workplace.",
    textAr: "الاستبدال يعني إزالة الخطر فيزيائيًا من مكان العمل.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which of the following best defines a hazard?",
    textAr: "أي مما يلي يعرّف الخطر بشكل أفضل؟",
    options: ["The chance of an accident", "A condition with the potential for harm", "A past incident report", "The severity of an injury"],
    correctAnswers: [1],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The most effective control in the hierarchy of risk controls is:",
    textAr: "أكثر الضوابط فعالية في التسلسل الهرمي للتحكم في المخاطر هو:",
    options: ["Personal Protective Equipment", "Elimination", "Administrative controls", "Engineering controls"],
    correctAnswers: [1],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The risk assessment form must remain ______ for the duration of the work activity or job.",
    textAr: "يجب أن يبقى نموذج تقييم المخاطر ______ طوال مدة نشاط العمل أو المهمة.",
    options: ["In the office", "At the point of operation", "With the safety committee", "At the manager's desk"],
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which of the following is the least effective control in the hierarchy of risk controls?",
    textAr: "أي مما يلي يُعد أقل الضوابط فعالية في التسلسل الهرمي للتحكم في المخاطر؟",
    options: ["Elimination", "Substitution", "Engineering controls", "Personal Protective Equipment (PPE)"],
    correctAnswers: [3],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Which of the following is an example of a workplace hazard?",
    textAr: "أي مما يلي يُعد مثالاً على خطر في مكان العمل؟",
    options: ["A wet floor", "Exposure to electricity", "Working at height", "All of the above"],
    correctAnswers: [3],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Risks reduced to an ALARP level are limited to which risk levels in the risk matrix?",
    textAr: "المخاطر المخفَّضة إلى مستوى ALARP تقتصر على أي مستويات مخاطر في مصفوفة المخاطر؟",
    options: ["High or Extreme", "Medium or Low", "Extreme only", "High only"],
    correctAnswers: [1],
    difficulty: "HARD",
    imageUrl: IMG.riskMatrix,
  },

  // ─────────────────────────── FINAL TEST (20) ───────────────────────────
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Elimination means physically removing the hazard from the workplace.",
    textAr: "الإزالة (Elimination) تعني إزالة الخطر فيزيائيًا من مكان العمل.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Risk assessments must be completed by a team of people who will undertake, manage, or supervise the activity.",
    textAr: "يجب إجراء تقييمات المخاطر بواسطة فريق من الأشخاص الذين سينفذون النشاط أو يديرونه أو يشرفون عليه.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.riskManagement,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Residual risk is the risk that remains after considering the existing safeguards.",
    textAr: "الخطر المتبقي هو الخطر الذي يبقى بعد النظر في الضمانات/الضوابط الحالية.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.riskAnalysis,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "The inherent risk is calculated assuming the mitigations and prevention measures in the design are in place.",
    textAr: "يُحسب الخطر الجوهري بافتراض وجود إجراءات التخفيف والوقاية في التصميم.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "HARD",
    imageUrl: IMG.riskAnalysis,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "ALARP risks are limited to 'Medium' or 'Low' risk levels in the risk matrix.",
    textAr: "مخاطر ALARP تقتصر على مستويات 'متوسط' أو 'منخفض' في مصفوفة المخاطر.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.riskMatrix,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The five levels of the hierarchy of risk control from most to least effective are:",
    textAr: "المستويات الخمسة للتسلسل الهرمي للتحكم في المخاطر من الأكثر إلى الأقل فعالية هي:",
    options: [
      "Elimination, Substitution, Engineering, Administrative, PPE",
      "PPE, Administrative, Engineering, Substitution, Elimination",
      "Substitution, Elimination, Administrative, Engineering, PPE",
      "Engineering, Elimination, PPE, Substitution, Administrative",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which technique uses guidewords to systematically identify and assess hazards?",
    textAr: "أي تقنية تستخدم كلمات إرشادية لتحديد وتقييم المخاطر بشكل منهجي؟",
    options: ["JSA", "HAZID", "QRA", "LOPA"],
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Bow-Tie analysis visually shows the relationships between:",
    textAr: "تحليل ربطة العنق (Bow-Tie) يوضح بصريًا العلاقات بين:",
    options: ["Only causes and consequences", "Hazards, their causes (threats), consequences, and existing safeguards", "Only consequences and safeguards", "Only probability and severity"],
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Preventative safeguards are controls that:",
    textAr: "الضمانات الوقائية هي ضوابط:",
    options: ["Reduce the consequence of the hazard", "Reduce the likelihood of the cause leading to the hazard", "Transfer the risk to another party", "Increase the hazard severity"],
    correctAnswers: [1],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Mitigative safeguards are controls that:",
    textAr: "الضمانات التخفيفية هي ضوابط:",
    options: ["Reduce the consequence of the hazard", "Reduce the likelihood of the cause", "Eliminate the hazard completely", "Delay the work activity"],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Job Safety Analysis (JSA) is categorized as a ______ risk assessment technique.",
    textAr: "تحليل سلامة العمل (JSA) يُصنف كتقنية تقييم مخاطر ______.",
    options: ["Qualitative", "Semi-quantitative", "Quantitative", "Deterministic"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Quantitative Risk Assessment (QRA) is categorized as a ______ risk assessment technique.",
    textAr: "تقييم المخاطر الكمي (QRA) يُصنف كتقنية تقييم مخاطر ______.",
    options: ["Qualitative", "Semi-quantitative", "Quantitative", "Subjective"],
    correctAnswers: [2],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The inherent risk is calculated by estimating:",
    textAr: "يُحسب الخطر الجوهري من خلال تقدير:",
    options: ["The likelihood of the causes and the impact of the hazard without considering safeguards", "Only the existing safeguards", "The residual risk after controls", "The financial cost of the incident"],
    correctAnswers: [0],
    difficulty: "HARD",
    imageUrl: IMG.riskAnalysis,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Where must the risk assessment form be kept during the work activity, and updated when risks change?",
    textAr: "أين يجب الاحتفاظ بنموذج تقييم المخاطر أثناء نشاط العمل وتحديثه عند تغير المخاطر؟",
    options: ["At the point of operation, communicated to all employees", "In a locked filing cabinet", "At the company headquarters", "Only with the external auditor"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.hiraProcess,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "According to the risk matrix, unacceptable risk starts from which level?",
    textAr: "وفقًا لمصفوفة المخاطر، يبدأ الخطر غير المقبول من أي مستوى؟",
    options: ["Low", "Medium", "Very Low", "Negligible"],
    correctAnswers: [1],
    difficulty: "HARD",
    imageUrl: IMG.riskMatrix,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "A representative from which field must be included in every HAZID study?",
    textAr: "يجب إدراج ممثل من أي مجال في كل دراسة تحديد المخاطر HAZID؟",
    options: ["Finance", "HSE field", "Procurement", "Public relations"],
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which of the following is an example of an engineering control?",
    textAr: "أي مما يلي يُعد مثالاً على ضوابط هندسية؟",
    options: ["Installing machine guards and ventilation systems", "Job rotation and safety signs", "Wearing gloves and hard hats", "Writing standard operating procedures"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Which of the following is an example of an administrative control?",
    textAr: "أي مما يلي يُعد مثالاً على ضوابط إدارية؟",
    options: ["Guards on moving parts", "Procedures, training, and job rotation", "Secondary containment", "Pressure safety valves"],
    correctAnswers: [1],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Layer of Protection Analysis (LOPA) is categorized as a ______ risk assessment technique.",
    textAr: "تحليل طبقة الحماية (LOPA) يُصنف كتقنية تقييم مخاطر ______.",
    options: ["Qualitative", "Semi-quantitative", "Quantitative", "Empirical"],
    correctAnswers: [1],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The RACI matrix is used to define:",
    textAr: "تُستخدم مصفوفة RACI لتحديد:",
    options: ["Roles and responsibilities (Responsible, Accountable, Consulted, Informed)", "The cost of risk controls", "The order of risk treatment", "The hierarchy of controls"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.raci,
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
    durationHours: 12,
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
          category: "Risk Assessment",
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

  console.log("=== SEED HAZARD IDENTIFICATION & RISK ASSESSMENT QUESTIONS COMPLETE ===");
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
