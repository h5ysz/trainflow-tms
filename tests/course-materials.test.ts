// Unit tests for the shared course-materials module: upload classification rules
// (allowed types / empty / max size), the on-disk save helper, and the dedup
// guard that prevents re-uploading the same file from creating a duplicate
// CourseResource row + physical file. These rules are the contract the AI
// Question Generator relies on — every material row exposes storagePath pointing
// at the persisted file.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const tempDir = path.join(os.tmpdir(), `course-materials-test-${Date.now()}`);

beforeAll(async () => {
  process.env.COURSE_MATERIALS_DIR = tempDir;
  await fs.mkdir(tempDir, { recursive: true });
});

afterAll(async () => {
  delete process.env.COURSE_MATERIALS_DIR;
  await fs.rm(tempDir, { recursive: true, force: true });
});

const {
  classifyMaterialFile,
  saveMaterialFile,
  saveMaterialFileDedup,
  MaterialUploadError,
  COURSE_MATERIALS_MAX_BYTES,
  COURSE_MATERIALS_PREFIX,
} = await import("@/lib/api/course-materials");

describe("classifyMaterialFile", () => {
  it("maps pdf to PDF with application/pdf", () => {
    expect(classifyMaterialFile({ name: "manual.pdf", size: 1024 })).toMatchObject({
      ext: "pdf",
      type: "PDF",
      mime: "application/pdf",
    });
  });

  it("maps ppt/pptx to POWERPOINT", () => {
    expect(classifyMaterialFile({ name: "deck.ppt", size: 1024 }).type).toBe("POWERPOINT");
    expect(classifyMaterialFile({ name: "deck.pptx", size: 1024 }).type).toBe("POWERPOINT");
  });

  it("maps doc/docx to WORD", () => {
    expect(classifyMaterialFile({ name: "notes.doc", size: 1024 }).type).toBe("WORD");
    expect(classifyMaterialFile({ name: "notes.docx", size: 1024 }).type).toBe("WORD");
  });

  it("is case-insensitive on the extension", () => {
    expect(classifyMaterialFile({ name: "MANUAL.PDF", size: 1024 }).type).toBe("PDF");
  });

  it("rejects unsupported extensions", () => {
    expect(() => classifyMaterialFile({ name: "virus.exe", size: 1024 })).toThrow(MaterialUploadError);
    expect(() => classifyMaterialFile({ name: "readme.txt", size: 1024 })).toThrow(MaterialUploadError);
  });

  it("rejects files without an extension", () => {
    expect(() => classifyMaterialFile({ name: "noext", size: 1024 })).toThrow(MaterialUploadError);
  });

  it("rejects empty files", () => {
    expect(() => classifyMaterialFile({ name: "empty.pdf", size: 0 })).toThrow(/empty/i);
  });

  it("rejects files over the 20 MB limit", () => {
    expect(() =>
      classifyMaterialFile({ name: "big.pdf", size: COURSE_MATERIALS_MAX_BYTES + 1 }),
    ).toThrow(/too large/i);
  });
});

