// Comprehensive validation pipeline tests — covers every guard in the
// AI question-generation pipeline from material extraction through to
// the Question Bank boundary.
//
// Scenarios covered:
//   1. Grounded question (passes validation)
//   2. Hallucinated question (fails grounding)
//   3. Duplicate question (dedup layer)
//   4. Incorrect answer (structural validation)
//   5. Bilingual mismatch (consistency repair)
//   6. Irrelevant image (validateImageRelevance)
//   7. Relevant image (validateImageRelevance)
//   8. Question with no suitable image (no image attached)
//   9. Difficulty classification
//  10. PRE_TEST / FINAL_TEST isolation
//  11. End-to-end mock pipeline with all guards
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { toQuestionCreateData } from "@/lib/ai/question-generator";

// ─── Mock setup ──────────────────────────────────────────────────────────────

const mockProvider = {
  chat: vi.fn(),
};

vi.mock("@/lib/ai/provider", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    getAIProvider: () => mockProvider,
  };
});

import {
  generateBilingualQuestions,
  validateGeneratedQuestion,
  validateQuestionGrounding,
  validateCorrectAnswerStructural,
  validateDistractors,
  validateDifficultyDifferentiation,
  runPostGenerationValidation,
  dedupeQuestions,
  normalizeStem,
  similarity,
  QuestionValidationError,
  QuestionGenerationError,
  type GeneratedQuestion,
  type GeneratedQuestionType,
} from "@/lib/ai/question-generator";
import { validateImageRelevance, type ExtractedMaterialImage } from "@/lib/ai/material-images";

beforeAll(() => {
  process.env.AI_MOCK_ENABLED = "true";
});

beforeEach(() => {
  mockProvider.chat.mockClear();
});

