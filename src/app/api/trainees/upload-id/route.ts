// /api/trainees/upload-id — accepts a single ID / Iqama attachment (image or
// PDF) and uploads it to Cloudinary (signed upload, server-side only).
//
// If Cloudinary is not configured (no env vars), falls back to writing
// the file to public/uploads/trainee-docs/ on disk — preserving the old
// behavior for local development.
//
// The Cloudinary URL is a public CDN URL that works on desktop, mobile,
// and survives server restarts/redeploys. The old /api/uploads/ route
// continues to serve files that were uploaded to disk before the
// Cloudinary migration.
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { withModuleAction, ok, fail } from "@/lib/auth/api";
import { isCloudinaryConfigured, uploadToCloudinary } from "@/lib/cloudinary";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "trainee-docs");
const PUBLIC_PREFIX = "/api/uploads/trainee-docs";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

interface UploadIdResponse {
  url: string;
  filename: string;
  size: number;
  mime: string;
}

export const POST = withModuleAction("trainees", "edit", async ({ req }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return fail("No file uploaded", 422, "VALIDATION_ERROR");
  }

  const mime = file.type || "";
  const ext = ALLOWED[mime];
  if (!ext) {
    return fail(
      `Unsupported file type: ${mime || "unknown"}. Accepted: JPG, PNG, WebP, PDF.`,
      422,
      "VALIDATION_ERROR"
    );
  }

  if (file.size > MAX_BYTES) {
    return fail(
      `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum is 5 MB.`,
      422,
      "FILE_TOO_LARGE"
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // ── Cloudinary path (production) ──
  // If Cloudinary env vars are set, upload to Cloudinary for permanent storage.
  if (isCloudinaryConfigured()) {
    try {
      const result = await uploadToCloudinary(buffer, file.name, mime, "trainee-docs");
      const response: UploadIdResponse = {
        url: result.url,
        filename: file.name,
        size: result.size,
        mime,
      };
      return ok(response);
    } catch (e) {
      console.error("[upload-id] Cloudinary upload failed, falling back to disk", e);
      // Fall through to disk-based upload as a fallback
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
    console.error("[upload-id] writeFile failed", e);
    return fail("Could not save uploaded file", 500);
  }

  const response: UploadIdResponse = {
    url: `${PUBLIC_PREFIX}/${basename}`,
    filename: basename,
    size: file.size,
    mime,
  };

  return ok(response);
});
