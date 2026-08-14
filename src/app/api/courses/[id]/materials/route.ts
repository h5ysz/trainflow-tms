// /api/courses/[id]/materials — list + upload course material files.
// =====================================================================
// Phase 1: uploaded course materials (PDF, PowerPoint, Word). Each file is
// stored permanently on disk under public/uploads/course-materials/ and served
// through the authenticated /api/uploads/... proxy. The CourseResource row
// keeps fileName/fileSize/fileMime plus the on-disk `storagePath` so the
// future AI Question Generator can read the file content back for question
// extraction without re-uploading.
//
//   GET   — list uploaded materials for a course (any authenticated user;
//           trainers are scoped to the courses they run)
//   POST  — upload a file (course-materials.create — Super Admin / Coordinator
//           / Trainer for their own courses)
//     formData: file=..., title=<optional display name>
//
// POST dedup policy: re-uploading the SAME file (same name + size + content
// hash) as an existing ACTIVE material in this course is a no-op — it returns
// the existing material instead of creating a second CourseResource row or a
// second physical file. Only genuinely new files are persisted.
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, notFound, audit } from "@/lib/auth/api";
import {
  classifyMaterialFile,
  saveMaterialFile,
  saveMaterialFileDedup,
  MaterialUploadError,
  ensureTrainerCanAccessCourse,
  type SaveMaterialFileResult,
} from "@/lib/api/course-materials";

// Maps a thrown upload error to a 422 response; anything else is a 500.
function failOnUploadError(e: unknown): ReturnType<typeof fail> | null {
  if (e instanceof MaterialUploadError) return fail(e.message, 422, "VALIDATION_ERROR");
  if (e instanceof Error && /^(Unsupported file type|File too large|File is empty)/.test(e.message)) {
    return fail(e.message, 422, "VALIDATION_ERROR");
  }
  console.error("[course-materials] save failed", e);
  return fail("Could not save uploaded file", 500);
}

// GET — list uploaded materials for a course
export const GET = withModuleAction("courses", "view", async ({ user, params }) => {
  const id = params.id as string;
  const course = await db.course.findUnique({ where: { id } });
  if (!course || course.deletedAt) return notFound("Course not found");
  if (!(await ensureTrainerCanAccessCourse(user, id))) return notFound("Course not found");

  const materials = await db.courseResource.findMany({
    where: { courseId: id, deletedAt: null, isActive: true, fileName: { not: null } },
    orderBy: [{ order: "asc" }, { createdAt: "desc" }],
  });

  return ok(materials);
});

// POST — upload a material file (course-materials.create)
export const POST = withModuleAction("course-materials", "create", async ({ user, req, params }) => {
  const id = params.id as string;
  const course = await db.course.findUnique({ where: { id } });
  if (!course || course.deletedAt) return notFound("Course not found");
  if (!(await ensureTrainerCanAccessCourse(user, id))) return notFound("Course not found");

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return fail("No file uploaded", 422, "VALIDATION_ERROR");
  }

  // Validate before touching the disk: unsupported type / empty / too large → 422.
  try {
    classifyMaterialFile(file as File);
  } catch (e) {
    const resp = failOnUploadError(e);
    if (resp) return resp;
  }

  let result: SaveMaterialFileResult | undefined;
  try {
    result = await saveMaterialFileDedup(id, file as File);
  } catch (e) {
    const resp = failOnUploadError(e);
    if (resp) return resp;
  }
  if (!result) return fail("Could not save uploaded file", 500);

  // Same file already uploaded to this course → idempotent no-op. Return the
  // existing material (200), never create a second row or a second file.
  if (result.duplicate) {
    const existing = await db.courseResource.findUnique({ where: { id: result.materialId } });
    if (existing && !existing.deletedAt && existing.courseId === id) {
      await audit({
        user,
        action: "CREATE",
        entity: "COURSE",
        entityId: id,
        entityRef: course.code,
        description: `Ignored duplicate upload of "${file.name}" — same file already uploaded to course ${course.code}`,
        descriptionAr: `تجاهل رفع مكرر لـ "${file.name}" — الملف نفسه مرفوع مسبقاً لدورة ${course.code}`,
        req,
        metadata: { materialId: existing.id, fileName: file.name, fileSize: file.size, duplicate: true },
      });
      return ok(existing);
    }
    // The matched row vanished (deleted concurrently) — fall through and persist.
    try {
      result = { duplicate: false, saved: await saveMaterialFile(file as File) };
    } catch (e) {
      const resp = failOnUploadError(e);
      if (resp) return resp;
    }
    if (result.duplicate) return fail("Could not save uploaded file", 500);
  }
  const saved = result.saved;

  const customTitle = String(formData?.get("title") || "").trim();

  const material = await db.courseResource.create({
    data: {
      courseId: id,
      type: saved.type,
      title: customTitle || file.name,
      url: saved.url,
      fileName: file.name,
      fileSize: saved.size,
      fileMime: saved.mime,
      storagePath: saved.storagePath,
      order: 0,
      isActive: true,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "COURSE",
    entityId: id,
    entityRef: course.code,
    description: `Uploaded course material "${file.name}" (${saved.type}) to course ${course.code}`,
    descriptionAr: `رفع مادة المنهج "${file.name}" (${saved.type}) إلى دورة ${course.code}`,
    req,
    metadata: { materialId: material.id, type: saved.type, fileName: file.name, fileSize: saved.size, storagePath: saved.storagePath },
  });

  return created(material);
});
