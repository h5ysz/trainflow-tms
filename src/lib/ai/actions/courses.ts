// GCCLAB AI Copilot — Phase 2 — COURSES actions
// =====================================================================
// create / edit / archive — uses Prisma directly, mirrors the existing
// /api/courses endpoint's create + update logic without modifying it.
import { db } from "@/lib/db";
import { nextRefNumber } from "@/lib/api/ref-number";
import type { ActionHandler } from "./types";
import { ActionError } from "./types";
import { copilotAudit } from "./audit";

// ─── Helpers ──────────────────────────────────────────────────────────────
interface CourseInput {
  code?: string;
  title?: string;
  titleAr?: string;
  description?: string;
  category?: string;
  durationHours?: number;
  language?: string;
  validityMonths?: number;
  passScore?: number;
  maxTrainees?: number;
  hasPreTest?: boolean;
  hasFinalTest?: boolean;
  hasEvaluation?: boolean;
  status?: string;
}

function pickCourseFields(input: CourseInput) {
  return {
    code: input.code,
    title: input.title,
    titleAr: input.titleAr ?? null,
    description: input.description ?? null,
    category: input.category ?? null,
    durationHours: input.durationHours ?? 8,
    language: input.language ?? "en",
    validityMonths: input.validityMonths ?? 12,
    passScore: input.passScore ?? 70,
    maxTrainees: input.maxTrainees ?? 20,
    hasPreTest: input.hasPreTest ?? true,
    hasFinalTest: input.hasFinalTest ?? true,
    hasEvaluation: input.hasEvaluation ?? true,
    status: input.status ?? "ACTIVE",
  };
}

