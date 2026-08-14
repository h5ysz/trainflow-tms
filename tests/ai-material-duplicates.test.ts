// Regression tests: the AI question pipeline must NEVER create course materials.
// =====================================================================
// A trainer who uploads a file once then Generate / Regenerate / Preview /
// Approve questions must never end up with duplicate CourseResource rows.
//
// Guarded behaviour:
//   1. Uploading the SAME file twice ط£آ¢أ¢â‚¬آ أ¢â‚¬â„¢ one row + one physical file only
//      (the second upload is an idempotent no-op returning the existing row).
//   2. Generate / Preview / Regenerate (POST ai/generate) ط£آ¢أ¢â‚¬آ أ¢â‚¬â„¢ zero CourseResource
//      creates; drafts reference the EXISTING materialId.
//   3. Approve (POST ai/approve) ط£آ¢أ¢â‚¬آ أ¢â‚¬â„¢ zero CourseResource creates (only Question
//      bank rows are written).
//
// The DB is mocked in-memory; the generate path still runs the REAL extractor +
// the offline Mock AI provider against a REAL pdfkit-built PDF.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { promises as fs } from "node:fs";
import fsStream from "node:fs";
import path from "node:path";
import os from "node:os";
import PDFDocument from "pdfkit";

const tempDir = path.join(os.tmpdir(), `ai-material-dupes-${Date.now()}`);
const materialsDir = path.join(tempDir, "course-materials");

const COURSE_ID = "course-dup-1";
const MATERIAL_ID = "material-dup-1";
const COURSE = { id: COURSE_ID, title: "JavaScript Training", code: "JS-101", deletedAt: null };

const h = vi.hoisted(() => {
  const makeRow = (data: Record<string, unknown>, seq: number) => ({
    id: `new-${seq}`,
    order: 0,
    isActive: true,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...data,
  });
  return {
    store: {
      materials: [] as Array<ReturnType<typeof makeRow> & Record<string, unknown>>,
      createdMaterials: [] as unknown[],
      questionCreates: [] as unknown[],
    },
    FAKE_USER: { id: "u-1", role: "SUPER_ADMIN", permissions: ["*"] },
    makeRow,
  };
});

vi.mock("@/lib/db", () => {
  const matchWhere = (row: Record<string, unknown>, where: Record<string, unknown>): boolean => {
    if (where.courseId !== undefined && row.courseId !== where.courseId) return false;
    if (where.deletedAt !== undefined && row.deletedAt !== where.deletedAt) return false;
    if (where.isActive !== undefined && row.isActive !== where.isActive) return false;
    if (where.fileName !== undefined) {
      const f = where.fileName as unknown;
      if (f !== null && typeof f === "object") {
        const not = (f as { not?: unknown }).not;
        if (not !== undefined && row.fileName === not) return false;
      } else if (row.fileName !== f) {
        return false;
      }
    }
    if (where.fileSize !== undefined && row.fileSize !== where.fileSize) return false;
    if (where.id !== undefined) {
      const w = where.id as { in?: unknown[] } | string;
      if (typeof w === "string" && row.id !== w) return false;
      const inList = (w as { in?: unknown[] }).in;
      if (w && !Array.isArray(w) && Array.isArray(inList) && !inList.includes(row.id)) return false;
    }
    return true;
  };

  return {
    db: {
      course: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          where.id === COURSE_ID ? COURSE : null,
        ),
      },
      courseResource: {
        findMany: vi.fn(async ({ where = {}, select }: { where?: Record<string, unknown>; select?: Record<string, true> }) => {
          let rows = h.store.materials.filter((m) => matchWhere(m as Record<string, unknown>, where));
          if (select) rows = rows.map((r) => Object.fromEntries(Object.keys(select).map((k) => [k, (r as Record<string, unknown>)[k]]))) as typeof rows;
          return rows;
        }),
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
          h.store.materials.find((m) => m.id === where.id) ?? null,
        ),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const row = h.makeRow(data, h.store.createdMaterials.length + 1);
          h.store.materials.push(row);
          h.store.createdMaterials.push(row);
          return row;
        }),
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => data),
        delete: vi.fn(async () => ({ success: true })),
      },
      trainingSession: { count: vi.fn(async () => 1) },
      question: {
        findMany: vi.fn(async () => []),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          h.store.questionCreates.push(data);
          return { id: `q-${h.store.questionCreates.length}`, ...data };
        }),
      },
      role: { findUnique: vi.fn(async () => ({ permissions: ["*"] })) },
      user: { findUnique: vi.fn(async () => null) },
      auditLog: { create: vi.fn(async () => ({})) },
      $transaction: vi.fn(async (items: Array<Promise<unknown>>) => Promise.all(items)),
    },
  };
});

