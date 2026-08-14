// Course material upload rules + storage helper (shared by the upload route and
// the replace route). Centralising this keeps the two route files in sync and
// gives the future AI Question Generator a single contract to read back files:
// every uploaded material row stores `storagePath` = "course-materials/<file>",
// which resolves to public/uploads/course-materials/<file> on disk.
import path from "node:path";
import crypto from "node:crypto";
import { promises as fs } from "node:fs";
import { db } from "@/lib/db";
import { isTestTrainer } from "@/lib/api/trainer-scope";

export function courseMaterialsDir(): string {
  return process.env.COURSE_MATERIALS_DIR || path.join(process.cwd(), "public", "uploads", "course-materials");
}
export const COURSE_MATERIALS_PREFIX = "/api/uploads/course-materials";
export const COURSE_MATERIALS_MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export const ALLOWED_MATERIAL_EXT: Record<string, { type: string; mime: string }> = {
  pdf: { type: "PDF", mime: "application/pdf" },
  ppt: { type: "POWERPOINT", mime: "application/vnd.ms-powerpoint" },
  pptx: { type: "POWERPOINT", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  doc: { type: "WORD", mime: "application/msword" },
  docx: { type: "WORD", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
};

export const MATERIAL_TYPES = ["PDF", "POWERPOINT", "WORD"] as const;

// A trainer may only view/manage materials of courses linked to at least one of
// their own sessions. The QA Test Trainer is exempt (test-wide scope). Mirrors
// the guard on GET /api/courses/[id].
export async function ensureTrainerCanAccessCourse(
  user: { role: string; trainerId?: string | null },
  courseId: string,
): Promise<boolean> {
  if (user.role === "TRAINER" && user.trainerId && !isTestTrainer(user as never)) {
    const linked = await db.trainingSession.count({
      where: { courseId, trainerId: user.trainerId, deletedAt: null },
    });
    return linked > 0;
  }
  return true;
}

export class MaterialUploadError extends Error {}

/**
 * Resolve the extension → { type, mime } mapping for an uploaded file.
 * Throws MaterialUploadError for unsupported / empty / oversized files, so the
 * route can translate it into a 422 while real I/O errors bubble up as 500s.
 */
export function classifyMaterialFile(file: { name?: string; size?: number }): { ext: string; type: string; mime: string } {
  const name = file.name || "file";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const allowed = ALLOWED_MATERIAL_EXT[ext];
  if (!allowed) {
    throw new MaterialUploadError(`Unsupported file type: ${ext || "unknown"}. Accepted: ${Object.keys(ALLOWED_MATERIAL_EXT).join(", ")}.`);
  }
  if (!file.size || file.size <= 0) throw new MaterialUploadError("File is empty");
  if (file.size > COURSE_MATERIALS_MAX_BYTES) {
    throw new MaterialUploadError(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 20 MB.`);
  }
  return { ext, type: allowed.type, mime: allowed.mime };
}

export interface SavedMaterialFile {
  url: string;
  storagePath: string;
  type: string;
  size: number;
  mime: string;
}

export type SaveMaterialFileResult =
  | { duplicate: true; materialId: string }
  | { duplicate: false; saved: SavedMaterialFile };

function sha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Resolve a stored storagePath ("course-materials/<basename>") to an on-disk
 * path under the configured course-materials dir. Returns null when the path
 * tries to escape the dir (defense-in-depth against crafted storagePaths).
 */
function safeStorageFilePath(storagePath: string): string | null {
  if (!storagePath || storagePath.includes("..") || path.isAbsolute(storagePath)) return null;
  const basename = storagePath.replace(/^course-materials[/\\]/, "");
  if (!basename || basename.includes("..") || path.isAbsolute(basename)) return null;
  return path.join(courseMaterialsDir(), basename);
}

async function writeMaterialBuffer(buffer: Buffer, ext: string, mime: string, size: number): Promise<SavedMaterialFile> {
  const basename = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  const targetPath = path.join(courseMaterialsDir(), basename);
  await fs.mkdir(courseMaterialsDir(), { recursive: true });
  await fs.writeFile(targetPath, buffer, { flag: "wx" });
  return {
    url: `${COURSE_MATERIALS_PREFIX}/${basename}`,
    storagePath: `course-materials/${basename}`,
    type: ALLOWED_MATERIAL_EXT[ext].type,
    size,
    mime,
  };
}

/**
 * Persist a file under public/uploads/course-materials/ with a random name.
 * Returns the public URL, the on-disk relative storagePath (for the AI Question
 * Generator), and the classification metadata.
 */
export async function saveMaterialFile(file: File): Promise<SavedMaterialFile> {
  const { ext, mime } = classifyMaterialFile(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  return writeMaterialBuffer(buffer, ext, file.type || mime, file.size);
}

/**
 * Find an existing active uploaded material in the same course whose stored
 * file is byte-for-byte identical to `buffer` (same file name + size + content
 * hash). This is the dedup guard: re-uploading the same file must never create
 * a second CourseResource row nor a second physical file.
 *
 * `deps.db` is injectable for tests; it defaults to the real Prisma client.
 * Best-effort: any candidate whose stored file is missing/corrupt is skipped
 * rather than treated as a match.
 */
export async function findExistingMaterialByContent(
  courseId: string,
  file: { name?: string; size?: number },
  buffer: Buffer,
  deps: { db?: unknown } = {},
): Promise<{ id: string } | null> {
  if (!file.name || !file.size) return null;
  const client = (deps.db ?? db) as {
    courseResource: {
      findMany: (args: {
        where: {
          courseId: string;
          deletedAt: null;
          isActive: boolean;
          fileName: string;
          fileSize: number;
        };
        select: { id: true; storagePath: true };
      }) => Promise<Array<{ id: string; storagePath: string | null }>>;
    };
  };
  const candidates = await client.courseResource.findMany({
    where: {
      courseId,
      deletedAt: null,
      isActive: true,
      fileName: file.name,
      fileSize: file.size,
    },
    select: { id: true, storagePath: true },
  });
  if (candidates.length === 0) return null;

  const hash = sha256(buffer);
  for (const candidate of candidates) {
    if (!candidate.storagePath) continue;
    const p = safeStorageFilePath(candidate.storagePath);
    if (!p) continue;
    try {
      const existing = await fs.readFile(p);
      if (sha256(existing) === hash) return { id: candidate.id };
    } catch {
      /* stored file missing/unreadable → not a match */
    }
  }
  return null;
}

/**
 * Dedup-aware save for the upload route (POST /courses/[id]/materials).
 *
 * Policy: if an active material in this course already stores the SAME file
 * (same name + size + content hash), the upload is a no-op — no new row, no new
 * physical file. Only genuinely new files are persisted.
 */
export async function saveMaterialFileDedup(
  courseId: string,
  file: File,
  deps: { db?: unknown } = {},
): Promise<SaveMaterialFileResult> {
  const { ext, mime } = classifyMaterialFile(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  const existing = await findExistingMaterialByContent(courseId, file, buffer, deps);
  if (existing) return { duplicate: true, materialId: existing.id };
  const saved = await writeMaterialBuffer(buffer, ext, file.type || mime, file.size);
  return { duplicate: false, saved };
}
