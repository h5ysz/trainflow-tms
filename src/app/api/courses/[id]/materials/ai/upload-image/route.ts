// /api/courses/[id]/materials/ai/upload-image — upload a single image to attach
// to a question while reviewing AI-generated drafts.
// =====================================================================
//   POST (multipart: "file") → { url, filename, size, mime }
//
//   Uploads to Cloudinary (signed, server-side) when configured; otherwise
//   falls back to disk storage in public/uploads/question-images/ — the same
//   directory the material figure extractor uses — served by the existing
//   /api/uploads/[...path] route. The returned URL satisfies the generator's
//   imageUrl validation (/api/uploads/... or absolute http(s) link).
//
//   Only the trainer who can generate/approve questions for this course may
//   upload (course-materials.create + course access check) — identical RBAC to
//   the ai/generate and ai/approve endpoints.
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, notFound } from "@/lib/auth/api";
import { ensureTrainerCanAccessCourse } from "@/lib/api/course-materials";
import { isCloudinaryConfigured, uploadToCloudinary } from "@/lib/cloudinary";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "question-images");
const PUBLIC_PREFIX = "/api/uploads/question-images";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface UploadImageResponse {
  url: string;
  filename: string;
  size: number;
  mime: string;
}

export const POST = withModuleAction("course-materials", "create", async ({ req, user, params }) => {
  const courseId = params.id as string;
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course || course.deletedAt) return notFound("Course not found");
  if (!(await ensureTrainerCanAccessCourse(user, courseId))) return notFound("Course not found");

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return fail("No file uploaded", 422, "VALIDATION_ERROR");
  }

  const mime = file.type || "";
  const ext = ALLOWED[mime];
  if (!ext) {
    return fail(
      `Unsupported file type: ${mime || "unknown"}. Accepted: JPG, PNG, WebP.`,
      422,
      "VALIDATION_ERROR",
    );
  }

  if (file.size > MAX_BYTES) {
    return fail(
      `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum is 10 MB.`,
      422,
      "FILE_TOO_LARGE",
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // ── Cloudinary path (production) ──
  if (isCloudinaryConfigured()) {
    try {
      const result = await uploadToCloudinary(buffer, file.name, mime, "question-images");
      const response: UploadImageResponse = {
        url: result.url,
        filename: file.name,
        size: result.size,
        mime,
      };
      return ok(response);
    } catch (e) {
      console.error("[ai/upload-image] Cloudinary upload failed, falling back to disk", e);
      // Fall through to disk-based upload
    }
  }

  // ── Disk fallback (local dev or Cloudinary misconfigured) ──
  const basename = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  const targetPath = path.join(UPLOAD_DIR, basename);

  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(targetPath, buffer, { flag: "wx" });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      return fail("Upload conflict — please try again", 409, "UPLOAD_CONFLICT");
    }
    console.error("[ai/upload-image] writeFile failed", e);
    return fail("Could not save uploaded file", 500);
  }

  const response: UploadImageResponse = {
    url: `${PUBLIC_PREFIX}/${basename}`,
    filename: basename,
    size: file.size,
    mime,
  };

  return ok(response);
});
