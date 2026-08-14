// Integration tests for the do-not-repeat + figure/imageRef behaviour:
//   - The Mock AI provider excludes sentences already in the DO_NOT_REPEAT block.
//   - The Mock AI provider attaches imageRef to the figure whose page text best
//     covers the sentence the question is built from (never at random).
//   - validateGeneratedQuestion accepts valid imageRef and rejects invalid ones.
import { describe, it, expect } from "vitest";
import { MockProvider } from "@/lib/ai/provider/mock";
import { validateGeneratedQuestion } from "@/lib/ai/question-generator";

const SOURCE_SENTENCES = [
  "Workers must wear personal protective equipment when working on live electrical systems.",
  "Fire extinguishers must be kept accessible and inspected on a regular basis.",
  "Live conductors must be isolated and proved dead before any work begins.",
  "The minimum safe approach distance from overhead lines must always be maintained.",
  "Employees must follow the safety rules and safe work procedures at all times.",
];

function buildPrompt(opts: { count: number; excludes?: string[]; figures?: string[] }): string {
  const parts = [
    "Course: Electrical Safety",
    "Material: safety.pdf",
    "REQUESTED_COUNT: " + opts.count,
    "ALLOWED_TYPES: SINGLE_CHOICE,MULTIPLE_CHOICE",
    "DIFFICULTY: ANY",
    "SOURCE_TEXT_BEGIN",
    SOURCE_SENTENCES.join(" "),
    "SOURCE_TEXT_END",
  ];
  if (opts.excludes && opts.excludes.length > 0) {
    parts.push("", "DO_NOT_REPEAT_TEXT_BEGIN");
    for (const e of opts.excludes) parts.push('- "' + e + '"');
    parts.push("DO_NOT_REPEAT_TEXT_END");
  }
  if (opts.figures && opts.figures.length > 0) {
    parts.push("", "FIGURES_BEGIN");
    for (const f of opts.figures) parts.push(f);
    parts.push("FIGURES_END");
  }
  return parts.join("\n");
}

const mock = new MockProvider();

describe("Mock AI provider — do-not-repeat", () => {
  it("never reuses a sentence listed in the DO_NOT_REPEAT block", async () => {
    const excluded = SOURCE_SENTENCES[2];
    const res = await mock.chat({
      messages: [{ role: "user", content: buildPrompt({ count: 3, excludes: [excluded] }) }],
    });
    const questions = (JSON.parse(res.content) as { questions: Array<{ text: string }> }).questions;
    expect(questions).toHaveLength(3);
    for (const q of questions) {
      expect(q.text).not.toBe(excluded);
      expect(q.text).not.toContain(excluded.slice(0, 40));
    }
  });
});

describe("Mock AI provider — figure attachment", () => {
  it("sets imageRef to the figure whose page text covers the question stem", async () => {
    const figures = [
      "[1] page 2: " + SOURCE_SENTENCES[1] + " Fire safety guidance is part of every induction.",
      "[2] page 4: " + SOURCE_SENTENCES[3] + " Approach distances protect workers near overhead lines.",
      "[3] page 5: " + SOURCE_SENTENCES[4] + " Rules apply to all staff on site.",
    ];
    const res = await mock.chat({
      messages: [{ role: "user", content: buildPrompt({ count: 5, figures }) }],
    });
    const questions = (JSON.parse(res.content) as { questions: Array<{ text: string; imageRef?: number }> }).questions;
    expect(questions.length).toBeGreaterThan(0);

    const withFigure = questions.filter((q) => q.imageRef !== undefined);
    expect(withFigure.length).toBeGreaterThan(0);

    // Every imageRef must resolve to a figure whose page text actually contains
    // content words of the question stem (relevance, not randomness).
    const pageTextByIndex = new Map<number, string>();
    for (const f of figures) {
      const m = /^\[(\d+)\]\s*page\s*\d+:\s*(.*)$/.exec(f);
      if (m) pageTextByIndex.set(Number(m[1]), m[2]);
    }
    const tokenize = (s: string): Set<string> =>
      new Set(s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 4));
    for (const q of withFigure) {
      const page = pageTextByIndex.get(q.imageRef as number);
      expect(page).toBeDefined();
      const stemTokens = tokenize(q.text);
      const pageTokens = tokenize(page as string);
      let hits = 0;
      for (const t of stemTokens) if (pageTokens.has(t)) hits += 1;
      expect(hits / stemTokens.size).toBeGreaterThanOrEqual(0.5);
    }
  });
});

describe("validateGeneratedQuestion — imageRef", () => {
  function valid(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      type: "SINGLE_CHOICE",
      text: "What is the minimum approach distance?",
      textAr: "ما هي مسافة الاقتراب الآمنة؟",
      options: ["One metre", "Two metres", "Three metres"],
      optionsAr: ["متر واحد", "متران", "ثلاثة أمتار"],
      correctAnswers: [0],
      difficulty: "MEDIUM",
      ...overrides,
    };
  }

  it("accepts a positive integer imageRef", () => {
    const q = validateGeneratedQuestion(valid({ imageRef: 2 }), 0);
    expect(q.imageRef).toBe(2);
  });

  it("accepts a numeric string imageRef", () => {
    const q = validateGeneratedQuestion(valid({ imageRef: "1" }), 0);
    expect(q.imageRef).toBe(1);
  });

  it("rejects non-positive or non-integer imageRef", () => {
    expect(() => validateGeneratedQuestion(valid({ imageRef: 0 }), 0)).toThrow();
    expect(() => validateGeneratedQuestion(valid({ imageRef: -1 }), 0)).toThrow();
    expect(() => validateGeneratedQuestion(valid({ imageRef: 1.5 }), 0)).toThrow();
  });

  it("omits imageRef when absent", () => {
    const q = validateGeneratedQuestion(valid(), 0);
    expect(q.imageRef).toBeUndefined();
  });
});
