// /api/trainees/upload-id — accepts a single ID / Iqama attachment (image or
// PDF) and stores it under public/uploads/trainee-ids/ with a random hex
// filename so the original (potentially non-ASCII or duplicate) name can't
// collide on disk or leak through the URL. Returns the public URL the client
// can store on the Trainee row (idAttachmentUrl) plus filename/size/mime for
// the UI to display.
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { withModuleAction, ok, fail } from "@/lib/auth/api";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "trainee-ids");
const PUBLIC_PREFIX = "/uploads/trainee-ids";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

// Extensions/MIME we accept — images of the ID card plus PDF scans. Anything
// else is rejected with VALIDATION_ERROR so the client can show a clear toast.
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
  // 16 random hex bytes → 32-char filename. Collisions are astronomically
  // unlikely, but we still race-check by using O_CREAT|O_EXCL via "wx".
  const basename = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  const targetPath = path.join(UPLOAD_DIR, basename);

  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(targetPath, buffer, { flag: "wx" });
  } catch (e) {
    // EEXIST → random hex collision; tell the client to retry. Anything else
    // is a real I/O problem (disk full, permissions) → 500.
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
