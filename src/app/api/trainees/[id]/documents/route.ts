// /api/trainees/[id]/documents — multi-document management per trainee.
//
// Supports five document types (Iqama, ID, Passport, Certificate, OHS)
// plus an "other" catch-all. Files are stored on disk under
// public/uploads/trainee-docs/<random-hex>.<ext>; their metadata is appended
// to Trainee.documents as a JSON-encoded array.
//
//   POST   /api/trainees/[id]/documents
//     formData: file=..., type=iqama|id|passport|certificate|ohs|other
//     →  { url, filename, type, uploadedAt }
//
//   DELETE /api/trainees/[id]/documents?type=<type>&url=<url>
//     →  { ok: true }
import { NextRequest } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { ok, fail, withModuleAction, ApiError } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads", "trainee-docs");
const PUBLIC_PREFIX = "/uploads/trainee-docs";
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

const VALID_TYPES = ["iqama", "id", "passport", "certificate", "ohs", "other"] as const;
type DocType = (typeof VALID_TYPES)[number];

interface TraineeDocument {
  url: string;
  filename: string;
  type: DocType;
  uploadedAt: string;
  uploadedById?: string | null;
}

function parseDocuments(raw: string | null | undefined): TraineeDocument[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((d) => d && typeof d.url === "string" && typeof d.type === "string");
  } catch {
    return [];
  }
}

function stringifyDocuments(docs: TraineeDocument[]): string {
  return JSON.stringify(docs);
}

async function getOwnedTrainee(traineeId: string, user: { id: string; role: string; companyId?: string | null }) {
  const trainee = await db.trainee.findUnique({
    where: { id: traineeId },
    select: { id: true, companyId: true, fullName: true, deletedAt: true, documents: true },
  });
  if (!trainee || trainee.deletedAt) {
    throw new ApiError(404, "Trainee not found");
  }
  // Contractors can only manage their own trainees. SUPER_ADMIN / COORDINATOR / TRAINER
  // can manage any. VIEWER (auditor) is read-only and gets 403 via withModuleAction.
  if (user.role === "CONTRACTOR" && trainee.companyId !== user.companyId) {
    throw new ApiError(403, "You can only manage documents for your own trainees");
  }
  return trainee;
}

async function saveFile(file: File): Promise<{ url: string; filename: string; size: number; mime: string }> {
  const mime = file.type || "";
  const ext = ALLOWED[mime];
  if (!ext) {
    throw new ApiError(422, `Unsupported file type: ${mime || "unknown"}. Accepted: JPG, PNG, WebP, PDF.`);
  }
  if (file.size > MAX_BYTES) {
    throw new ApiError(422, `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 5 MB.`);
  }
  const buffer = Buffer.from(await file.arrayBuffer());
  const basename = `${crypto.randomBytes(16).toString("hex")}.${ext}`;
  const targetPath = path.join(UPLOAD_DIR, basename);
  try {
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await fs.writeFile(targetPath, buffer, { flag: "wx" });
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      throw new ApiError(409, "Upload conflict — please retry");
    }
    console.error("[trainee-documents] writeFile failed", e);
    throw new ApiError(500, "Could not save uploaded file");
  }
  return { url: `${PUBLIC_PREFIX}/${basename}`, filename: basename, size: file.size, mime };
}

export const POST = withModuleAction("trainees", "edit", async ({ req, user }) => {
  // req is NextRequest — pathname is /api/trainees/<id>/documents
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const traineeId = segments[2]!; // ["api","trainees","<id>","documents"]
  const trainee = await getOwnedTrainee(traineeId, user);

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  const type = String(formData?.get("type") || "other") as DocType;
  if (!VALID_TYPES.includes(type)) {
    return fail(`Invalid document type. Valid: ${VALID_TYPES.join(", ")}`, 422, "VALIDATION_ERROR");
  }
  if (!file || typeof file === "string") {
    return fail("No file uploaded", 422, "VALIDATION_ERROR");
  }

  const saved = await saveFile(file as File);

  const docs = parseDocuments(trainee.documents);
  // Enforce one document per type per trainee — replacing the old one if any.
  // (The user can still upload multiple "other" documents.)
  let removedOldUrl: string | null = null;
  const filtered =
    type === "other"
      ? docs
      : docs.filter((d) => {
          if (d.type === type) {
            removedOldUrl = d.url;
            return false;
          }
          return true;
        });
  const newDoc: TraineeDocument = {
    url: saved.url,
    filename: saved.filename,
    type,
    uploadedAt: new Date().toISOString(),
    uploadedById: user.id,
  };
  filtered.push(newDoc);

  await db.trainee.update({
    where: { id: trainee.id },
    data: { documents: stringifyDocuments(filtered), updatedAt: new Date() },
  });

  // Best-effort: delete the previous file of the same type to avoid orphaned uploads.
  if (removedOldUrl) {
    try {
      const oldPath = path.join(process.cwd(), "public", removedOldUrl);
      await fs.unlink(oldPath).catch(() => {});
    } catch {
      /* ignore */
    }
  }

  await recordAudit({
    userId: user.id,
    action: "UPDATE",
    entity: "TRAINEE",
    entityId: trainee.id,
    description: `Uploaded ${type} document for trainee ${trainee.fullName}`,
    newValue: { url: saved.url, type },
    req,
  });

  return ok(newDoc);
});

export const DELETE = withModuleAction("trainees", "edit", async ({ req, user }) => {
  const url = new URL(req.url);
  const segments = url.pathname.split("/").filter(Boolean);
  const traineeId = segments[2]!;
  const trainee = await getOwnedTrainee(traineeId, user);

  const type = url.searchParams.get("type") as DocType | null;
  const docUrl = url.searchParams.get("url");
  if (!type || !VALID_TYPES.includes(type) || !docUrl) {
    return fail("Both type and url query parameters are required", 422, "VALIDATION_ERROR");
  }

  const docs = parseDocuments(trainee.documents);
  const target = docs.find((d) => d.type === type && d.url === docUrl);
  if (!target) {
    return fail("Document not found", 404, "NOT_FOUND");
  }
  const filtered = docs.filter((d) => !(d.type === type && d.url === docUrl));

  await db.trainee.update({
    where: { id: trainee.id },
    data: { documents: stringifyDocuments(filtered), updatedAt: new Date() },
  });

  // Best-effort: remove the file from disk.
  try {
    const targetPath = path.join(process.cwd(), "public", docUrl);
    await fs.unlink(targetPath).catch(() => {});
  } catch {
    /* ignore */
  }

  await recordAudit({
    userId: user.id,
    action: "DELETE",
    entity: "TRAINEE",
    entityId: trainee.id,
    description: `Removed ${type} document for trainee ${trainee.fullName}`,
    oldValue: { url: docUrl, type },
    req,
  });

  return ok({ ok: true });
});