vi.mock("@/lib/auth/api", async () => {
  const { ok, created, fail, notFound } = await import("@/lib/api/response");
  return {
    withModuleAction: (_module: string, _action: string, handler: (ctx: unknown) => Promise<unknown>) =>
      async (req: Request, ctx: { params?: unknown } = {}) => {
        const raw = ctx.params ?? {};
        const params = raw instanceof Promise ? await raw : raw;
        return handler({ user: h.FAKE_USER, req, params }) as unknown as Response;
      },
    audit: vi.fn(async () => {}),
    ok,
    created,
    fail,
    notFound,
  };
});

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

const { _resetProviderCache } = await import("@/lib/ai/provider");
const { _resetDraftMemory } = await import("@/lib/ai/draft-memory");
const { db } = await import("@/lib/db");
const { POST: uploadPost } = await import("@/app/api/courses/[id]/materials/route");
const { POST: generatePost } = await import("@/app/api/courses/[id]/materials/ai/generate/route");
const { POST: approvePost } = await import("@/app/api/courses/[id]/materials/ai/approve/route");

async function makePdf(): Promise<string> {
  const filePath = path.join(materialsDir, `${Math.random().toString(16).slice(2)}.pdf`);
  await new Promise<void>((resolve, reject) => {
    const doc = new PDFDocument();
    const out = fsStream.createWriteStream(filePath);
    doc.pipe(out);
    doc.fontSize(14).text("JavaScript training covers variables, functions and event handling.");
    doc.moveDown();
    doc.text("Arrays store ordered lists of values. Functions are reusable blocks of code.");
    doc.text("The document object model allows scripts to update page content dynamically.");
    doc.end();
    out.on("finish", () => resolve());
    out.on("error", reject);
  });
  return filePath;
}

async function seedMaterial(): Promise<{ filePath: string; bytes: Buffer }> {
  const filePath = await makePdf();
  const bytes = await fs.readFile(filePath);
  h.store.materials.push(
    h.makeRow(
      {
        courseId: COURSE_ID,
        type: "PDF",
        title: "JavaScript Training (E2E)",
        url: `/api/uploads/course-materials/${path.basename(filePath)}`,
        fileName: "javascript-training.pdf",
        fileSize: bytes.length,
        fileMime: "application/pdf",
        storagePath: `course-materials/${path.basename(filePath)}`,
        createdBy: h.FAKE_USER.id,
        updatedBy: h.FAKE_USER.id,
      },
      -1,
    ),
  );
  // Fix the seeded id ط£آ¢أ¢â€ڑآ¬أ¢â‚¬â€Œ findMany/create use real ids below.
  const row = h.store.materials[h.store.materials.length - 1];
  row.id = MATERIAL_ID;
  return { filePath, bytes };
}

function resetStore() {
  h.store.materials.length = 0;
  h.store.createdMaterials.length = 0;
  h.store.questionCreates.length = 0;
  vi.clearAllMocks();
}

function uploadRequest(file: File): Request {
  const fd = new FormData();
  fd.append("file", file);
  return new Request("http://localhost", { method: "POST", body: fd });
}

