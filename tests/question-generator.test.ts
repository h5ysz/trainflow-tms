// Unit tests for the bilingual AI Question Generator: strict bilingual
// validation (the product rule: every question ALWAYS Arabic + English), robust
// JSON parsing of provider output, and the draftâ†’persist mapping.
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";

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
  QuestionValidationError,
  QuestionGenerationError,
  extractQuestionArray,
  toQuestionCreateData,
  type GeneratedQuestion,
} from "@/lib/ai/question-generator";

beforeAll(() => {
  process.env.AI_MOCK_ENABLED = "true";
});

beforeEach(() => {
  // Call history accumulates across tests; clear it so `mock.calls[0]` refers
  // to the current test's first chat call (the generation prompt).
  mockProvider.chat.mockClear();
});

afterAll(() => {
  delete process.env.AI_MOCK_ENABLED;
});

const MATERIAL_TEXT =
  "The TrainFlow system manages courses and training sessions. Every session is linked to a trainer and a room. Assessment results are stored in the question bank.";

function mockResponse(content: unknown): void {
  mockProvider.chat.mockResolvedValueOnce({
    content: typeof content === "string" ? content : JSON.stringify(content),
    finishReason: "stop",
    model: "test-model",
  });
}

// The generation pipeline now follows each successful batch with a best-effort
// EN↔AR consistency pass (one extra chat call). Tests must stub those verdicts
// or the second call errors and is silently swallowed.
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
    text: "Which system manages training sessions?",
    textAr: "ط£ظٹ ظ†ط¸ط§ظ… ظٹط¯ظٹط± ط§ظ„ط¬ظ„ط³ط§طھ ط§ظ„طھط¯ط±ظٹط¨ظٹط©طں",
    options: ["TrainFlow", "Untitled", "Unknown"],
    optionsAr: ["طھط±ظٹظ† ظپظ„ط§ظˆ", "ط؛ظٹط± ظ…ط³ظ…ظ‰", "ط؛ظٹط± ظ…ط¹ط±ظˆظپ"],
    correctAnswers: [0],
    explanation: "TrainFlow manages courses and sessions.",
    explanationAr: "طھط±ظٹظ† ظپظ„ط§ظˆ ظٹط¯ظٹط± ط§ظ„ط¯ظˆط±ط§طھ ظˆط§ظ„ط¬ظ„ط³ط§طھ.",
    difficulty: "MEDIUM",
    category: "system",
    tags: ["core"],
    ...overrides,
  };
}

