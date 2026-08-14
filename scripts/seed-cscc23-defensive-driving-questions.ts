// GCCLAB TMS — Seed the bilingual question bank for "Defensive Driving" (CSCC23)
// =====================================================================
// Source: Defensive Driving (CSCC23), Safety Short Course.
// Creates the course (if missing) with passScore=70 + pre/final tests enabled,
// then (re)seeds 10 PRE_TEST + 20 FINAL_TEST questions.
// Question types: TRUE_FALSE and SINGLE_CHOICE. text = English, textAr = Arabic.
// Idempotent: existing questions for the course are soft-deleted before re-insert.

import { PrismaClient } from "@prisma/client";
import { translateOptions } from "./options-ar";

const prisma = new PrismaClient();

const COURSE_CODE = "CSCC23";
const COURSE_TITLE = "Defensive Driving";
const COURSE_TITLE_AR = "القيادة الدفاعية";

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
  reactionDistance: "/question-images/cscc23/figure-1-reaction-distance.png",
  followingDistance: "/question-images/cscc23/figure-2-following-distance.png",
  brakingDistance: "/question-images/cscc23/figure-3-braking-distance.png",
  lanePosition: "/question-images/cscc23/figure-4-lane-position.png",
  blindSpots: "/question-images/cscc23/figure-5-blind-spots.png",
  roundabout: "/question-images/cscc23/figure-6-roundabout.png",
  merging: "/question-images/cscc23/figure-7-merging.png",
  overtaking: "/question-images/cscc23/figure-8-overtaking.png",
  trafficJam: "/question-images/cscc23/figure-9-traffic-jam.png",
  nightDriving: "/question-images/cscc23/figure-10-night-driving.png",
  weatherDriving: "/question-images/cscc23/figure-11-weather-driving.png",
  highwayDriving: "/question-images/cscc23/figure-12-highway-driving.png",
  cityDriving: "/question-images/cscc23/figure-13-city-driving.png",
  intersection: "/question-images/cscc23/figure-14-intersection.png",
  mountainRoads: "/question-images/cscc23/figure-15-mountain-roads.png",
  highwayExit: "/question-images/cscc23/figure-16-highway-exit.png",
  trafficSigns: "/question-images/cscc23/figure-17-traffic-signs.png",
  priorityRoads: "/question-images/cscc23/figure-18-priority-roads.png",
};

const TRUE_FALSE_OPTIONS = ["True", "False"];