afterAll(() => {
  delete process.env.AI_MOCK_ENABLED;
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MATERIAL_TEXT =
  "Fire extinguishers must be kept accessible and inspected regularly. " +
  "Flammable materials must be stored away from sources of heat. " +
  "Smoke and heat detectors should be tested as part of routine checks. " +
  "Fire drills must be practiced by all workers at least once a year. " +
  "Fire escape routes must always remain clear and unobstructed. " +
  "Live conductors must be isolated and proved dead before work begins. " +
  "Workers must keep the safe approach distance from overhead lines. " +
  "A valid work permit is required before live work starts.";

function mockResponse(content: unknown): void {
  mockProvider.chat.mockResolvedValueOnce({
    content: typeof content === "string" ? content : JSON.stringify(content),
    finishReason: "stop",
    model: "test-model",
  });
}

function mockConsistent(count: number): void {
  mockProvider.chat.mockResolvedValueOnce({
    content: JSON.stringify({
      questions: Array.from({ length: count }, (_, i) => ({ index: i, consistent: true })),
    }),
    finishReason: "stop",
    model: "test-model",
  });
}

function validQuestion(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: "SINGLE_CHOICE",
    text: "Fire extinguishers must be kept accessible and inspected regularly.",
    textAr: "يجب أن تكون طفايات الحريق في متناول اليد وتُفحص بانتظام.",
    options: ["Accessible and inspected", "Locked away", "Only used by supervisors"],
    optionsAr: ["في متناول اليد ومفحوصة", "مغلقة بعيداً", "يستخدمها المشرفون فقط"],
    correctAnswers: [0],
    explanation: "Fire extinguishers must be accessible and regularly inspected.",
    explanationAr: "يجب أن تكون طفايات الحريق في متناول اليد ومفحوصة بانتظام.",
    difficulty: "EASY",
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 1: Grounded question (passes validation)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Scenario 1: Grounded question", () => {
  it("validateQuestionGrounding returns true when key words overlap with material", () => {
    const stem = "Fire extinguishers must be kept accessible and inspected regularly.";
    const correctAnswer = "Accessible and inspected regularly";
    expect(validateQuestionGrounding(stem, correctAnswer, MATERIAL_TEXT)).toBe(true);
  });

  it("grounded question passes runPostGenerationValidation", () => {
    const q: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "Fire extinguishers must be kept accessible and inspected regularly.",
      textAr: "يجب أن تكون طفايات الحريق في متناول اليد وتُفحص بانتظام.",
      options: ["Accessible and inspected", "Locked away", "Only used by supervisors"],
      optionsAr: ["في متناول اليد ومفحوصة", "مغلقة بعيداً", "يستخدمها المشرفون فقط"],
      correctAnswers: [0],
      difficulty: "EASY",
    };
    const { valid, rejected } = runPostGenerationValidation([q], MATERIAL_TEXT);
    expect(valid).toHaveLength(1);
    expect(rejected).toHaveLength(0);
  });

  it("end-to-end: a grounded question passes the full mock pipeline", async () => {
    mockResponse([validQuestion()]);
    const { questions } = await generateBilingualQuestions({
      count: 1,
      materialText: MATERIAL_TEXT,
      materialTitle: "fire.pdf",
      courseTitle: "Fire Safety",
    });
    expect(questions.length).toBeGreaterThanOrEqual(1);
    expect(questions[0].text).toContain("Fire extinguishers");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 2: Hallucinated question (fails grounding)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Scenario 2: Hallucinated question", () => {
  it("validateQuestionGrounding returns false when words are absent from material", () => {
    const stem = "Quantum entanglement affects the speed of light transmission.";
    const correctAnswer = "Yes, it does affect the speed.";
    expect(validateQuestionGrounding(stem, correctAnswer, MATERIAL_TEXT)).toBe(false);
  });

  it("hallucinated question is rejected by runPostGenerationValidation", () => {
    const q: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "Quantum entanglement affects the speed of light transmission in fiber optic cables.",
      textAr: "تأثير التشابك الكمي على سرعة نقل الضوء في الكابلات الضوئية.",
      options: ["Yes, significantly", "No, not at all", "Only at night"],
      optionsAr: ["نعم بشكل كبير", "لا على الإطلاق", "فقط في الليل"],
      correctAnswers: [0],
      difficulty: "MEDIUM",
    };
    const { valid, rejected } = runPostGenerationValidation([q], MATERIAL_TEXT);
    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain("hallucinated");
  });

  it("end-to-end: hallucinated questions are filtered from the batch", async () => {
    mockResponse([
      validQuestion(),
      validQuestion({
        text: "Quantum entanglement affects the speed of light in fiber optic cables used for training.",
        textAr: "تأثير التشابك الكمي على سرعة الضوء في الكابلات الضوئية المستخدمة للتدريب.",
      }),
    ]);
    const { questions } = await generateBilingualQuestions({
      count: 2,
      materialText: MATERIAL_TEXT,
      materialTitle: "fire.pdf",
      courseTitle: "Fire Safety",
    });
    const texts = questions.map((q) => q.text);
    expect(texts.some((t) => t.includes("Fire extinguishers"))).toBe(true);
    expect(texts.some((t) => t.includes("Quantum"))).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 3: Duplicate question (dedup catches it)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Scenario 3: Duplicate question", () => {
  it("dedupeQuestions removes literal duplicates", () => {
    const items = [
      { text: "Fire extinguishers must be kept accessible." },
      { text: "Fire extinguishers must be kept accessible." },
      { text: "Flammable materials must be stored away from heat." },
    ];
    const deduped = dedupeQuestions(items, []);
    expect(deduped).toHaveLength(2);
  });

  it("dedupeQuestions removes reworded near-duplicates (same fact)", () => {
    const items = [
      { text: "Workers must isolate live conductors before starting work" },
      { text: "Before beginning work, live conductors must be isolated by workers" },
    ];
    const deduped = dedupeQuestions(items, []);
    expect(deduped).toHaveLength(1);
  });

  it("dedupeQuestions removes items matching the exclude list", () => {
    const items = [{ text: "Fire extinguishers must be inspected regularly." }];
    const deduped = dedupeQuestions(items, ["Fire extinguishers must be inspected regularly."]);
    expect(deduped).toHaveLength(0);
  });

  it("dedupeQuestions keeps genuinely different questions", () => {
    const items = [
      { text: "Why must circuits be isolated before work?" },
      { text: "What is the minimum approach distance?" },
      { text: "How often must fire extinguishers be checked?" },
    ];
    const deduped = dedupeQuestions(items, []);
    expect(deduped).toHaveLength(3);
  });

  it("normalizes stems for comparison", () => {
    expect(normalizeStem("What is  Voltage?")).toBe(normalizeStem("what is voltage"));
    expect(normalizeStem("ما هو الجهد؟")).toBe("ما هو الجهد");
  });

  it("similarity scores reworded same-fact stems high", () => {
    const a = "Workers must isolate live conductors before starting work";
    const b = "Before beginning work, live conductors must be isolated by workers";
    expect(similarity(a, b)).toBeGreaterThan(0.5);
  });

  it("similarity scores different facts low", () => {
    const a = "Fire extinguishers must be inspected regularly";
    const b = "Assessment results are stored in the question bank";
    expect(similarity(a, b)).toBeLessThan(0.2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 4: Incorrect answer (structural validation)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Scenario 4: Incorrect answer / structural validation", () => {
  it("validateCorrectAnswerStructural accepts a valid SINGLE_CHOICE", () => {
    const q: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "test",
      textAr: "اختبار",
      options: ["A", "B", "C"],
      optionsAr: ["أ", "ب", "ج"],
      correctAnswers: [0],
      difficulty: "EASY",
    };
    expect(validateCorrectAnswerStructural(q)).toBeNull();
  });

  it("rejects SINGLE_CHOICE with zero correct answers", () => {
    const q: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "test",
      textAr: "اختبار",
      options: ["A", "B"],
      optionsAr: ["أ", "ب"],
      correctAnswers: [],
      difficulty: "EASY",
    };
    expect(validateCorrectAnswerStructural(q)).toContain("exactly one");
  });

  it("rejects SINGLE_CHOICE with multiple correct answers", () => {
    const q: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "test",
      textAr: "اختبار",
      options: ["A", "B", "C"],
      optionsAr: ["أ", "ب", "ج"],
      correctAnswers: [0, 1],
      difficulty: "EASY",
    };
    expect(validateCorrectAnswerStructural(q)).toContain("exactly one");
  });

  it("rejects MULTIPLE_CHOICE with zero correct answers", () => {
    const q: GeneratedQuestion = {
      type: "MULTIPLE_CHOICE",
      text: "test",
      textAr: "اختبار",
      options: ["A", "B", "C"],
      optionsAr: ["أ", "ب", "ج"],
      correctAnswers: [],
      difficulty: "MEDIUM",
    };
    expect(validateCorrectAnswerStructural(q)).toContain("at least one");
  });

  it("rejects MULTIPLE_CHOICE where all options are correct", () => {
    const q: GeneratedQuestion = {
      type: "MULTIPLE_CHOICE",
      text: "test",
      textAr: "اختبار",
      options: ["A", "B"],
      optionsAr: ["أ", "ب"],
      correctAnswers: [0, 1],
      difficulty: "MEDIUM",
    };
    expect(validateCorrectAnswerStructural(q)).toContain("at least one distractor");
  });

  it("rejects out-of-range correct answer index", () => {
    const q: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "test",
      textAr: "اختبار",
      options: ["A", "B"],
      optionsAr: ["أ", "ب"],
      correctAnswers: [5],
      difficulty: "EASY",
    };
    expect(validateCorrectAnswerStructural(q)).toContain("out of range");
  });

  it("validateDistractors catches duplicate options", () => {
    const q: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "test",
      textAr: "اختبار",
      options: ["Fire safety", "Fire safety", "Electrical safety"],
      optionsAr: ["سلامة الحرائق", "سلامة الحرائق", "سلامة كهربائية"],
      correctAnswers: [0],
      difficulty: "EASY",
    };
    expect(validateDistractors(q)).toContain("duplicate");
  });

  it("validateDistractors catches distractor identical to correct answer", () => {
    const q: GeneratedQuestion = {
      type: "MULTIPLE_CHOICE",
      text: "Which are valid fire safety measures?",
      textAr: "ما إجراءات سلامة الحرائق الصالحة؟",
      options: ["Extinguishers", "Labels", "Extinguishers|Labels", "Hydrants"],
      optionsAr: ["طفايات", "ملصقات", "طفايات|ملصقات", "صنابير"],
      correctAnswers: [0, 1],
      difficulty: "EASY",
    };
    expect(validateDistractors(q)).toContain("identical to the correct answer");
  });

  it("validateDistractors accepts valid distractors", () => {
    const q: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "test",
      textAr: "اختبار",
      options: ["Fire safety", "Electrical safety", "Working at height"],
      optionsAr: ["سلامة الحرائق", "سلامة كهربائية", "العمل على الارتفاع"],
      correctAnswers: [0],
      difficulty: "EASY",
    };
    expect(validateDistractors(q)).toBeNull();
  });

  it("end-to-end: a question with incorrect answer is rejected", () => {
    const bad: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "Fire safety rules must be followed.",
      textAr: "يجب اتباع قواعد سلامة الحرائق.",
      options: ["Yes", "No"],
      optionsAr: ["نعم", "لا"],
      correctAnswers: [0, 1],
      difficulty: "EASY",
    };
    const { valid, rejected } = runPostGenerationValidation([bad], MATERIAL_TEXT);
    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toContain("Incorrect answer");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 5: Bilingual mismatch (consistency repair)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Scenario 5: Bilingual mismatch", () => {
  it("rejects English-only question (missing textAr)", () => {
    expect(() =>
      validateGeneratedQuestion(
        {
          type: "SINGLE_CHOICE",
          text: "What is fire safety?",
          textAr: undefined,
          options: ["A", "B"],
          optionsAr: ["أ", "ب"],
          correctAnswers: [0],
          difficulty: "EASY",
        },
        0,
      ),
    ).toThrow(/textAr.*bilingual/i);
  });

  it("rejects Arabic text that is mostly English", () => {
    expect(() =>
      validateGeneratedQuestion(
        {
          type: "SINGLE_CHOICE",
          text: "What is fire safety?",
          textAr: "سلامة الحرائق are very important for the workplace وبيئة العمل",
          options: ["A", "B"],
          optionsAr: ["أ", "ب"],
          correctAnswers: [0],
          difficulty: "EASY",
        },
        0,
      ),
    ).toThrow(/mostly English/i);
  });

  it("rejects Arabic options without Arabic mirrors", () => {
    expect(() =>
      validateGeneratedQuestion(
        {
          type: "SINGLE_CHOICE",
          text: "What is fire safety?",
          textAr: "ما هي سلامة الحرائق؟",
          options: ["A", "B"],
          optionsAr: undefined,
          correctAnswers: [0],
          difficulty: "EASY",
        },
        0,
      ),
    ).toThrow(/optionsAr/i);
  });

  it("rejects optionsAr length mismatch", () => {
    expect(() =>
      validateGeneratedQuestion(
        {
          type: "SINGLE_CHOICE",
          text: "What is fire safety?",
          textAr: "ما هي سلامة الحرائق؟",
          options: ["A", "B", "C"],
          optionsAr: ["أ", "ب"],
          correctAnswers: [0],
          difficulty: "EASY",
        },
        0,
      ),
    ).toThrow(/mirror/i);
  });

  it("repairBilingualConsistency rewrites drifted Arabic", async () => {
    const { repairBilingualConsistency } = await import("@/lib/ai/question-generator");
    const fakeProvider = {
      name: "fake",
      capabilities: { streaming: false, toolCalling: false, structuredOutput: false, imageUnderstanding: false, fileAnalysis: false, conversationMemory: false, tokenCounting: false },
      async chat() {
        return {
          content: JSON.stringify({
            questions: [
              { index: 0, consistent: true },
              {
                index: 1,
                consistent: false,
                textAr: "ما لون طفاية الحريق المناسبة لحرائق الفئة أ؟",
                optionsAr: ["أحمر", "أزرق", "أخضر", "أصفر"],
              },
            ],
          }),
        };
      },
    };
    const q0 = validateGeneratedQuestion(
      { type: "SINGLE_CHOICE", text: "What voltage?", textAr: "ما الجهد؟", options: ["110V", "220V"], optionsAr: ["110 فولت", "220 فولت"], correctAnswers: [0], difficulty: "MEDIUM" },
      0,
    );
    const q1 = validateGeneratedQuestion(
      { type: "SINGLE_CHOICE", text: "What color is the extinguisher?", textAr: "كم عدد طفايات الحريق؟", options: ["Red", "Blue"], optionsAr: ["أحمر", "أزرق"], correctAnswers: [0], difficulty: "MEDIUM" },
      1,
    );
    const result = await repairBilingualConsistency(fakeProvider as never, [q0, q1]);
    // q0 stays the same (consistent), q1 textAr is rewritten
    expect(result[0].textAr).toBe("ما الجهد؟");
    expect(result[1].textAr).toContain("لون طفاية");
    expect(result[1].textAr).not.toContain("عدد");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 6: Irrelevant image (validateImageRelevance rejects)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Scenario 6: Irrelevant image", () => {
  const irrelevantImage: ExtractedMaterialImage = {
    url: "/api/uploads/question-images/m/1.png",
    page: 2,
    width: 200,
    height: 120,
    pageText: "The emergency evacuation plan must be posted in all work areas.",
  };

  it("validateImageRelevance returns false when page text does not match stem", () => {
    const stem = "Fire extinguishers must be kept accessible and inspected regularly.";
    expect(validateImageRelevance(stem, irrelevantImage)).toBe(false);
  });

  it("irrelevant image is not attached in the generation pipeline", async () => {
    mockResponse([
      validQuestion({
        text: "Flammable materials must be stored away from sources of heat.",
        textAr: "يجب تخزين المواد القابلة للاشتعال بعيداً عن مصادر الحرارة.",
      }),
    ]);
    const { questions } = await generateBilingualQuestions({
      count: 1,
      materialText: MATERIAL_TEXT,
      materialTitle: "fire.pdf",
      courseTitle: "Fire Safety",
      figures: [{ index: 1, page: 2, pageText: "The emergency evacuation plan must be posted in all work areas." }],
    });
    expect(questions).toHaveLength(1);
    // The figure's page text is about evacuation, not flammable materials — no image should be attached
    expect(questions[0].imageUrl).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 7: Relevant image (validateImageRelevance accepts)
// ═══════════════════════════════════════════════════════════════════════════════

describe("Scenario 7: Relevant image", () => {
  const relevantImage: ExtractedMaterialImage = {
    url: "/api/uploads/question-images/m/1.png",
    page: 1,
    width: 200,
    height: 120,
    pageText: "Fire extinguishers must be kept accessible and inspected regularly. Flammable materials must be stored away from heat.",
  };

  it("validateImageRelevance returns true when page text strongly covers stem", () => {
    const stem = "Fire extinguishers must be kept accessible and inspected regularly.";
    expect(validateImageRelevance(stem, relevantImage)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 8: Question with no suitable image
// ═══════════════════════════════════════════════════════════════════════════════

describe("Scenario 8: Question with no suitable image", () => {
  it("without_images mode strips all imageRef/imageUrl", async () => {
    mockResponse([validQuestion({ imageRef: 1, imageUrl: "/api/uploads/question-images/x.png" })]);
    const { questions } = await generateBilingualQuestions({
      count: 1,
      imageMode: "without_images",
      materialText: MATERIAL_TEXT,
      materialTitle: "fire.pdf",
      courseTitle: "Fire Safety",
      figures: [{ index: 1, page: 1, pageText: "Fire extinguishers must be kept accessible." }],
    });
    expect(questions).toHaveLength(1);
    expect(questions[0].imageRef).toBeUndefined();
    expect(questions[0].imageUrl).toBeUndefined();
  });

  it("auto mode with no figures produces image-less questions", async () => {
    mockResponse([
      validQuestion({ text: "Fire drills must be practiced by all workers.", textAr: "يجب على جميع العمال ممارسة تدريبات الإخلاء." }),
    ]);
    const { questions } = await generateBilingualQuestions({
      count: 1,
      imageMode: "auto",
      materialText: MATERIAL_TEXT,
      materialTitle: "fire.pdf",
      courseTitle: "Fire Safety",
      figures: [],
    });
    expect(questions).toHaveLength(1);
    expect(questions[0].imageUrl).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 9: Difficulty classification
// ═══════════════════════════════════════════════════════════════════════════════

describe("Scenario 9: Difficulty classification", () => {
  it("validateGeneratedQuestion accepts EASY, MEDIUM, HARD", () => {
    for (const d of ["EASY", "MEDIUM", "HARD"] as const) {
      const q = validateGeneratedQuestion({ ...validQuestion(), difficulty: d }, 0);
      expect(q.difficulty).toBe(d);
    }
  });

  it("validateGeneratedQuestion rejects unknown difficulty", () => {
    expect(() => validateGeneratedQuestion({ ...validQuestion(), difficulty: "EXPERT" }, 0)).toThrow(/unsupported difficulty/i);
  });

  it("validateDifficultyDifferentiation passes when HARD is more complex", () => {
    const easy: GeneratedQuestion = {
      type: "SINGLE_CHOICE", text: "Fire safety is important.", textAr: "سلامة الحرائق مهمة.", options: ["A", "B"], optionsAr: ["أ", "ب"], correctAnswers: [0], difficulty: "EASY",
    };
    const hard: GeneratedQuestion = {
      type: "SINGLE_CHOICE", text: "Why must fire extinguishers be accessible, and what happens when they are not inspected regularly during routine safety checks?",
      textAr: "لماذا يجب أن تكون طفايات الحريق في متناول اليد، وماذا يحدث عندما لا تُفحص بانتظام أثناء فحوصات السلامة الروتينية؟",
      options: ["A", "B", "C"], optionsAr: ["أ", "ب", "ج"], correctAnswers: [0], difficulty: "HARD",
    };
    expect(validateDifficultyDifferentiation([easy, hard])).toBeNull();
  });

  it("validateDifficultyDifferentiation warns when HARD is simpler than EASY", () => {
    const easy: GeneratedQuestion = {
      type: "SINGLE_CHOICE", text: "Before starting work on a live electrical system, the worker must ensure that all energy has been isolated and the circuit has been proved dead using approved testing equipment.",
      textAr: "قبل بدء العمل على نظام كهربائي مكهرب، يجب على العامل التأكد من عزل جميع الطاقات وإثبات موت الدائرة باستخدام أجهزة اختبار معتمدة.",
      options: ["A", "B", "C"], optionsAr: ["أ", "ب", "ج"], correctAnswers: [0], difficulty: "EASY",
    };
    const hard: GeneratedQuestion = {
      type: "TRUE_FALSE", text: "Safety first.", textAr: "السلامة أولاً.", options: ["True", "False"], optionsAr: ["صحيح", "خطأ"], correctAnswers: [0], difficulty: "HARD",
    };
    const warning = validateDifficultyDifferentiation([easy, hard]);
    expect(warning).toContain("HARD");
  });

  it("end-to-end: mock provider assigns appropriate difficulty labels", async () => {
    mockResponse([
      validQuestion({ difficulty: "EASY" }),
      validQuestion({ text: "Flammable materials must be stored away from sources of heat.", textAr: "يجب تخزين المواد القابلة للاشتعال بعيداً عن مصادر الحرارة.", difficulty: "MEDIUM" }),
      validQuestion({ text: "Smoke and heat detectors must be tested routinely because they warn of fire before it spreads.", textAr: "يجب اختبار كاشفات الدخان والحرارة بانتظام لأنها تنذر بالحريق قبل انتشاره.", difficulty: "HARD" }),
    ]);
    const { questions } = await generateBilingualQuestions({
      count: 3,
      materialText: MATERIAL_TEXT,
      materialTitle: "fire.pdf",
      courseTitle: "Fire Safety",
    });
    const difficulties = questions.map((q) => q.difficulty);
    expect(difficulties).toContain("EASY");
    expect(difficulties).toContain("MEDIUM");
    expect(difficulties).toContain("HARD");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 10: PRE_TEST / FINAL_TEST isolation
// ═══════════════════════════════════════════════════════════════════════════════

describe("Scenario 10: PRE_TEST / FINAL_TEST isolation", () => {
  it("toQuestionCreateData preserves the testType field", () => {
    const q: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "Fire safety question",
      textAr: "سؤال سلامة حرائق",
      options: ["A", "B"],
      optionsAr: ["أ", "ب"],
      correctAnswers: [0],
      difficulty: "EASY",
    };
    const preData = toQuestionCreateData(q, { courseId: "c1", materialId: "m1", testType: "PRE_TEST", createdBy: "u1" });
    const finalData = toQuestionCreateData(q, { courseId: "c1", materialId: "m1", testType: "FINAL_TEST", createdBy: "u1" });
    expect(preData.testType).toBe("PRE_TEST");
    expect(finalData.testType).toBe("FINAL_TEST");
  });

  it("each testType persists independently — no cross-contamination", () => {
    const q: GeneratedQuestion = {
      type: "TRUE_FALSE",
      text: "Test isolation",
      textAr: "اختبار العزل",
      options: ["True", "False"],
      optionsAr: ["صحيح", "خطأ"],
      correctAnswers: [0],
      difficulty: "EASY",
    };
    const pre = toQuestionCreateData(q, { courseId: "c1", materialId: "m1", testType: "PRE_TEST", createdBy: "u1" });
    const final = toQuestionCreateData(q, { courseId: "c1", materialId: "m1", testType: "FINAL_TEST", createdBy: "u1" });
    expect(pre.testType).not.toBe(final.testType);
    expect(pre.testType).toBe("PRE_TEST");
    expect(final.testType).toBe("FINAL_TEST");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO 11: End-to-end mock pipeline with all guards
// ═══════════════════════════════════════════════════════════════════════════════

describe("Scenario 11: End-to-end pipeline — all guards active", () => {
  it("full pipeline: material text → AI generation → structural validation → bilingual consistency → dedup → output", async () => {
    // Generate a batch of 3 diverse questions
    mockResponse([
      validQuestion({
        text: "Fire extinguishers must be kept accessible and inspected regularly.",
        textAr: "يجب أن تكون طفايات الحريق في متناول اليد وتُفحص بانتظام.",
        difficulty: "EASY",
      }),
      validQuestion({
        text: "Flammable materials must be stored away from sources of heat.",
        textAr: "يجب تخزين المواد القابلة للاشتعال بعيداً عن مصادر الحرارة.",
        difficulty: "MEDIUM",
      }),
      validQuestion({
        text: "Smoke and heat detectors must be tested routinely because they warn of fire.",
        textAr: "يجب اختبار كاشفات الدخان والحرارة بانتظام لأنها تنذر بالحريق.",
        difficulty: "HARD",
      }),
    ]);

    const { questions, model } = await generateBilingualQuestions({
      count: 3,
      materialText: MATERIAL_TEXT,
      materialTitle: "fire-safety.pdf",
      courseTitle: "Fire Safety",
    });

    // All questions returned
    expect(questions.length).toBeGreaterThanOrEqual(1);
    expect(model).toBe("test-model");

    for (const q of questions) {
      // Bilingual
      expect(q.text.trim().length).toBeGreaterThan(0);
      expect(q.textAr.trim().length).toBeGreaterThan(0);
      if (q.options.length > 0) {
        expect(q.optionsAr).toHaveLength(q.options.length);
        for (const o of q.optionsAr) expect(o.trim().length).toBeGreaterThan(0);
      }

      // Valid difficulty
      expect(["EASY", "MEDIUM", "HARD"]).toContain(q.difficulty);

      // Structural correctness
      const answerIssue = validateCorrectAnswerStructural(q);
      expect(answerIssue).toBeNull();

      // Distractor quality
      const distractorIssue = validateDistractors(q);
      expect(distractorIssue).toBeNull();

      // Grounding in material
      const correctText = q.correctAnswers.length > 0 ? (q.options[q.correctAnswers[0]] ?? "") : "";
      expect(validateQuestionGrounding(q.text, correctText, MATERIAL_TEXT)).toBe(true);
    }

    // No internal duplicates
    expect(dedupeQuestions(questions, []).length).toBe(questions.length);
  });

  it("rejects a batch containing mixed valid/invalid questions", () => {
    const valid: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "Fire extinguishers must be kept accessible and inspected regularly.",
      textAr: "يجب أن تكون طفايات الحريق في متناول اليد وتُفحص بانتظام.",
      options: ["Accessible", "Locked"],
      optionsAr: ["في متناول اليد", "مغلقة"],
      correctAnswers: [0],
      difficulty: "EASY",
    };
    const hallucinated: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "Quantum entanglement allows faster-than-light communication in safety networks.",
      textAr: "التشابك الكمي يسمح بالتواصل أسرع من الضوء في شبكات السلامة.",
      options: ["Yes", "No"],
      optionsAr: ["نعم", "لا"],
      correctAnswers: [0],
      difficulty: "MEDIUM",
    };
    const badAnswer: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "Fire safety rules exist.",
      textAr: "قواعد السلامة من الحرائق موجودة.",
      options: ["Yes", "No"],
      optionsAr: ["نعم", "لا"],
      correctAnswers: [0, 1],
      difficulty: "EASY",
    };

    const { valid: v, rejected } = runPostGenerationValidation([valid, hallucinated, badAnswer], MATERIAL_TEXT);
    expect(v).toHaveLength(1);
    expect(v[0].text).toContain("Fire extinguishers");
    expect(rejected).toHaveLength(2);
    expect(rejected.some((r) => r.reason.includes("hallucinated"))).toBe(true);
    expect(rejected.some((r) => r.reason.includes("Incorrect answer"))).toBe(true);
  });

  it("image mode without_images produces zero images even when figures exist", async () => {
    mockResponse([
      validQuestion({ imageRef: 1, imageUrl: "/api/uploads/question-images/x.png" }),
      validQuestion({ text: "Flammable materials must be stored away from heat.", textAr: "يجب تخزين المواد القابلة للاشتعال بعيداً عن مصادر الحرارة.", imageRef: 1 }),
    ]);
    const { questions } = await generateBilingualQuestions({
      count: 2,
      imageMode: "without_images",
      materialText: MATERIAL_TEXT,
      materialTitle: "fire.pdf",
      courseTitle: "Fire Safety",
      figures: [{ index: 1, page: 1, pageText: "Fire extinguishers must be kept accessible." }],
    });
    for (const q of questions) {
      expect(q.imageRef).toBeUndefined();
      expect(q.imageUrl).toBeUndefined();
    }
  });
});