describe("generateBilingualQuestions (via provider)", () => {
  it("returns validated bilingual questions from the provider", async () => {
    mockResponse([validQuestion(), validQuestion({ text: "Are assessment results stored in the question bank?", type: "TRUE_FALSE", textAr: "هل تُخزَّن نتائج التقييم في بنك الأسئلة؟", options: ["True", "False"], optionsAr: ["طµط­ظٹط­", "ط®ط·ط£"] })]);
    const { questions, model } = await generateBilingualQuestions({
      count: 2,
      materialText: MATERIAL_TEXT,
      materialTitle: "intro.pdf",
      courseTitle: "TMS Basics",
    });
    expect(model).toBe("test-model");
    expect(questions).toHaveLength(2);
    const q = questions[0];
    expect(q.text).toBeTruthy();
    expect(q.textAr).toBeTruthy();
    expect(q.options).toEqual(["TrainFlow", "Untitled", "Unknown"]);
    expect(q.optionsAr).toEqual(["طھط±ظٹظ† ظپظ„ط§ظˆ", "ط؛ظٹط± ظ…ط³ظ…ظ‰", "ط؛ظٹط± ظ…ط¹ط±ظˆظپ"]);
    expect(q.correctAnswers).toEqual([0]);
    expect(q.difficulty).toBe("MEDIUM");
  });

  it("generates EXACTLY the requested number per type (counts)", async () => {
    mockResponse([
      validQuestion({ text: "Which system manages training sessions?", textAr: "أي نظام يدير الجلسات التدريبية؟" }),
      validQuestion({ text: "Where are assessment results stored?", textAr: "أين تُخزَّن نتائج التقييم؟" }),
    ]);
    mockConsistent(2);
    mockResponse([
      validQuestion({
        type: "TRUE_FALSE",
        text: "Are mock providers allowed to simulate API failures?",
        textAr: "هل يُسمح للموفرات الوهمية بمحاكاة فشل الواجهات؟",
        options: ["True", "False"],
        optionsAr: ["صحيح", "خطأ"],
        correctAnswers: [0],
      }),
    ]);
    mockConsistent(1);
    const { questions, model } = await generateBilingualQuestions({
      count: 3,
      counts: { SINGLE_CHOICE: 2, TRUE_FALSE: 1 },
      materialText: MATERIAL_TEXT,
      materialTitle: "intro.pdf",
      courseTitle: "TMS Basics",
    });
    expect(model).toBe("test-model");
    expect(questions).toHaveLength(3);
    expect(questions.filter((q) => q.type === "SINGLE_CHOICE")).toHaveLength(2);
    expect(questions.filter((q) => q.type === "TRUE_FALSE")).toHaveLength(1);
    expect(questions.filter((q) => q.type === "MULTIPLE_CHOICE")).toHaveLength(0);
    expect(questions.filter((q) => q.type === "SHORT_ANSWER")).toHaveLength(0);
    // Output stays ordered by QUESTION_TYPES (SINGLE_CHOICE first, TRUE_FALSE last).
    expect(questions[0].type).toBe("SINGLE_CHOICE");
    expect(questions[2].type).toBe("TRUE_FALSE");
  });

  it("strips images when imageMode is without_images", async () => {
    mockResponse([validQuestion({ imageRef: 1, imageUrl: "/api/uploads/question-images/x.png" })]);
    const { questions } = await generateBilingualQuestions({
      count: 1,
      imageMode: "without_images",
      materialText: MATERIAL_TEXT,
      materialTitle: "a.pdf",
      courseTitle: "C",
    });
    expect(questions).toHaveLength(1);
    expect(questions[0].imageRef).toBeUndefined();
    expect(questions[0].imageUrl).toBeUndefined();
  });

  it("keeps imageRef/imageUrl when imageMode is auto or with_images", async () => {
    mockResponse([validQuestion({ imageRef: 1, imageUrl: "/api/uploads/question-images/x.png" })]);
    const { questions } = await generateBilingualQuestions({
      count: 1,
      imageMode: "with_images",
      materialText: MATERIAL_TEXT,
      materialTitle: "a.pdf",
      courseTitle: "C",
    });
    expect(questions[0].imageRef).toBe(1);
    expect(questions[0].imageUrl).toBe("/api/uploads/question-images/x.png");
  });

  it("hides figures and adds the image policy to the prompt in without_images mode", async () => {
    mockResponse([validQuestion({ text: "Which system manages training sessions?", textAr: "أي نظام يدير الجلسات التدريبية؟" })]);
    await generateBilingualQuestions({
      count: 1,
      imageMode: "without_images",
      materialText: MATERIAL_TEXT,
      materialTitle: "a.pdf",
      courseTitle: "C",
      figures: [{ index: 1, page: 1, pageText: "figure page text" }],
    });
    // The first chat call is the generation prompt (the consistency pass is a
    // separate second call), so inspect calls[0] — not the last call.
    const userMsg = (mockProvider.chat.mock.calls[0]![0].messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === "user",
    )?.content as string;
    expect(userMsg).toContain("IMAGE POLICY: DO NOT attach any image");
    expect(userMsg).not.toContain("FIGURES_BEGIN");
  });

  it("lists figures and prefers images in with_images mode", async () => {
    mockResponse([validQuestion({ text: "Which system manages training sessions?", textAr: "أي نظام يدير الجلسات التدريبية؟", imageRef: 1 })]);
    await generateBilingualQuestions({
      count: 1,
      imageMode: "with_images",
      materialText: MATERIAL_TEXT,
      materialTitle: "a.pdf",
      courseTitle: "C",
      figures: [{ index: 1, page: 1, pageText: "figure page text" }],
    });
    const userMsg = (mockProvider.chat.mock.calls[0]![0].messages as Array<{ role: string; content: string }>).find(
      (m) => m.role === "user",
    )?.content as string;
    expect(userMsg).toContain("FIGURES_BEGIN");
    expect(userMsg).toContain("IMAGE POLICY: Prefer images");
  });

  it("parses JSON wrapped in markdown fences and prose", async () => {
    mockResponse("Here are the questions:\n```json\n" + JSON.stringify([validQuestion()]) + "\n```\nHope this helps!");
    const { questions } = await generateBilingualQuestions({ count: 1, materialText: MATERIAL_TEXT, materialTitle: "a.pdf", courseTitle: "C" });
    expect(questions).toHaveLength(1);
  });

  it("parses a wrapped { questions: [...] } envelope", async () => {
    mockResponse(JSON.stringify({ questions: [validQuestion()], meta: { ok: true } }));
    const { questions } = await generateBilingualQuestions({ count: 1, materialText: MATERIAL_TEXT, materialTitle: "a.pdf", courseTitle: "C" });
    expect(questions).toHaveLength(1);
  });

  it("throws QuestionGenerationError when the response has no JSON", async () => {
    mockResponse("I'm sorry, I can't generate questions from this content.");
    await expect(
      generateBilingualQuestions({ count: 1, materialText: MATERIAL_TEXT, materialTitle: "a.pdf", courseTitle: "C" }),
    ).rejects.toThrow(QuestionGenerationError);
  });

  it("throws QuestionGenerationError when the response is empty", async () => {
    mockResponse("");
    await expect(
      generateBilingualQuestions({ count: 1, materialText: MATERIAL_TEXT, materialTitle: "a.pdf", courseTitle: "C" }),
    ).rejects.toThrow(/empty/i);
  });

  it("throws QuestionGenerationError when the provider call fails", async () => {
    mockProvider.chat.mockRejectedValueOnce(new Error("rate limited"));
    await expect(
      generateBilingualQuestions({ count: 1, materialText: MATERIAL_TEXT, materialTitle: "a.pdf", courseTitle: "C" }),
    ).rejects.toThrow(/rate limited/i);
  });
});

