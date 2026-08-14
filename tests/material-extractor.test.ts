// Unit tests for the AI material text extractor. Uses REAL fixture files:
//  - a PDF generated on the fly with pdfkit (the same generator used to produce
//    certificates elsewhere in the app),
//  - minimal DOCX / PPTX packages built with jszip (real OOXML structure),
// so extraction is exercised against genuine file formats — not mocked buffers.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import fsStream from "node:fs";
import path from "node:path";
import os from "node:os";
import PDFDocument from "pdfkit";
import JSZip from "jszip";

const tempDir = path.join(os.tmpdir(), `ai-extractor-test-${Date.now()}`);
const materialsDir = path.join(tempDir, "course-materials");

beforeAll(async () => {
  process.env.COURSE_MATERIALS_DIR = materialsDir;
  await fs.mkdir(materialsDir, { recursive: true });
});

afterAll(async () => {
  delete process.env.COURSE_MATERIALS_DIR;
  await fs.rm(tempDir, { recursive: true, force: true });
});

const { extractMaterialText, extractMaterialsText, MaterialExtractionError } = await import("@/lib/ai/material-extractor");

async function makePdf(): Promise<string> {
  const filePath = path.join(materialsDir, `${Math.random().toString(16).slice(2)}.pdf`);
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument();
    const out = fsStream.createWriteStream(filePath);
    doc.pipe(out);
    doc.fontSize(14).text("Introduction to TrainFlow Management System");
    doc.moveDown();
    doc.text("The system manages courses, sessions, assessments and training materials.");
    doc.text("Question Bank contains all approved questions used across exams.");
    doc.end();
    out.on("finish", () => resolve());
    out.on("error", reject);
  });
  return filePath;
}

async function makeDocx(): Promise<string> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Word extractor reads this paragraph.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Second line with numbers 42 and 1337.</w:t></w:r></w:p>
  </w:body>
