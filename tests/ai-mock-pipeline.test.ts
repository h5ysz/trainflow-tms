// Integration test for the offline Mock AI provider: its output must pass the
// generator's strict bilingual validation, and the full pipeline
// (extract → prompt → provider → parse → validate) must produce questions
// derived from the REAL source text.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const tempDir = path.join(os.tmpdir(), `ai-mock-test-${Date.now()}`);
const materialsDir = path.join(tempDir, "course-materials");

beforeAll(async () => {
  process.env.AI_MOCK_ENABLED = "true";
  process.env.COURSE_MATERIALS_DIR = materialsDir;
  await fs.mkdir(materialsDir, { recursive: true });
});

afterAll(async () => {
  delete process.env.AI_MOCK_ENABLED;
  delete process.env.COURSE_MATERIALS_DIR;
  await fs.rm(tempDir, { recursive: true, force: true });
});

import { _resetProviderCache } from "@/lib/ai/provider";
import { extractMaterialText } from "@/lib/ai/material-extractor";
import { generateBilingualQuestions } from "@/lib/ai/question-generator";

// Build a real PDF with pdfkit, matching the app's certificate generator.
async function makePdf(): Promise<string> {
  const PDFDocument = (await import("pdfkit")).default;
  const fsStream = (await import("node:fs")).default;
  const filePath = path.join(materialsDir, `${Math.random().toString(16).slice(2)}.pdf`);
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument();
    const out = fsStream.createWriteStream(filePath);
    doc.pipe(out);
    doc.fontSize(14).text("Fire safety training covers evacuation routes and extinguisher types.");
    doc.moveDown();
    doc.text("Evacuation drills are mandatory every six months. Fire extinguishers must be inspected annually.");
    doc.moveDown();
    doc.text("Emergency contacts must be displayed in every work area.");
    doc.end();
    out.on("finish", () => resolve());
    out.on("error", reject);
  });
  return filePath;
}

describe("Mock AI provider — full pipeline", () => {
  it("extracts real PDF text and generates validated bilingual questions from it", async () => {
    _resetProviderCache();
    const filePath = await makePdf();
    const { text } = await extractMaterialText({
      id: "m1",
      type: "PDF",
      storagePath: `course-materials/${path.basename(filePath)}`,
      fileName: "fire-safety.pdf",
    });

    const { questions, model } = await generateBilingualQuestions({
      count: 6,
      types: ["SINGLE_CHOICE", "TRUE_FALSE"],
      difficulty: "MEDIUM",
      materialText: text,
      materialTitle: "fire-safety.pdf",
      courseTitle: "Fire Safety",
    });

    expect(model).toBe("mock-bilingual-generator");
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.length).toBeLessThanOrEqual(6);

    for (const q of questions) {
      // Strictly bilingual — the product rule.
      expect(q.text).toBeTruthy();
      expect(q.textAr).toBeTruthy();
      expect(q.optionsAr).toHaveLength(q.options.length);
      if (q.options.length > 0) {
        expect(q.optionsAr.every((o) => o.trim().length > 0)).toBe(true);
      }
      expect(q.correctAnswers.every((i) => i >= 0 && i < q.options.length)).toBe(true);
      expect(["EASY", "MEDIUM", "HARD"]).toContain(q.difficulty);
      expect(q.explanation).toBeTruthy();
      expect(q.explanationAr).toBeTruthy();
      // Full EN↔AR consistency: the Arabic side of every field translates the
      // English side of the same question — never a canned per-topic paragraph.
      expect(q.explanation).toBe(q.text);
      expect(q.explanationAr).toBe(q.textAr);
    }

    // Questions are grounded in the real extracted text, not fabricated.
    const joined = questions.map((q) => q.text).join(" ").toLowerCase();
    expect(joined).toContain("fire safety training");
    expect(joined).toContain("evacuation");
  });

  it("distributes types as requested (TRUE_FALSE questions use boolean options)", async () => {
    _resetProviderCache();
    const filePath = await makePdf();
    const { text } = await extractMaterialText({ id: "m2", type: "PDF", storagePath: `course-materials/${path.basename(filePath)}`, fileName: "b.pdf" });
    const { questions } = await generateBilingualQuestions({
      count: 4,
      types: ["TRUE_FALSE"],
      materialText: text,
      materialTitle: "b.pdf",
      courseTitle: "C",
    });
    expect(questions.length).toBe(4);
    for (const q of questions) {
      expect(q.type).toBe("TRUE_FALSE");
      expect(q.options).toEqual(["True", "False"]);
      expect(q.optionsAr).toEqual(["صحيح", "خطأ"]);
      expect(q.correctAnswers.length).toBe(1);
    }
  });

  it("rejects a provider response that is English-only (no Arabic)", async () => {
    // The pipeline must never surface monolingual questions: a response missing
    // textAr fails strict validation and is rejected as a batch.
    const { QuestionValidationError, validateGeneratedQuestion } = await import("@/lib/ai/question-generator");
    expect(() =>
      validateGeneratedQuestion(
        {
          type: "TRUE_FALSE",
          text: "Only English question stem",
          textAr: undefined,
          options: ["True", "False"],
          optionsAr: ["صحيح", "خطأ"],
          correctAnswers: [0],
          difficulty: "EASY",
        },
        0,
      ),
    ).toThrow(QuestionValidationError);
  });
});