describe("strict bilingual validation (product rule)", () => {
  it("accepts a fully bilingual question", () => {
    const q = validateGeneratedQuestion(validQuestion(), 0);
    expect(q.textAr).toBeTruthy();
    expect(q.optionsAr).toHaveLength(q.options.length);
  });

  it("rejects an English-only question (missing textAr)", () => {
    expect(() => validateGeneratedQuestion(validQuestion({ textAr: undefined }), 0)).toThrow(/textAr.*bilingual/i);
    expect(() => validateGeneratedQuestion(validQuestion({ textAr: "" }), 0)).toThrow(/textAr.*bilingual/i);
  });

  it("rejects an Arabic-only question (missing text)", () => {
    expect(() => validateGeneratedQuestion(validQuestion({ text: undefined }), 0)).toThrow(/text.*English/i);
  });

  it("rejects English options without Arabic mirrors", () => {
    expect(() => validateGeneratedQuestion(validQuestion({ optionsAr: undefined }), 0)).toThrow(/optionsAr/i);
  });

  it("rejects options length mismatch between languages", () => {
    expect(() => validateGeneratedQuestion(validQuestion({ optionsAr: ["only-one"] }), 0)).toThrow(/mirror/i);
  });

  it("rejects an empty Arabic option", () => {
    expect(() => validateGeneratedQuestion(validQuestion({ optionsAr: ["", "ط¨", "ط¬"] }), 0)).toThrow(/option 1.*Arabic/i);
  });

  it("rejects out-of-range correct answer indices", () => {
    expect(() => validateGeneratedQuestion(validQuestion({ correctAnswers: [9] }), 0)).toThrow(/out of range/i);
  });

  it("rejects explanation without explanationAr", () => {
    expect(() => validateGeneratedQuestion(validQuestion({ explanationAr: undefined }), 0)).toThrow(/explanationAr/i);
  });

  it("rejects TRUE_FALSE with non boolean options", () => {
    expect(() =>
      validateGeneratedQuestion(validQuestion({ type: "TRUE_FALSE", options: ["Yes", "No"], optionsAr: ["ظ†ط¹ظ…", "ظ„ط§"] }), 0),
    ).toThrow(/True.*False/i);
  });

  it("accepts a bilingual TRUE_FALSE question", () => {
    const q = validateGeneratedQuestion(validQuestion({ text: "Are assessment results stored in the question bank?", type: "TRUE_FALSE", options: ["True", "False"], optionsAr: ["طµط­ظٹط­", "ط®ط·ط£"] }), 0);
    expect(q.type).toBe("TRUE_FALSE");
  });

  it("accepts SHORT_ANSWER with empty options", () => {
    const q = validateGeneratedQuestion(
      validQuestion({ type: "SHORT_ANSWER", options: [], optionsAr: [], correctAnswers: [] }),
      0,
    );
    expect(q.options).toEqual([]);
    expect(q.correctAnswers).toEqual([]);
  });

  it("rejects SHORT_ANSWER that smuggles options", () => {
    expect(() =>
      validateGeneratedQuestion(validQuestion({ type: "SHORT_ANSWER", options: ["a", "b"], optionsAr: ["ط£", "ط¨"], correctAnswers: [] }), 0),
    ).toThrow(/SHORT_ANSWER/);
  });

  it("rejects unknown types and difficulties", () => {
    expect(() => validateGeneratedQuestion(validQuestion({ type: "ESSAY" }), 0)).toThrow(/unsupported type/i);
    expect(() => validateGeneratedQuestion(validQuestion({ difficulty: "EXPERT" }), 0)).toThrow(/unsupported difficulty/i);
  });
});

