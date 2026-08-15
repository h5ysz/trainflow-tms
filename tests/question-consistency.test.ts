// Unit tests for the bilingual EN↔AR consistency repair pass. The structural
// validator proves both languages exist; this pass must fix (or, on failure,
// silently keep) Arabic that does not faithfully translate the English.
import { describe, it, expect } from "vitest";
import {
  repairBilingualConsistency,
  validateGeneratedQuestion,
} from "@/lib/ai/question-generator";
import type { AIProvider, ChatResponse } from "@/lib/ai/provider";

function fakeProvider(reply: string | (() => string) | (() => never)): AIProvider {
  return {
    name: "fake",
    capabilities: {
      streaming: false,
      toolCalling: false,
      structuredOutput: false,
      imageUnderstanding: false,
      fileAnalysis: false,
      conversationMemory: false,
      tokenCounting: false,
    },
    async chat(): Promise<ChatResponse> {
      if (typeof reply === "function") {
        return { content: (reply as () => string)() };
      }
      return { content: reply };
    },
  };
}

function makeQuestions() {
  return [
    validateGeneratedQuestion(
      {
        type: "SINGLE_CHOICE",
        text: "What is the correct test voltage for a 120V circuit?",
        textAr: "ما الجهد الصحيح لاختبار دائرة 120 فولت؟",
        options: ["110V", "120V", "240V", "400V"],
        optionsAr: ["110 فولت", "120 فولت", "240 فولت", "400 فولت"],
        correctAnswers: [1],
        difficulty: "MEDIUM",
        explanation: "The standard test voltage is 120V.",
        explanationAr: "جهد الاختبار القياسي هو 120 فولت.",
      },
      0,
    ),
    validateGeneratedQuestion(
      {
        type: "SINGLE_CHOICE",
        text: "What color is the fire extinguisher for Class A fires?",
        textAr: "كم عدد طفايات الحريق المطلوبة في المبنى؟",
        options: ["Red", "Blue", "Green", "Yellow"],
        optionsAr: ["أحمر", "أزرق", "أخضر", "أصفر"],
        correctAnswers: [0],
        difficulty: "MEDIUM",
        explanation: "Class A fires are suppressed with red extinguishers.",
        explanationAr: "يتم إخماد حرائق الفئة أ باستخدام طفايات حمراء.",
      },
      1,
    ),
  ];
}

describe("repairBilingualConsistency", () => {
  it("rewrites only the drifted Arabic fields of an inconsistent pair", async () => {
    const provider = fakeProvider(JSON.stringify({
      questions: [
        { index: 0, consistent: true },
        {
          index: 1,
          consistent: false,
          textAr: "ما لون طفاية الحريق المناسبة لحرائق الفئة أ؟",
          optionsAr: ["أحمر", "أزرق", "أخضر", "أصفر"],
          explanationAr: "يتم إخماد حرائق الفئة أ باستخدام طفايات حمراء.",
        },
      ],
    }));

    const [q0, q1] = await repairBilingualConsistency(provider, makeQuestions());

    expect(q0.textAr).toBe("ما الجهد الصحيح لاختبار دائرة 120 فولت؟");
    expect(q1.textAr).toBe("ما لون طفاية الحريق المناسبة لحرائق الفئة أ؟");
    expect(q1.optionsAr).toEqual(["أحمر", "أزرق", "أخضر", "أصفر"]);
    expect(q1.explanationAr).toBe("يتم إخماد حرائق الفئة أ باستخدام طفايات حمراء.");
    // English fields are never touched.
    expect(q1.text).toBe("What color is the fire extinguisher for Class A fires?");
  });

  it("does not mutate the input batch", async () => {
    const provider = fakeProvider(JSON.stringify({
      questions: [
        { index: 0, consistent: false, textAr: "سؤال عربي مصحح؟" },
      ],
    }));
    const input = makeQuestions();
    const originalAr = input[0].textAr;

    const result = await repairBilingualConsistency(provider, input);

    expect(result[0].textAr).toBe("سؤال عربي مصحح؟");
    expect(input[0].textAr).toBe(originalAr);
  });

  it("leaves the batch untouched when every pair is consistent", async () => {
    const provider = fakeProvider(JSON.stringify({
      questions: [
        { index: 0, consistent: true },
        { index: 1, consistent: true },
      ],
    }));
    const input = makeQuestions();
    const before = input.map((q) => q.textAr);

    const result = await repairBilingualConsistency(provider, input);

    expect(result.map((q) => q.textAr)).toEqual(before);
  });

  it("returns the batch unchanged when the provider throws", async () => {
    const provider = fakeProvider(() => {
      throw new Error("network down");
    });
    const input = makeQuestions();
    const before = input.map((q) => ({ textAr: q.textAr, optionsAr: [...q.optionsAr] }));

    const result = await repairBilingualConsistency(provider, input);

    expect(result.map((q) => q.textAr)).toEqual(before.map((b) => b.textAr));
    expect(result.map((q) => q.optionsAr)).toEqual(before.map((b) => b.optionsAr));
  });

  it("returns the batch unchanged when the reply has no questions list", async () => {
    const provider = fakeProvider("Sorry, I cannot verify these.");
    const input = makeQuestions();
    const before = input.map((q) => q.textAr);

    const result = await repairBilingualConsistency(provider, input);

    expect(result.map((q) => q.textAr)).toEqual(before);
  });

  it("rejects a correction that is not genuine Arabic (English pasted in)", async () => {
    const provider = fakeProvider(JSON.stringify({
      questions: [
        { index: 1, consistent: false, textAr: "What color is the fire extinguisher for Class A fires?" },
      ],
    }));
    const input = makeQuestions();
    const original = input[1].textAr;

    const result = await repairBilingualConsistency(provider, input);

    expect(result[1].textAr).toBe(original);
  });

  it("rejects an optionsAr correction whose length does not mirror options", async () => {
    const provider = fakeProvider(JSON.stringify({
      questions: [
        {
          index: 1,
          consistent: false,
          textAr: "ما لون طفاية الحريق المناسبة لحرائق الفئة أ؟",
          optionsAr: ["أحمر", "أزرق"], // wrong length vs 4 English options
        },
      ],
    }));
    const input = makeQuestions();
    const originalOptions = [...input[1].optionsAr];

    const result = await repairBilingualConsistency(provider, input);

    expect(result[1].optionsAr).toEqual(originalOptions);
  });

  it("ignores verdicts with out-of-range indices", async () => {
    const provider = fakeProvider(JSON.stringify({
      questions: [
        { index: 99, consistent: false, textAr: "لا شيء" },
        { index: -1, consistent: false, textAr: "لا شيء" },
      ],
    }));
    const input = makeQuestions();
    const before = input.map((q) => q.textAr);

    const result = await repairBilingualConsistency(provider, input);

    expect(result.map((q) => q.textAr)).toEqual(before);
  });
});