const QUESTIONS: SeedQuestion[] = [
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What is defensive driving?",
    textAr: "ما هي القيادة الدفاعية؟",
    options: [
      "Driving in a way that anticipates hazards and prepares to react to other road users",
      "Driving at the maximum speed at all times",
      "Driving with one hand on the wheel",
      "Racing on public roads",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Wearing a seatbelt reduces the risk of fatal injury to the driver by approximately:",
    textAr: "ارتداء حزام الأمان يقلل من خطر الإصابة المميتة للسائق بنسبة تقارب:",
    options: ["50%", "10%", "5%", "2%"],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What is the recommended minimum following distance under normal conditions?",
    textAr: "ما هي المسافة الدنيا الموصى بها للتبعية في الظروف العادية؟",
    options: [
      "The two-second rule",
      "Half a car length",
      "One meter",
      "No distance is needed",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.followingDistance,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "The time a driver needs to perceive a hazard and move the foot to the brake is called:",
    textAr: "الوقت الذي يحتاجه السائق لإدراك الخطر وتحريك القدم نحو الفرامل يسمى:",
    options: ["Reaction time", "Braking time", "Driving time", "Rest time"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.reactionDistance,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Normal driver reaction time is approximately:",
    textAr: "زمن رد الفعل الطبيعي للسائق يبلغ تقريباً:",
    options: ["0.25 to 0.75 seconds", "5 to 10 seconds", "2 to 5 minutes", "1 to 2 hours"],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "While driving, using a mobile phone:",
    textAr: "أثناء القيادة، استخدام الهاتف المحمول:",
    options: [
      "Distracts the driver and increases the risk of accidents",
      "Is safe if the driver holds it near the wheel",
      "Has no effect on driving",
      "Is allowed at any time",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Before changing lanes, the driver must:",
    textAr: "قبل تغيير المسار، يجب على السائق:",
    options: [
      "Check mirrors and blind spots, and signal",
      "Honk and change immediately",
      "Close his eyes and count",
      "Increase speed rapidly",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.blindSpots,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "What should a driver do when approaching a yellow traffic light?",
    textAr: "ماذا يجب على السائق فعله عند الاقتراب من إشارة مرور صفراء؟",
    options: [
      "Prepare to stop safely",
      "Accelerate immediately",
      "Ignore the signal",
      "Close the eyes",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.trafficSigns,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "PRE_TEST",
    text: "Driving while drowsy or tired:",
    textAr: "القيادة أثناء النعاس أو التعب:",
    options: [
      "Reduces reaction time and is dangerous",
      "Has the same effect as driving normally",
      "Only affects long trips",
      "Is safer than driving alert",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "TRUE_FALSE",
    testType: "PRE_TEST",
    text: "A defensive driver should always be prepared for the mistakes of other road users.",
    textAr: "يجب أن يكون السائق الدفاعي مستعداً دائماً لأخطاء مستخدمي الطريق الآخرين.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What is the main cause of most road accidents?",
    textAr: "ما هو السبب الرئيسي لمعظم حوادث الطرق؟",
    options: [
      "Human error",
      "Vehicle color",
      "Road width",
      "Weather only",
    ],
    correctAnswers: [0],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "The total stopping distance of a vehicle equals:",
    textAr: "مسافة التوقف الكلية للمركبة تساوي:",
    options: [
      "Reaction distance + braking distance",
      "Reaction distance only",
      "Braking distance only",
      "The vehicle length",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.brakingDistance,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "When the road is wet or slippery, the driver should:",
    textAr: "عندما يكون الطريق مبللاً أو زلقاً، يجب على السائق:",
    options: [
      "Reduce speed and increase the following distance",
      "Increase speed",
      "Brake hard frequently",
      "Drive in the opposite lane",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.weatherDriving,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "When driving at night, the driver should:",
    textAr: "عند القيادة ليلاً، يجب على السائق:",
    options: [
      "Use headlights and reduce speed",
      "Drive without headlights",
      "Follow the car in front very closely",
      "Use only parking lights",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.nightDriving,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "When merging onto a highway, the driver should:",
    textAr: "عند الاندماج في الطريق السريع، يجب على السائق:",
    options: [
      "Use the acceleration lane and match the speed of traffic",
      "Stop at the entrance",
      "Merge without looking",
      "Back up onto the highway",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.merging,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "At an uncontrolled intersection, a defensive driver should:",
    textAr: "عند تقاطع غير مضبوط بالإشارات، يجب على السائق الدفاعي:",
    options: [
      "Slow down, look in all directions, and be ready to stop",
      "Cross immediately without slowing",
      "Close his eyes and cross",
      "Sound the horn and speed up",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.intersection,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Before overtaking another vehicle, the driver must ensure that:",
    textAr: "قبل تجاوز مركبة أخرى، يجب على السائق التأكد من أن:",
    options: [
      "The road ahead is clear and overtaking is safe and legal",
      "He sounds the horn continuously",
      "The vehicle behind speeds up",
      "He drives on the hard shoulder",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.overtaking,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "In a roundabout, who has the right of way?",
    textAr: "في الدوار (الجولة)، من له حق الأولوية؟",
    options: [
      "Traffic already circulating inside the roundabout",
      "Traffic entering the roundabout",
      "The larger vehicle",
      "The faster vehicle",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.roundabout,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "A 'blind spot' of a vehicle is:",
    textAr: "النقطة العمياء للمركبة هي:",
    options: [
      "An area around the vehicle that cannot be seen in the mirrors",
      "The area directly in front of the windscreen",
      "The area above the roof",
      "The shadow under the vehicle",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.blindSpots,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "When driving in heavy traffic congestion, the driver should:",
    textAr: "عند القيادة في زحام مروري شديد، يجب على السائق:",
    options: [
      "Keep a safe distance, stay patient, and avoid aggression",
      "Weave between lanes quickly",
      "Use the emergency lane",
      "Honk continuously",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.trafficJam,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "On a multi-lane highway, the correct position of the vehicle is:",
    textAr: "في طريق سريع متعدد المسارات، الموضع الصحيح للمركبة هو:",
    options: [
      "Center of the lane with a safe distance from other vehicles",
      "On the lane markings",
      "Very close to the right edge",
      "Half on the shoulder",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.lanePosition,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "When a vehicle approaches from the rear very quickly, the driver should:",
    textAr: "عندما تقترب مركبة من الخلف بسرعة كبيرة، يجب على السائق:",
    options: [
      "Keep his lane, maintain speed, and let the vehicle overtake safely",
      "Brake suddenly",
      "Change lane without signaling",
      "Accelerate to race it",
    ],
    correctAnswers: [0],
    difficulty: "HARD",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "On mountain roads with sharp curves, the driver should:",
    textAr: "في الطرق الجبلية ذات المنعطفات الحادة، يجب على السائق:",
    options: [
      "Reduce speed before the curve and stay in the lane",
      "Accelerate at the curve",
      "Cross the center line",
      "Close his eyes at the curve",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.mountainRoads,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Before taking a highway exit, the driver should:",
    textAr: "قبل الخروج من الطريق السريع، يجب على السائق:",
    options: [
      "Signal early and slow down in the exit lane",
      "Brake suddenly in the fast lane",
      "Stop at the exit point",
      "Reverse into the exit",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.highwayExit,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "The faster a vehicle travels, the longer the braking distance becomes.",
    textAr: "كلما زادت سرعة المركبة، زادت مسافة الكبح.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [0],
    difficulty: "EASY",
    imageUrl: IMG.brakingDistance,
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "It is acceptable to drive while using a handheld mobile phone.",
    textAr: "من المقبول القيادة أثناء استخدام الهاتف المحمول باليد.",
    options: TRUE_FALSE_OPTIONS,
    correctAnswers: [1],
    difficulty: "EASY",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "If a driver misses a highway exit, he should:",
    textAr: "إذا فات السائق مخرج الطريق السريع، يجب عليه:",
    options: [
      "Continue to the next exit",
      "Stop and reverse on the highway",
      "Turn around immediately",
      "Drive on the emergency shoulder in reverse",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "Traffic signs that give orders or prohibitions are usually:",
    textAr: "لافتات المرور التي تعطي أوامر أو محظورات تكون عادةً:",
    options: [
      "Red, blue, or white in color",
      "Green only",
      "Black only",
      "Any color with no meaning",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
    imageUrl: IMG.trafficSigns,
  },
  {
    type: "SINGLE_CHOICE",
    testType: "FINAL_TEST",
    text: "What is the most important rule of defensive driving?",
    textAr: "ما هي أهم قاعدة في القيادة الدفاعية؟",
    options: [
      "Anticipate hazards and always be ready to react safely",
      "Always drive faster than others",
      "Never stop at intersections",
      "Follow the vehicle ahead closely",
    ],
    correctAnswers: [0],
    difficulty: "MEDIUM",
  },
  {
    type: "TRUE_FALSE",
    testType: "FINAL_TEST",
    text: "Drivers should check their mirrors every few seconds to maintain situational awareness.",
    textAr: "يجب على السائقين فحص المرايا كل بضع ثوانٍ للحفاظ على الوعي بالمحيط.",
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

  console.log("=== SEED CSCC23 DEFENSIVE DRIVING QUESTIONS COMPLETE ===");
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