describe("saveMaterialFile", () => {
  it("writes a random-named file under course-materials and returns url + storagePath", async () => {
    const content = new Uint8Array([37, 80, 68, 70]);
    const file = new File([content], "manual.pdf", { type: "application/pdf" });
    const saved = await saveMaterialFile(file);

    const basename = saved.storagePath.replace("course-materials/", "");
    expect(basename).toMatch(/^[a-f0-9]{32}\.pdf$/);
    expect(saved.url).toBe(`${COURSE_MATERIALS_PREFIX}/${basename}`);
    expect(saved.storagePath).toBe(`course-materials/${basename}`);
    expect(saved.type).toBe("PDF");
    expect(saved.mime).toBe("application/pdf");
    expect(saved.size).toBe(4);

    const onDisk = await fs.readFile(path.join(tempDir, basename));
    expect(Buffer.from(onDisk)).toEqual(Buffer.from(content));
  });

  it("keeps the original file name out of the stored path (random basename only)", async () => {
    const file = new File([new Uint8Array([1])], "My Slides.pptx", { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    const saved = await saveMaterialFile(file);
    expect(saved.storagePath).toMatch(/^course-materials\/[a-f0-9]{32}\.pptx$/);
    expect(saved.storagePath).not.toContain("My Slides");
  });

  it("generates a unique basename per call (no collisions)", async () => {
    const a = await saveMaterialFile(new File([new Uint8Array([1])], "a.pdf", { type: "application/pdf" }));
    const b = await saveMaterialFile(new File([new Uint8Array([1])], "b.pdf", { type: "application/pdf" }));
    expect(a.storagePath).not.toBe(b.storagePath);
  });
});

describe("saveMaterialFileDedup (same file must never create duplicates)", () => {
  const courseId = "course-dedup-1";
  const asBytes = (b: number[]): Uint8Array<ArrayBuffer> => new Uint8Array(b);
  const pdfFile = (bytes: Uint8Array<ArrayBuffer>, name = "manual.pdf") => new File([bytes], name, { type: "application/pdf" });

  // A fake db that answers the dedup lookup from an in-memory list of existing
  // materials (same shape the real Prisma query returns).
  function fakeDb(existing: Array<{ id: string; storagePath: string | null }>) {
    return {
      courseResource: {
        findMany: vi.fn(async (_args: { where: Record<string, unknown>; select: Record<string, true> }) => existing),
      },
    };
  }

  it("writes a new file and returns duplicate:false when no identical material exists", async () => {
    const dbMock = fakeDb([]);
    const content = asBytes([37, 80, 68, 70]);
    const res = await saveMaterialFileDedup(courseId, pdfFile(content), { db: dbMock });

    expect(res.duplicate).toBe(false);
    if (!res.duplicate) {
      const basename = res.saved.storagePath.replace("course-materials/", "");
      const onDisk = await fs.readFile(path.join(tempDir, basename));
      expect(Buffer.from(onDisk)).toEqual(Buffer.from(content));
      expect(res.saved.type).toBe("PDF");
    }
    expect(dbMock.courseResource.findMany).toHaveBeenCalledTimes(1);
  });

  it("returns duplicate:true and writes NO new file when an identical material already exists", async () => {
    // Pre-seed an existing material whose stored file has the same bytes.
    const content = asBytes([37, 80, 68, 70, 1, 2, 3]);
    const existingName = "seed-existing.pdf";
    await fs.writeFile(path.join(tempDir, existingName), Buffer.from(content));
    const dbMock = fakeDb([{ id: "existing-id", storagePath: `course-materials/${existingName}` }]);

    const filesBefore = (await fs.readdir(tempDir)).length;
    const res = await saveMaterialFileDedup(courseId, pdfFile(content), { db: dbMock });

    expect(res.duplicate).toBe(true);
    if (res.duplicate) expect(res.materialId).toBe("existing-id");
    expect((await fs.readdir(tempDir)).length).toBe(filesBefore);
  });

  it("treats same name + size but different content as a NEW upload", async () => {
    const existingBytes = asBytes([1, 2, 3]);
    const existingName = "seed-different.pdf";
    await fs.writeFile(path.join(tempDir, existingName), Buffer.from(existingBytes));
    const dbMock = fakeDb([{ id: "existing-id", storagePath: `course-materials/${existingName}` }]);

    // Same name + same size (3 bytes), but different bytes → must NOT dedup.
    const res = await saveMaterialFileDedup(courseId, pdfFile(asBytes([4, 5, 6])), { db: dbMock });

    expect(res.duplicate).toBe(false);
  });

  it("queries with the exact courseId/fileName/fileSize + active filter (no accidental cross-course dedup)", async () => {
    const content = asBytes([37, 80, 68, 70]);
    const dbMock = fakeDb([]);
    await saveMaterialFileDedup(courseId, pdfFile(content, "javascript-training.pdf"), { db: dbMock });

    const args = dbMock.courseResource.findMany.mock.calls[0]?.[0];
    expect(args).toBeDefined();
    expect(args?.where).toMatchObject({
      courseId,
      fileName: "javascript-training.pdf",
      fileSize: content.length,
      deletedAt: null,
      isActive: true,
    });
  });
});