</w:document>`);
  const filePath = path.join(materialsDir, `${Math.random().toString(16).slice(2)}.docx`);
  await fs.writeFile(filePath, await zip.generateAsync({ type: "nodebuffer" }));
  return filePath;
}

async function makePptx(): Promise<string> {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
  <Override PartName="/ppt/slides/slide2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>
`);
  const slideXml = (text: string) => `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
  zip.file("ppt/slides/slide1.xml", slideXml("Slide one covers project management &amp; scheduling."));
  zip.file("ppt/slides/slide2.xml", slideXml("Slide two covers risk mitigation steps."));
  const filePath = path.join(materialsDir, `${Math.random().toString(16).slice(2)}.pptx`);
  await fs.writeFile(filePath, await zip.generateAsync({ type: "nodebuffer" }));
  return filePath;
}

describe("extractMaterialText from a real PDF", () => {
  it("returns the actual text embedded in the PDF", async () => {
    const filePath = await makePdf();
    const result = await extractMaterialText({
      id: "mat-1",
      type: "PDF",
      storagePath: `course-materials/${path.basename(filePath)}`,
      fileName: "manual.pdf",
    });
    expect(result.type).toBe("PDF");
    expect(result.fileName).toBe("manual.pdf");
    expect(result.text).toContain("Introduction to TrainFlow Management System");
    expect(result.text).toContain("Question Bank contains all approved questions");
  });

  it("normalizes whitespace (no run-on lines)", async () => {
    const filePath = await makePdf();
    const result = await extractMaterialText({ id: "mat-1", type: "PDF", storagePath: `course-materials/${path.basename(filePath)}`, fileName: "a.pdf" });
    expect(result.text).not.toMatch(/\n\s*\n\s*\n/);
    expect(result.text.split("\n").every((l) => l === l.trim())).toBe(true);
  });
});

describe("extractMaterialText from a real DOCX", () => {
  it("extracts the body paragraphs", async () => {
    const filePath = await makeDocx();
    const result = await extractMaterialText({ id: "mat-2", type: "WORD", storagePath: `course-materials/${path.basename(filePath)}`, fileName: "notes.docx" });
    expect(result.type).toBe("WORD");
    expect(result.text).toContain("Word extractor reads this paragraph.");
    expect(result.text).toContain("Second line with numbers 42 and 1337.");
  });
});

describe("extractMaterialText from a real PPTX", () => {
  it("extracts slide text in order and decodes entities", async () => {
    const filePath = await makePptx();
    const result = await extractMaterialText({ id: "mat-3", type: "POWERPOINT", storagePath: `course-materials/${path.basename(filePath)}`, fileName: "deck.pptx" });
    expect(result.type).toBe("POWERPOINT");
    expect(result.text).toContain("Slide one covers project management & scheduling.");
    expect(result.text).toContain("Slide two covers risk mitigation steps.");
    expect(result.text.indexOf("Slide one")).toBeLessThan(result.text.indexOf("Slide two"));
  });
});

describe("extractMaterialText failure modes (no content guessing)", () => {
  it("rejects non-extractable types (IMAGE/LINK) even if the file exists", async () => {
    const filePath = await makePdf();
    await expect(
      extractMaterialText({ id: "m", type: "IMAGE", storagePath: `course-materials/${path.basename(filePath)}`, fileName: "pic.png" }),
    ).rejects.toThrow(/cannot be used as a source/i);
  });

  it("rejects a missing storagePath", async () => {
    await expect(extractMaterialText({ id: "m", type: "PDF", storagePath: null, fileName: "ext.pptx" })).rejects.toThrow(/no stored file/i);
  });

  it("rejects a deleted file", async () => {
    await expect(extractMaterialText({ id: "m", type: "PDF", storagePath: "course-materials/00000000000000000000000000000000.pdf", fileName: "gone.pdf" })).rejects.toThrow(/could not read stored file/i);
  });

  it("rejects path traversal attempts", async () => {
    await expect(extractMaterialText({ id: "m", type: "PDF", storagePath: "course-materials/../../secrets.pdf", fileName: "evil.pdf" })).rejects.toThrow(/invalid storage path/i);
    await expect(extractMaterialText({ id: "m", type: "PDF", storagePath: "C:\\Windows\\secrets.pdf", fileName: "evil.pdf" })).rejects.toThrow(/invalid storage path/i);
  });

  it("rejects files whose text is too short (e.g. an image-only PDF)", async () => {
    const filePath = path.join(materialsDir, `${Math.random().toString(16).slice(2)}.pdf`);
    await new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument();
      const out = fsStream.createWriteStream(filePath);
      doc.pipe(out);
      doc.fontSize(12).text("x"); // effectively no meaningful text
      doc.end();
      out.on("finish", () => resolve());
      out.on("error", reject);
    });
    await expect(extractMaterialText({ id: "m", type: "PDF", storagePath: `course-materials/${path.basename(filePath)}`, fileName: "scanned.pdf" })).rejects.toThrow(/no meaningful text/i);
  });
});

describe("extractMaterialsText", () => {
  it("extracts every material and keeps attribution", async () => {
    const pdf = await makePdf();
    const docx = await makeDocx();
    const results = await extractMaterialsText([
      { id: "mat-a", type: "PDF", storagePath: `course-materials/${path.basename(pdf)}`, fileName: "a.pdf" },
      { id: "mat-b", type: "WORD", storagePath: `course-materials/${path.basename(docx)}`, fileName: "b.docx" },
    ]);
    expect(results).toHaveLength(2);
    expect(results.find((r) => r.id === "mat-a")?.text).toContain("Introduction to TrainFlow");
    expect(results.find((r) => r.id === "mat-b")?.text).toContain("Word extractor reads");
  });

  it("fails fast with MaterialExtractionError when any material is unreadable", async () => {
    const pdf = await makePdf();
    await expect(
      extractMaterialsText([
        { id: "mat-a", type: "PDF", storagePath: `course-materials/${path.basename(pdf)}`, fileName: "a.pdf" },
        { id: "mat-b", type: "WORD", storagePath: "course-materials/does-not-exist-1234567890abcdef.docx", fileName: "gone.docx" },
      ]),
    ).rejects.toThrow(MaterialExtractionError);
  });
});
