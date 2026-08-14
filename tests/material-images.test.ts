// Unit tests for the AI material image extractor: real PDF (built with pdfkit
// embedding a genuine PNG) → extracted PNG files + manifest cache, and the
// page-text relevance matching that attaches a figure to its question.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import fsStream from "node:fs";
import path from "node:path";
import os from "node:os";
import PDFDocument from "pdfkit";
import sharp from "sharp";

const tempDir = path.join(os.tmpdir(), `ai-images-test-${Date.now()}`);
const materialsDir = path.join(tempDir, "course-materials");
const imagesDir = path.join(tempDir, "question-images");

beforeAll(async () => {
  process.env.COURSE_MATERIALS_DIR = materialsDir;
  process.env.QUESTION_IMAGES_DIR = imagesDir;
  await fs.mkdir(materialsDir, { recursive: true });
});

afterAll(async () => {
  delete process.env.COURSE_MATERIALS_DIR;
  delete process.env.QUESTION_IMAGES_DIR;
  await fs.rm(tempDir, { recursive: true, force: true });
});

const {
  extractMaterialImages,
  bestImageForQuestion,
  attachMaterialImages,
  significantWords,
} = await import("@/lib/ai/material-images");

const MATERIAL_ID = "mat-img-1";

async function makePdfWithFigure(): Promise<string> {
  // A real PNG to embed: 200x120 solid teal block.
  const png = await sharp({
    create: { width: 200, height: 120, channels: 4, background: { r: 0, g: 150, b: 150, alpha: 1 } },
  })
    .png()
    .toBuffer();

  const filePath = path.join(materialsDir, `${Math.random().toString(16).slice(2)}.pdf`);
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument();
    const out = fsStream.createWriteStream(filePath);
    doc.pipe(out);
    doc.fontSize(14).text("Personal protective equipment must be worn when working on live electrical systems.");
    doc.moveDown();
    doc.image(png, 0, 0, { fit: [200, 120] });
    doc.text("Fire extinguishers must be kept accessible and inspected regularly.");
    doc.end();
    out.on("finish", () => resolve());
    out.on("error", reject);
  });
  return filePath;
}

describe("extractMaterialImages from a real PDF", () => {
  it("extracts the embedded figure, writes a PNG + manifest, and returns its URL", async () => {
    const filePath = await makePdfWithFigure();
    const images = await extractMaterialImages({
      id: MATERIAL_ID,
      type: "PDF",
      storagePath: `course-materials/${path.basename(filePath)}`,
      fileName: "safety-figures.pdf",
    });

    expect(images.length).toBeGreaterThan(0);
    const img = images[0];
    expect(img.width).toBe(200);
    expect(img.height).toBe(120);
    expect(img.page).toBe(1);
    expect(img.url).toMatch(new RegExp(`^/api/uploads/question-images/${MATERIAL_ID}/`));
    expect(img.pageText.toLowerCase()).toContain("personal protective equipment");

    // The PNG really exists on disk, under the configured images dir.
    const file = path.join(imagesDir, MATERIAL_ID, path.basename(img.url));
    const stat = await fs.stat(file);
    expect(stat.size).toBeGreaterThan(0);
    const png = await sharp(file).metadata();
    expect(png.width).toBe(200);
    expect(png.height).toBe(120);

    // Manifest written for future cache hits.
    const manifest = JSON.parse(await fs.readFile(path.join(imagesDir, MATERIAL_ID, "manifest.json"), "utf8"));
    expect(manifest.sourceSize).toBe((await fs.stat(filePath)).size);
    expect(manifest.images).toHaveLength(images.length);
  });

  it("serves the cached result on a second call (same URLs, no re-extraction)", async () => {
    const filePath = await makePdfWithFigure();
    const first = await extractMaterialImages({ id: MATERIAL_ID, type: "PDF", storagePath: `course-materials/${path.basename(filePath)}`, fileName: "a.pdf" });
    const second = await extractMaterialImages({ id: MATERIAL_ID, type: "PDF", storagePath: `course-materials/${path.basename(filePath)}`, fileName: "a.pdf" });
    expect(second.map((i) => i.url)).toEqual(first.map((i) => i.url));
  });

  it("is best-effort: non-PDF types and missing files return [] instead of throwing", async () => {
    await expect(
      extractMaterialImages({ id: MATERIAL_ID, type: "WORD", storagePath: "course-materials/x.docx", fileName: "x.docx" }),
    ).resolves.toEqual([]);
    await expect(
      extractMaterialImages({ id: MATERIAL_ID, type: "PDF", storagePath: "course-materials/00000000000000000000000000000000.pdf", fileName: "gone.pdf" }),
    ).resolves.toEqual([]);
  });
});

describe("bestImageForQuestion (page-text relevance matching)", () => {
  const images = [
    {
      url: "/api/uploads/question-images/m/1.png",
      page: 1,
      width: 200,
      height: 120,
      pageText: "Personal protective equipment must be worn when working on live electrical systems.",
    },
    {
      url: "/api/uploads/question-images/m/2.png",
      page: 2,
      width: 200,
      height: 120,
      pageText: "Fire extinguishers must be kept accessible and inspected regularly.",
    },
  ];

  it("picks the image whose page text contains the question stem", () => {
    const match = bestImageForQuestion("Personal protective equipment must be worn when working on live electrical systems.", images);
    expect(match?.url).toBe(images[0].url);
  });

  it("returns null when no page strongly matches (threshold)", () => {
    const match = bestImageForQuestion("The TrainFlow system manages training sessions and the question bank.", images);
    expect(match).toBeNull();
  });

  it("returns null for short/empty stems", () => {
    expect(bestImageForQuestion("yes", images)).toBeNull();
    expect(bestImageForQuestion("", images)).toBeNull();
  });

  it("attaches only matched images to a batch of questions", () => {
    const questions = attachMaterialImages(
      [
        {
          type: "SINGLE_CHOICE" as const,
          text: "Personal protective equipment must be worn when working on live electrical systems.",
          textAr: "يجب ارتداء معدات الوقاية الشخصية عند العمل على الأنظمة الكهربائية المكهربة.",
          options: ["a", "b", "c"],
          optionsAr: ["أ", "ب", "ج"],
          correctAnswers: [0],
          difficulty: "EASY" as const,
        },
        {
          type: "SINGLE_CHOICE" as const,
          text: "The TrainFlow system manages training sessions and the question bank.",
          textAr: "نظام ترين فلاو يدير الجلسات التدريبية وبنك الأسئلة.",
          options: ["a", "b"],
          optionsAr: ["أ", "ب"],
          correctAnswers: [1],
          difficulty: "EASY" as const,
        },
      ],
      images,
    );
    expect(questions[0].imageUrl).toBe(images[0].url);
    expect(questions[1].imageUrl).toBeUndefined();
  });
});

describe("significantWords", () => {
  it("lowercases, strips punctuation and drops stopwords", () => {
    expect(significantWords("PPE must be Worn on Live! systems")).toEqual(["ppe", "worn", "live", "systems"]);
  });
});