// ─── COURSE_CREATE ────────────────────────────────────────────────────────
const createCourse: ActionHandler<CourseInput> = {
  type: "COURSE_CREATE",
  category: "COURSES",
  description: "Create a new course with code, title, category, duration, etc.",
  descriptionAr: "إنشاء دورة جديدة برمز وعنوان وفئة ومدة، إلخ.",
  resolvePermission: () => ({ module: "courses", action: "create" }),
  async preparePreview(input, _user) {
    if (!input.code || !input.title) {
      throw new ActionError("Course code and title are required", 422, "VALIDATION_ERROR");
    }
    const dup = await db.course.findFirst({ where: { code: input.code, deletedAt: null } });
    if (dup) {
      throw new ActionError(
        `Course code "${input.code}" already exists (${dup.refNumber})`,
        400,
        "DUPLICATE_CODE"
      );
    }
    const fields = pickCourseFields(input);
    return {
      actionType: "COURSE_CREATE",
      title: "Create Course",
      titleAr: "إنشاء دورة",
      summary: `Create course "${fields.title}" with code ${fields.code}.`,
      summaryAr: `إنشاء دورة "${fields.title}" برمز ${fields.code}.`,
      affectedRecords: [
        { entity: "COURSE", description: `New course: ${fields.title} (${fields.code})` },
      ],
      changes: [
        { field: "code", label: "Code", oldValue: null, newValue: fields.code },
        { field: "title", label: "Title", oldValue: null, newValue: fields.title },
        { field: "category", label: "Category", oldValue: null, newValue: fields.category ?? "—" },
        { field: "durationHours", label: "Duration (hours)", oldValue: null, newValue: fields.durationHours },
        { field: "passScore", label: "Pass Score", oldValue: null, newValue: fields.passScore },
        { field: "maxTrainees", label: "Max Trainees", oldValue: null, newValue: fields.maxTrainees },
        { field: "language", label: "Language", oldValue: null, newValue: fields.language },
      ],
      warnings: [],
      expectedResult: `A new course with code ${fields.code} will appear in the Courses list.`,
      expectedResultAr: `ستظهر دورة جديدة برمز ${fields.code} في قائمة الدورات.`,
      hydratedParams: { input: fields },
    };
  },
  async execute(preview, user, req) {
    const input = (preview.hydratedParams.input as CourseInput);
    const refNumber = await nextRefNumber("COURSE");
    const fields = pickCourseFields(input);
    const course = await db.course.create({
      data: {
        refNumber,
        code: fields.code!,
        title: fields.title!,
        titleAr: fields.titleAr,
        description: fields.description,
        category: fields.category,
        durationHours: fields.durationHours!,
        language: fields.language!,
        validityMonths: fields.validityMonths!,
        passScore: fields.passScore!,
        maxTrainees: fields.maxTrainees!,
        hasPreTest: fields.hasPreTest!,
        hasFinalTest: fields.hasFinalTest!,
        hasEvaluation: fields.hasEvaluation!,
        status: fields.status!,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });
    await copilotAudit({
      user,
      action: "CREATE",
      entity: "COURSE",
      entityId: course.id,
      entityRef: course.refNumber,
      description: `AI created course ${course.refNumber} (${course.title})`,
      descriptionAr: `أنشأ الذكاء الاصطناعي دورة ${course.refNumber} (${course.title})`,
      req,
      newValue: fields,
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "COURSE_CREATE",
      message: `Course ${course.refNumber} (${course.title}) created successfully.`,
      messageAr: `تم إنشاء الدورة ${course.refNumber} (${course.title}) بنجاح.`,
      results: [
        { entity: "COURSE", id: course.id, refNumber: course.refNumber, description: course.title },
      ],
    };
  },
};

// ─── COURSE_EDIT ──────────────────────────────────────────────────────────
interface CourseEditInput {
  courseId: string;
  changes: Partial<CourseInput>;
}
const editCourse: ActionHandler<CourseEditInput> = {
  type: "COURSE_EDIT",
  category: "COURSES",
  description: "Edit an existing course's fields (title, description, passScore, etc.)",
  descriptionAr: "تعديل حقول دورة موجودة (العنوان، الوصف، درجة النجاح، إلخ).",
  resolvePermission: () => ({ module: "courses", action: "edit" }),
  async preparePreview(input, _user) {
    if (!input.courseId) throw new ActionError("courseId is required", 422, "VALIDATION_ERROR");
    if (!input.changes || Object.keys(input.changes).length === 0) {
      throw new ActionError("No changes provided", 422, "VALIDATION_ERROR");
    }
    const course = await db.course.findFirst({ where: { id: input.courseId, deletedAt: null } });
    if (!course) throw new ActionError("Course not found", 404, "NOT_FOUND");

    const allowed: Array<keyof CourseInput> = [
      "title", "titleAr", "description", "category", "durationHours",
      "language", "validityMonths", "passScore", "maxTrainees",
      "hasPreTest", "hasFinalTest", "hasEvaluation", "status",
    ];
    const changes: Record<string, unknown> = {};
    for (const k of allowed) {
      if (input.changes[k] !== undefined) changes[k] = input.changes[k]!;
    }
    if (Object.keys(changes).length === 0) {
      throw new ActionError("No editable fields supplied", 422, "VALIDATION_ERROR");
    }

    const changeRows = Object.entries(changes).map(([k, v]) => ({
      field: k,
      label: k,
      oldValue: (course as Record<string, unknown>)[k] ?? null,
      newValue: v,
    }));

    return {
      actionType: "COURSE_EDIT",
      title: "Edit Course",
      titleAr: "تعديل الدورة",
      summary: `Update ${Object.keys(changes).length} field(s) on course ${course.refNumber}.`,
      summaryAr: `تحديث ${Object.keys(changes).length} حقل(حقول) في الدورة ${course.refNumber}.`,
      affectedRecords: [
        { entity: "COURSE", refNumber: course.refNumber, description: course.title },
      ],
      changes: changeRows,
      warnings: [],
      expectedResult: `Course ${course.refNumber} will reflect the new values.`,
      expectedResultAr: `ستعكس الدورة ${course.refNumber} القيم الجديدة.`,
      hydratedParams: { courseId: course.id, changes },
    };
  },
  async execute(preview, user, req) {
    const courseId = preview.hydratedParams.courseId as string;
    const changes = preview.hydratedParams.changes as Record<string, unknown>;
    const before = await db.course.findUnique({ where: { id: courseId } });
    if (!before) throw new ActionError("Course no longer exists", 404, "NOT_FOUND");
    const updated = await db.course.update({
      where: { id: courseId },
      data: { ...changes, updatedBy: user.id },
    });
    await copilotAudit({
      user,
      action: "UPDATE",
      entity: "COURSE",
      entityId: updated.id,
      entityRef: updated.refNumber,
      description: `AI updated course ${updated.refNumber}`,
      descriptionAr: `حدّث الذكاء الاصطناعي الدورة ${updated.refNumber}`,
      req,
      oldValue: before,
      newValue: updated,
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "COURSE_EDIT",
      message: `Course ${updated.refNumber} updated.`,
      messageAr: `تم تحديث الدورة ${updated.refNumber}.`,
      results: [{ entity: "COURSE", id: updated.id, refNumber: updated.refNumber, description: updated.title }],
    };
  },
};

// ─── COURSE_ARCHIVE ───────────────────────────────────────────────────────
interface CourseArchiveInput { courseId: string; }
const archiveCourse: ActionHandler<CourseArchiveInput> = {
  type: "COURSE_ARCHIVE",
  category: "COURSES",
  description: "Archive (soft-delete) a course. Hidden from active lists but preserved for audit.",
  descriptionAr: "أرشفة دورة (حذف ناعم). تُخفى من القوائم النشطة لكنها تُحفظ للمراجعة.",
  resolvePermission: () => ({ module: "courses", action: "delete" }),
  async preparePreview(input, _user) {
    if (!input.courseId) throw new ActionError("courseId is required", 422, "VALIDATION_ERROR");
    const course = await db.course.findFirst({ where: { id: input.courseId, deletedAt: null } });
    if (!course) throw new ActionError("Course not found or already archived", 404, "NOT_FOUND");

    const activeSessions = await db.trainingSession.count({
      where: { courseId: course.id, deletedAt: null, status: { in: ["SCHEDULED", "IN_PROGRESS"] } },
    });
    const warnings = activeSessions > 0
      ? [{
          level: "warning" as const,
          message: `Course has ${activeSessions} active session(s). Archiving will not cancel them but new sessions cannot be created.`,
          messageAr: `للدورة ${activeSessions} جلسة نشطة. لن يتم إلغاؤها بالأرشفة لكن لا يمكن إنشاء جلسات جديدة.`,
        }]
      : [];

    return {
      actionType: "COURSE_ARCHIVE",
      title: "Archive Course",
      titleAr: "أرشفة الدورة",
      summary: `Archive course ${course.refNumber} (${course.title}). It will be hidden from active lists.`,
      summaryAr: `أرشفة الدورة ${course.refNumber} (${course.title}). ستُخفى من القوائم النشطة.`,
      affectedRecords: [
        { entity: "COURSE", refNumber: course.refNumber, description: course.title },
      ],
      changes: [{ field: "deletedAt", label: "Deleted At", oldValue: null, newValue: new Date().toISOString() }],
      warnings,
      expectedResult: `Course ${course.refNumber} will no longer appear in active course lists.`,
      expectedResultAr: `لن تظهر الدورة ${course.refNumber} في قوائم الدورات النشطة.`,
      hydratedParams: { courseId: course.id, courseRef: course.refNumber, courseTitle: course.title },
    };
  },
  async execute(preview, user, req) {
    const courseId = preview.hydratedParams.courseId as string;
    const before = await db.course.findUnique({ where: { id: courseId } });
    if (!before) throw new ActionError("Course no longer exists", 404, "NOT_FOUND");
    if (before.deletedAt) throw new ActionError("Course already archived", 400, "ALREADY_ARCHIVED");
    const now = new Date();
    const updated = await db.course.update({
      where: { id: courseId },
      data: { deletedAt: now, status: "ARCHIVED", updatedBy: user.id },
    });
    await copilotAudit({
      user,
      action: "DELETE",
      entity: "COURSE",
      entityId: updated.id,
      entityRef: updated.refNumber,
      description: `AI archived course ${updated.refNumber}`,
      descriptionAr: `أرشف الذكاء الاصطناعي الدورة ${updated.refNumber}`,
      req,
      oldValue: before,
      newValue: updated,
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "COURSE_ARCHIVE",
      message: `Course ${updated.refNumber} archived.`,
      messageAr: `تمت أرشفة الدورة ${updated.refNumber}.`,
      results: [{ entity: "COURSE", id: updated.id, refNumber: updated.refNumber, description: updated.title }],
    };
  },
};

export const courseActions: ActionHandler<any>[] = [createCourse, editCourse, archiveCourse];