describe("extractQuestionArray robustness", () => {
  it("extracts from a fenced block with leading prose", () => {
    const arr = extractQuestionArray(`Sure!\n\`\`\`json\n[{"type":"TRUE_FALSE"}]\n\`\`\`\nDone.`);
    expect(arr).toHaveLength(1);
  });

  it("extracts from a bare array with trailing text", () => {
    const arr = extractQuestionArray(`[{"type":"TRUE_FALSE"}] and more text`);
    expect(arr).toHaveLength(1);
  });

  it("throws QuestionGenerationError when nothing JSON-like exists", () => {
    expect(() => extractQuestionArray("no json here at all")).toThrow(QuestionGenerationError);
  });
});

describe("toQuestionCreateData mapping", () => {
  it("maps a validated question to persist data (source=AI_GENERATED, material linked)", () => {
    const q: GeneratedQuestion = {
      type: "SINGLE_CHOICE",
      text: "What is the system?",
      textAr: "ظ…ط§ ظ‡ظˆ ط§ظ„ظ†ط¸ط§ظ…طں",
      options: ["A", "B"],
      optionsAr: ["ط£", "ط¨"],
      correctAnswers: [1],
      explanation: "Because.",
      explanationAr: "ظ„ط£ظ†.",
      difficulty: "EASY",
      category: "tms",
      tags: ["x"],
    };
    const data = toQuestionCreateData(q, {
      courseId: "c-1",
      materialId: "m-1",
      testType: "FINAL_TEST",
      aiModel: "model-x",
      aiPrompt: "{}",
      createdBy: "u-1",
    });
    expect(data).toMatchObject({
      courseId: "c-1",
      materialId: "m-1",
      testType: "FINAL_TEST",
      text: "What is the system?",
      textAr: "ظ…ط§ ظ‡ظˆ ط§ظ„ظ†ط¸ط§ظ…طں",
      options: JSON.stringify(["A", "B"]),
      optionsAr: JSON.stringify(["ط£", "ط¨"]),
      correctAnswers: JSON.stringify([1]),
      source: "AI_GENERATED",
      aiModel: "model-x",
      aiPrompt: "{}",
      createdBy: "u-1",
      updatedBy: "u-1",
      category: "tms",
      tags: JSON.stringify(["x"]),
      difficulty: "EASY",
    });
    expect(data.aiGeneratedAt).toBeInstanceOf(Date);
  });
});
