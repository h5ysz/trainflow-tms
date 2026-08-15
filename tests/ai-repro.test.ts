// REPRODUCTION test — intentionally documents the CURRENT behaviour, not the
// desired one. It generates real batches through the existing pipeline
// (extract → mock provider → parse → validate → dedupe) and asserts the
// six product guarantees. Any failure here is the bug we must fix.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import fsStream from "node:fs";
import path from "node:path";
import os from "node:os";
import PDFDocument from "pdfkit";
import sharp from "sharp";

const tempDir = path.join(os.tmpdir(), `ai-repro-${Date.now()}`);
const materialsDir = path.join(tempDir, "course-materials");
const imagesDir = path.join(tempDir, "question-images");
let seq = 0;

beforeAll(async () => {
  process.env.AI_MOCK_ENABLED = "true";
  process.env.COURSE_MATERIALS_DIR = materialsDir;
  process.env.QUESTION_IMAGES_DIR = imagesDir;
  await fs.mkdir(materialsDir, { recursive: true });
});

afterAll(async () => {
  delete process.env.AI_MOCK_ENABLED;
  delete process.env.COURSE_MATERIALS_DIR;
  delete process.env.QUESTION_IMAGES_DIR;
  await fs.rm(tempDir, { recursive: true, force: true });
});

import { _resetProviderCache } from "@/lib/ai/provider";
import { extractMaterialText } from "@/lib/ai/material-extractor";
import { generateBilingualQuestions, dedupeQuestions } from "@/lib/ai/question-generator";
import { extractMaterialImages, significantWords } from "@/lib/ai/material-images";

// 12 real facts that ALL map to the SAME topic (fire safety) — the worst case:
// the provider has to produce a fully distinct question for every one of them.
const FIRE = [
  "Fire extinguishers must be kept accessible and inspected regularly.",
  "Fire extinguishers must be tagged with an inspection date after every use.",
  "Flammable materials must be stored away from sources of heat.",
  "Smoke and heat detectors should be tested as part of routine checks.",
  "Fire drills must be practiced by all workers at least once a year.",
  "Fire escape routes must always remain clear and unobstructed.",
  "A fire blanket should be available in areas where cooking takes place.",
  "Fire hydrants must not be blocked by parked vehicles or stored goods.",
  "Combustible dust should be cleaned up promptly to prevent fire risks.",
  "Fire wardens must be trained to lead evacuations during an emergency.",
  "Fire extinguishers should be refilled immediately after any discharge.",
  "Flammable liquids must be kept in approved containers with clear labels.",
];

async function makePdf(sentences: string[]): Promise<string> {
  const filePath = path.join(materialsDir, `${Math.random().toString(16).slice(2)}.pdf`);
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument();
    const out = fsStream.createWriteStream(filePath);
    doc.pipe(out);
    doc.fontSize(14);
    for (const s of sentences) {
      doc.text(s);
      doc.moveDown();
    }
    doc.end();
    out.on("finish", () => resolve());
    out.on("error", reject);
  });
  return filePath;
}

async function materialTextOf(sentences: string[]): Promise<string> {
  seq++;
  const filePath = await makePdf(sentences);
  const { text } = await extractMaterialText({
    id: `repro-${seq}`,
    type: "PDF",
    storagePath: `course-materials/${path.basename(filePath)}`,
    fileName: "repro.pdf",
  });
  return text;
}