function jsonPost(body: unknown): Request {
  return new Request("http://localhost", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

type RouteCtx = {
  params?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>;
};

async function call(handler: (req: Request, ctx?: RouteCtx) => Promise<Response>, req: Request) {
  return handler(req, { params: { id: COURSE_ID } });
}

describe("Upload dedup ط£آ¢أ¢â€ڑآ¬أ¢â‚¬â€Œ same file uploaded twice creates ONE material", () => {
  it("second upload of the identical file is an idempotent no-op (no second row, no second file)", async () => {
    resetStore();
    const { bytes } = await seedMaterial();
    // The seeded row is a DIFFERENT file (different storage) ط£آ¢أ¢â€ڑآ¬أ¢â‚¬â€Œ first upload must persist.
    const uploadBytes = Buffer.from([37, 80, 68, 70, 9, 9, 9, 9, 9, 9, 9, 9, 9]);
    const file = new File([uploadBytes], "javascript-training.pdf", { type: "application/pdf" });

    const r1 = await call(uploadPost, uploadRequest(file));
    const j1 = await r1.json();
    expect(r1.status).toBe(201);
    expect(h.store.createdMaterials.length).toBe(1);

    const r2 = await call(uploadPost, uploadRequest(new File([uploadBytes], "javascript-training.pdf", { type: "application/pdf" })));
    const j2 = await r2.json();
    expect(r2.status).toBe(200); // returned existing, not created
    expect(h.store.createdMaterials.length).toBe(1); // still only one row
    expect(j2.data.id).toBe(j1.data.id);
    expect(vi.mocked(db.courseResource.create).mock.calls.length).toBe(1);

    // Only ONE physical file was written for the upload (the seeded material has its own file).
    const uploaded = h.store.materials.filter((m) => m.id === j1.data.id);
    expect(uploaded).toHaveLength(1);
  });

  it("uploading a genuinely different file still creates a new material", async () => {
    resetStore();
    await seedMaterial();
    const file = new File([new Uint8Array([1, 2, 3, 4])], "another-notes.pdf", { type: "application/pdf" });
    const r = await call(uploadPost, uploadRequest(file));
    expect(r.status).toBe(201);
    expect(h.store.createdMaterials.length).toBe(1);
  });
});

describe("Generate / Preview / Regenerate never create course materials", () => {
  beforeEach(async () => {
    resetStore();
    _resetProviderCache();
    _resetDraftMemory();
    await seedMaterial();
  });

  it("Generate (draft preview) returns questions but creates ZERO CourseResource", async () => {
    const res = await call(generatePost, jsonPost({ materialIds: [MATERIAL_ID], count: 3, testType: "PRE_TEST" }));
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.questions.length).toBeGreaterThan(0);
    expect(vi.mocked(db.courseResource.create).mock.calls.length).toBe(0);
    expect(h.store.createdMaterials.length).toBe(0);
  });

  it("Regenerate (a second Generate call) still creates ZERO CourseResource", async () => {
    await call(generatePost, jsonPost({ materialIds: [MATERIAL_ID], count: 2, testType: "PRE_TEST" }));
    await call(generatePost, jsonPost({ materialIds: [MATERIAL_ID], count: 2, testType: "PRE_TEST" }));
    expect(vi.mocked(db.courseResource.create).mock.calls.length).toBe(0);
    expect(h.store.createdMaterials.length).toBe(0);
  });

  it("generated drafts reference the EXISTING materialId ط£آ¢أ¢â€ڑآ¬أ¢â‚¬â€Œ never a new one", async () => {
    const res = await call(generatePost, jsonPost({ materialIds: [MATERIAL_ID], count: 3, testType: "PRE_TEST" }));
    const json = await res.json();
    for (const q of json.data.questions as Array<{ materialId: string }>) {
      expect(q.materialId).toBe(MATERIAL_ID);
    }
  });

  it("unknown materialIds fail the request WITHOUT creating anything", async () => {
    const res = await call(generatePost, jsonPost({ materialIds: ["does-not-exist"], count: 2, testType: "PRE_TEST" }));
    expect(res.status).toBe(422);
    expect(vi.mocked(db.courseResource.create).mock.calls.length).toBe(0);
  });
});

describe("Approve never creates course materials (only Question bank rows)", () => {
  beforeEach(async () => {
    resetStore();
    _resetProviderCache();
    _resetDraftMemory();
    await seedMaterial();
  });

  it("approving a generated draft writes a Question but ZERO CourseResource", async () => {
    // Generate a real draft, then approve it ط£آ¢أ¢â€ڑآ¬أ¢â‚¬â€Œ the exact UI flow.
    const genRes = await call(generatePost, jsonPost({ materialIds: [MATERIAL_ID], count: 2, testType: "PRE_TEST" }));
    const genJson = await genRes.json();
    const draft = genJson.data.questions[0];

    const res = await call(
      approvePost,
      jsonPost({ questions: [draft], testType: "PRE_TEST", aiModel: "mock-bilingual-generator", aiPrompt: null }),
    );
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.data.count).toBe(1);
    expect(h.store.questionCreates.length).toBe(1);
    expect(vi.mocked(db.courseResource.create).mock.calls.length).toBe(0);
    expect(h.store.createdMaterials.length).toBe(0);
  });
});
