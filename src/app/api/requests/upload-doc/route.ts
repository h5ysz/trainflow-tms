// /api/requests/upload-doc — upload a single request-level additional document
// (medical certificate, vaccination, work permit, company letter, etc.).
//
// Uploads to Cloudinary (signed, server-side) when configured.
// Falls back to disk storage (public/uploads/request-docs/) when Cloudinary
// env vars are not set — preserving old behavior for local dev.
//
// Old files on disk continue to be served by /api/uploads/[...path].
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { ok, fail, withModuleAction } from "@/lib/auth/api";
import { isCloudinaryConfigured, uploadToCloudinary } from "@/lib/cloudinary";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "request-docs");
const PUBLIC_PREFIX = "/api/uploads/request-docs";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB — additional docs are often multi-page PDFs

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export const POST = withModuleAction("requests", "create", async ({ req, user }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return fail("No file uploaded", 422, "VALIDATION_ERROR");
  }

  const f = file as File;
  const mime = f.type || "";
  const ext = ALLOWED[mime];
  if (!ext) {
    return fail(
      `Unsupported file type: ${mime || "unknown"}. Accepted: PDF, JPG, JPEG, PNG.`,
      422,
      "VALIDATION_ERROR",
    );
  }

  if (f.size > MAX_BYTES) {
    return fail(
      `File is too large (${(f.size / 1024 / 1024).toFixed(1)} MB). Maximum is 10 MB.`,
      422,
      "FILE_TOO_LARGE",
    );
  }

  const buffer = Buffer.from(await f.arrayBuffer());

  // ── Cloudinary path (production) ──
  if (isCloudinaryConfigured()) {
    try {
      const result = await uploadToCloudinary(buffer, f.name || "document", mime, "request-docs");
      return ok({
        url: result.url,
        filename: f.name || "document",
        originalName: f.name || "document",
        type: mime,
        size: result.size,
        uploadedAt: new Date().toISOString(),
        uploadedById: user.id,
      });
    } catch (e) {
      console.error("[requests/upload-doc] Cloudinary upload failed, falling back to disk", e);
      // Fall through to disk-based upload
    }
  }

  // ── Disk fallback ──
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
    console.error("[requests/upload-doc] writeFile failed", e);
    return fail("Could not save uploaded file", 500);
  }

  return ok({
    url: `${PUBLIC_PREFIX}/${basename}`,
    filename: basename,
    originalName: f.name || basename,
    type: mime,
    size: f.size,
    uploadedAt: new Date().toISOString(),
    uploadedById: user.id,
  });
});
