// /api/trainees/upload-id — upload an ID/Iqama attachment for a trainee.
// Accepts multipart/form-data with a single file field "file".
// Returns the URL path where the file is stored (served statically from /uploads/).
import { ok, fail, withAuth } from "@/lib/auth/api";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { randomBytes } from "crypto";

const UPLOAD_DIR = join(process.cwd(), "public", "uploads", "trainee-ids");
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export const POST = withAuth(async ({ req, user }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return fail("No file uploaded", 422, "VALIDATION_ERROR");
  }

  const fileBlob = file as File;
  if (fileBlob.size > MAX_FILE_SIZE) {
    return fail("File too large — maximum 5 MB", 422, "FILE_TOO_LARGE");
  }

  const mime = fileBlob.type;
  if (!ALLOWED_MIME.includes(mime)) {
    return fail(`Unsupported file type: ${mime}. Accepted: JPG, PNG, WebP, PDF`, 422, "INVALID_FILE_TYPE");
  }

  // Generate a unique filename
  const ext = mime === "application/pdf" ? "pdf" : mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
  const filename = `${randomBytes(8).toString("hex")}.${ext}`;
  const filepath = join(UPLOAD_DIR, filename);

  // Ensure upload directory exists
  await mkdir(UPLOAD_DIR, { recursive: true });

  // Write the file
  const buffer = Buffer.from(await fileBlob.arrayBuffer());
  await writeFile(filepath, buffer);

  // Return the public URL path
  const url = `/uploads/trainee-ids/${filename}`;

  return ok({ url, filename, size: fileBlob.size, mime });
});