describe("Mock AI provider — distinctness guarantees", () => {
  // All three facts map to the same topic, so the provider must rotate its
  // Arabic stems and distractor options instead of repeating them.
  async function makeFirePdf(): Promise<string> {
    const PDFDocument = (await import("pdfkit")).default;
    const fsStream = (await import("node:fs")).default;
    const filePath = path.join(materialsDir, `${Math.random().toString(16).slice(2)}.pdf`);
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument();
      const out = fsStream.createWriteStream(filePath);
      doc.pipe(out);
      doc.text("Fire extinguishers must be kept accessible and inspected regularly.");
      doc.moveDown();
      doc.text("Flammable materials must be stored away from sources of heat.");
      doc.moveDown();
      doc.text("Smoke and heat detectors should be tested as part of routine checks.");
      doc.end();
      out.on("finish", () => resolve());
      out.on("error", reject);
    });
    return filePath;
  }

  it("never reuses a source sentence, even when count exceeds the material's facts", async () => {
    _resetProviderCache();
    const filePath = await makePdf();
    const { text } = await extractMaterialText({
      id: "m-noreuse",
      type: "PDF",
      storagePath: `course-materials/${path.basename(filePath)}`,
      fileName: "c.pdf",
    });

    const { questions } = await generateBilingualQuestions({
      count: 6,
      types: ["SINGLE_CHOICE"],
      materialText: text,
      materialTitle: "c.pdf",
      courseTitle: "C",
    });

    expect(questions.length).toBe(4);
    expect(new Set(questions.map((q) => q.text)).size).toBe(4);
  });

  it("rotates Arabic stems and options for questions on the same topic", async () => {
    _resetProviderCache();
    const filePath = await makeFirePdf();
    const { text } = await extractMaterialText({
      id: "m-rotate",
      type: "PDF",
      storagePath: `course-materials/${path.basename(filePath)}`,
      fileName: "fire.pdf",
    });

    const { questions } = await generateBilingualQuestions({
      count: 3,
      types: ["SINGLE_CHOICE"],
      materialText: text,
      materialTitle: "fire.pdf",
      courseTitle: "C",
    });

    expect(questions.length).toBe(3);
    expect(new Set(questions.map((q) => q.textAr)).size).toBe(3);
    const options = questions.flatMap((q) => q.options);
    expect(new Set(options).size).toBe(options.length);
  });

  it("skips a fact the trainer explicitly excluded", async () => {
    _resetProviderCache();
    const filePath = await makePdf();
    const { text } = await extractMaterialText({
      id: "m-excl",
      type: "PDF",
      storagePath: `course-materials/${path.basename(filePath)}`,
      fileName: "d.pdf",
    });
    const excluded = "Fire extinguishers must be inspected annually.";

    const { questions } = await generateBilingualQuestions({
      count: 4,
      materialText: text,
      materialTitle: "d.pdf",
      courseTitle: "C",
      excludeTexts: [excluded],
    });

    expect(questions.length).toBe(3);
    expect(questions.every((q) => q.text !== excluded)).toBe(true);
  });
});