describe("REPRODUCTION — 12 same-topic facts", () => {
  it("generating 12 questions yields 12 fully distinct, bilingual questions", async () => {
    _resetProviderCache();
    const text = await materialTextOf(FIRE);

    const { questions } = await generateBilingualQuestions({
      count: 12,
      types: ["SINGLE_CHOICE"],
      materialText: text,
      materialTitle: "fire.pdf",
      courseTitle: "Fire Safety",
    });

    const en = questions.map((q) => q.text);
    const ar = questions.map((q) => q.textAr ?? "");
    const correct = questions.map((q) => q.options[q.correctAnswers[0]]);
    console.log(
      `REPRO-1 requested=12 returned=${questions.length} ` +
        `uniqueEN=${new Set(en).size} uniqueAR=${new Set(ar).size} uniqueCorrect=${new Set(correct).size}`,
    );
    for (const q of questions) console.log(`  ${q.difficulty} | EN: ${q.text} | AR: ${q.textAr}`);

    // No internal duplicates (literal OR reworded) in the batch.
    expect(dedupeQuestions(questions, []).length).toBe(questions.length);

    // The batch must be complete, distinct, and its correct answers must not
    // repeat (the same fact tested under different stems).
    expect(questions.length).toBe(12);
    expect(new Set(en).size).toBe(12);
    expect(new Set(ar).size).toBe(12);
    expect(new Set(correct).size).toBe(12);
  });

  it("every returned question is fully bilingual (EN + AR)", async () => {
    _resetProviderCache();
    const text = await materialTextOf(FIRE);
    const { questions } = await generateBilingualQuestions({
      count: 6,
      types: ["SINGLE_CHOICE"],
      materialText: text,
      materialTitle: "fire.pdf",
      courseTitle: "Fire Safety",
    });
    for (const q of questions) {
      expect(q.text.trim().length).toBeGreaterThan(0);
      expect(q.textAr?.trim().length).toBeGreaterThan(0);
      expect(q.options.length).toBeGreaterThanOrEqual(2);
      expect(q.optionsAr.length).toBe(q.options.length);
      for (const o of q.optionsAr) expect(o.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("REPRODUCTION — EASY / MEDIUM / HARD", () => {
  it("each difficulty level covers genuinely different facts and returns the full batch", async () => {
    const text = await materialTextOf(FIRE);
    const batch = async (d: "EASY" | "MEDIUM" | "HARD") => {
      _resetProviderCache();
      const { questions } = await generateBilingualQuestions({
        count: 4,
        types: ["SINGLE_CHOICE"],
        difficulty: d,
        materialText: text,
        materialTitle: "fire.pdf",
        courseTitle: "Fire Safety",
      });
      console.log(`REPRO-2 ${d}: returned=${questions.length} -> ${questions.map((q) => q.text.slice(0, 26)).join(" | ")}`);
      return questions;
    };

    const [easy, med, hard] = [await batch("EASY"), await batch("MEDIUM"), await batch("HARD")];
    const overlap = (a: string[], b: string[]) => a.filter((s) => b.includes(s)).length;
    const e = easy.map((q) => q.text);
    const m = med.map((q) => q.text);
    const h = hard.map((q) => q.text);
    console.log(`REPRO-2 overlap E/M=${overlap(e, m)} M/H=${overlap(m, h)} E/H=${overlap(e, h)}`);

    // Levels must draw from different facts (no repeated question across levels).
    expect(overlap(e, m)).toBe(0);
    expect(overlap(m, h)).toBe(0);
    expect(overlap(e, h)).toBe(0);
    // And each level must return the full 4 it was asked for.
    expect(easy.length).toBe(4);
    expect(med.length).toBe(4);
    expect(hard.length).toBe(4);
  });
});

describe("REPRODUCTION — image relevance", () => {
  async function makeFigurePdf(): Promise<string> {
    const png = await sharp({
      create: { width: 200, height: 120, channels: 4, background: { r: 0, g: 150, b: 150, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const filePath = path.join(materialsDir, `fig-${Math.random().toString(16).slice(2)}.pdf`);
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument();
      const out = fsStream.createWriteStream(filePath);
      doc.pipe(out);
      // Page 1: figure + a sentence that genuinely describes it.
      doc.image(png, 0, 0, { fit: [200, 120] });
      doc.moveDown();
      doc.fontSize(14).text("The diagram shows fire extinguishers must be kept accessible and inspected regularly.");
      // Page 2: an unrelated fact with no figure.
      doc.addPage();
      doc.fontSize(14).text("Flammable materials must be stored away from sources of heat.");
      doc.end();
      out.on("finish", () => resolve());
      out.on("error", reject);
    });
    return filePath;
  }

  it("an attached image is genuinely related to its question, never random", async () => {
    _resetProviderCache();
    seq++;
    const id = `repro-fig-${seq}`;
    const filePath = await makeFigurePdf();
    const images = await extractMaterialImages({
      id,
      type: "PDF",
      storagePath: `course-materials/${path.basename(filePath)}`,
      fileName: "fig.pdf",
    });
    expect(images.length).toBe(1);
    const { text } = await extractMaterialText({
      id,
      type: "PDF",
      storagePath: `course-materials/${path.basename(filePath)}`,
      fileName: "fig.pdf",
    });

    const { questions } = await generateBilingualQuestions({
      count: 2,
      types: ["SINGLE_CHOICE"],
      materialText: text,
      materialTitle: "fig.pdf",
      courseTitle: "C",
      figures: images.map((im, idx) => ({
        index: idx + 1,
        page: im.page,
        pageText: im.pageText,
        caption: im.caption,
        surroundText: im.surroundText,
      })),
    });

    console.log(`REPRO-3 text=[${text}]`);
    console.log(`REPRO-3 figure: page=${images[0].page} caption=${images[0].caption ?? "none"} surround=[${images[0].surroundText ?? "none"}]`);
    console.log(`REPRO-3 questions=${questions.length} -> ${questions.map((q) => `${q.text.slice(0, 34)}|ref=${q.imageRef}|url=${q.imageUrl ?? "-"}`).join("  /  ")}`);

    // The generator returns imageRef; the route resolves it to the figure URL.
    const withUrl = questions.map((q) =>
      q.imageRef !== undefined ? { ...q, imageUrl: images[q.imageRef - 1]?.url } : q,
    );
    const matched = withUrl.find((q) => q.text.includes("diagram shows fire extinguishers"));
    const unrelated = withUrl.find((q) => q.text.includes("Flammable"));
    console.log(`REPRO-3 matchedImage=${matched?.imageUrl ?? "none"} unrelatedImage=${unrelated?.imageUrl ?? "none"}`);

    // The sentence that describes the figure gets the image...
    expect(matched?.imageUrl).toBeTruthy();
    // ...and the unrelated fact stays image-less.
    expect(unrelated?.imageUrl).toBeUndefined();

    // Relevance: the attached figure's page text must actually cover the stem.
    for (const q of questions.filter((x) => x.imageUrl)) {
      const stem = new Set(significantWords(q.text));
      const page = new Set(significantWords(images[0].pageText));
      const hits = [...stem].filter((w) => page.has(w)).length;
      console.log(`REPRO-3 stem="${q.text.slice(0, 45)}" overlap=${hits}/${stem.size}`);
      expect(hits / stem.size).toBeGreaterThanOrEqual(0.6);
    }
  });
});
