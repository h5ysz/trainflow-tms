// /api/courses/[id]/materials/[materialId] — replace + delete a course material.
// =====================================================================
// PUT    — replace the stored file with a new upload (course-materials.edit —
//          Super Admin / Coordinator / Trainer for their own courses).
//          Writes the new file to disk, updates the row, then removes the old
//          file best-effort. The AI Question Generator reads storagePath from
//          the row, so replace keeps it pointing at the new file.
// DELETE — soft-delete the row and remove the stored file from disk
//          (course-materials.delete).
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, notFound, audit } from "@/lib/auth/api";
import { promises as fs } from "node:fs";
import path from "node:path";
import { classifyMaterialFile, saveMaterialFile, MaterialUploadError, ensureTrainerCanAccessCourse } from "@/lib/api/course-materials";
import { questionImagesDir } from "@/lib/ai/material-images";

// Best-effort removal of the stored file (tolerates already-deleted files).
async function removeStoredFile(storagePath: string | null): Promise<void> {
  if (!storagePath || storagePath.includes("..") || path.isAbsolute(storagePath)) return;
  try {
    await fs.unlink(path.join(process.cwd(), "public", "uploads", storagePath));
  } catch {
    // ignore — file already gone
  }
}

// Best-effort removal of the extracted question images for a material, so a
// replaced or deleted source file never serves stale figures.
async function removeQuestionImages(materialId: string): Promise<void> {
  try {
    await fs.rm(path.join(questionImagesDir(), materialId), { recursive: true, force: true });
  } catch {
    // ignore — nothing extracted yet
  }
}

function failOnUploadError(e: unknown): ReturnType<typeof fail> | null {
  if (e instanceof MaterialUploadError) return fail(e.message, 422, "VALIDATION_ERROR");
  if (e instanceof Error && /^(Unsupported file type|File too large|File is empty)/.test(e.message)) {
    return fail(e.message, 422, "VALIDATION_ERROR");
  }
  console.error("[course-materials] save failed", e);
  return fail("Could not save uploaded file", 500);
}

// PUT — replace the file
export const PUT = withModuleAction("course-materials", "edit", async ({ user, req, params }) => {
  const { id, materialId } = params as { id: string; materialId: string };

  const existing = await db.courseResource.findUnique({ where: { id: materialId } });
  if (!existing || existing.deletedAt || existing.courseId !== id) {
    return notFound("Material not found");
  }
  if (!(await ensureTrainerCanAccessCourse(user, id))) return notFound("Course not found");

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return fail("No file uploaded", 422, "VALIDATION_ERROR");
  }

  try {
    classifyMaterialFile(file as File);
  } catch (e) {
    const resp = failOnUploadError(e);
    if (resp) return resp;
  }

  let saved;
  try {
    saved = await saveMaterialFile(file as File);
  } catch (e) {
    const resp = failOnUploadError(e);
    if (resp) return resp;
  }
  if (!saved) return fail("Could not save uploaded file", 500);

  const customTitle = String(formData?.get("title") || "").trim();

  const updated = await db.courseResource.update({
    where: { id: materialId },
    data: {
      type: saved.type,
      title: customTitle || file.name,
      url: saved.url,
      fileName: file.name,
      fileSize: saved.size,
      fileMime: saved.mime,
      storagePath: saved.storagePath,
      updatedBy: user.id,
    },
  });

  // Remove the old stored file only after the row points at the new one.
  await removeStoredFile(existing.storagePath);
  // The new file is different content — drop any extracted figures of the old one.
  await removeQuestionImages(materialId);

  const course = await db.course.findUnique({ where: { id }, select: { code: true } });

  await audit({
    user,
    action: "UPDATE",
    entity: "COURSE",
    entityId: id,
    entityRef: course?.code,
    description: `Replaced course material "${file.name}" (${saved.type}) on course ${course?.code ?? id}`,
    descriptionAr: `استبدال مادة المنهج "${file.name}" (${saved.type}) في دورة ${course?.code ?? id}`,
    req,
    metadata: { materialId, type: saved.type, fileName: file.name, fileSize: saved.size, storagePath: saved.storagePath },
  });

  return ok(updated);
});

// DELETE — soft-delete + remove file
export const DELETE = withModuleAction("course-materials", "delete", async ({ user, req, params }) => {
  const { id, materialId } = params as { id: string; materialId: string };

  const existing = await db.courseResource.findUnique({ where: { id: materialId } });
  if (!existing || existing.deletedAt || existing.courseId !== id) {
    return notFound("Material not found");
  }
  if (!(await ensureTrainerCanAccessCourse(user, id))) return notFound("Course not found");

  await db.courseResource.update({
    where: { id: materialId },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });
  await removeStoredFile(existing.storagePath);
  await removeQuestionImages(materialId);

  const course = await db.course.findUnique({ where: { id }, select: { code: true } });

  await audit({
    user,
    action: "DELETE",
    entity: "COURSE",
    entityId: id,
    entityRef: course?.code,
    description: `Deleted course material "${existing.fileName ?? existing.title}" from course ${course?.code ?? id}`,
    descriptionAr: `حذف مادة المنهج "${existing.fileName ?? existing.title}" من دورة ${course?.code ?? id}`,
    req,
    metadata: { materialId, type: existing.type, fileName: existing.fileName, storagePath: existing.storagePath },
  });

  return ok({ success: true });
});
