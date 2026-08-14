// /api/courses/[id]/materials/ai/approve — persist reviewed AI question drafts
// into the Question Bank as source=AI_GENERATED.
// =====================================================================
//   POST — body:
//     questions: Array<{
//       materialId: string,
//       type, text, textAr, options, optionsAr, correctAnswers,
//       explanation?, explanationAr?, difficulty, category?, tags?
//     }>          (the trainer's FINAL edited drafts — the AI is not re-consulted)
//     testType?: "PRE_TEST" | "FINAL_TEST"
//     aiModel?: string | null
//     aiPrompt?: string | null
//
//   Every submitted question is re-validated as FULLY BILINGUAL before being
//   saved (trainer edits could break the bilingual contract), and each one must
//   carry a materialId that belongs to this course. Nothing is auto-saved and
//   there is no background/cron generation — approval is always an explicit
//   human action.
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, notFound, audit } from "@/lib/auth/api";
import { ensureTrainerCanAccessCourse } from "@/lib/api/course-materials";
import {
  validateGeneratedQuestion,
  QuestionValidationError,
  toQuestionCreateData,
  type GeneratedQuestion,
} from "@/lib/ai/question-generator";
import { parseJsonColumn } from "@/lib/api/json-column";

interface DraftInput {
  materialId?: unknown;
  [key: string]: unknown;
}

export const POST = withModuleAction("course-materials", "create", async ({ user, req, params }) => {
  const courseId = params.id as string;
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course || course.deletedAt) return notFound("Course not found");
  if (!(await ensureTrainerCanAccessCourse(user, courseId))) return notFound("Course not found");

  const body = await req.json().catch(() => ({}));
  const rawQuestions = body.questions;
  if (!Array.isArray(rawQuestions) || rawQuestions.length === 0) {
    return fail("questions (non-empty array) is required", 422, "VALIDATION_ERROR");
  }
  if (rawQuestions.length > 50) {
    return fail("Too many questions (max 50 per approval).", 422, "VALIDATION_ERROR");
  }
  const testType = body.testType === "FINAL_TEST" ? "FINAL_TEST" : "PRE_TEST";

  // Build the map of this course's materials (valid materialId targets).
  const materials = await db.courseResource.findMany({
    where: { courseId, deletedAt: null, isActive: true },
    select: { id: true },
  });
  const materialIds = new Set(materials.map((m) => m.id));
  if (materialIds.size === 0) {
    return fail("This course has no materials to attribute questions to.", 422, "VALIDATION_ERROR");
  }

  // Validate + re-validate (bilingual) every draft, mapping to create data.
  const createData: Array<ReturnType<typeof toQuestionCreateData>> = [];
  const aiPrompt = typeof body.aiPrompt === "string" && body.aiPrompt.trim() ? body.aiPrompt : null;
  const aiModel = typeof body.aiModel === "string" && body.aiModel.trim() ? body.aiModel : null;

  try {
    for (const raw of rawQuestions) {
      const draft = (raw ?? {}) as DraftInput;
      if (typeof draft.materialId !== "string" || !materialIds.has(draft.materialId)) {
        throw new QuestionValidationError(
          `Question "${String(draft.text ?? "").slice(0, 40)}…" references a material that does not belong to this course.`,
        );
      }
      const question = validateGeneratedQuestion(draft, createData.length);
      createData.push(
        toQuestionCreateData(question, {
          courseId,
          materialId: draft.materialId,
          testType,
          aiModel,
          aiPrompt,
          createdBy: user.id,
        }),
      );
    }
  } catch (e) {
    if (e instanceof QuestionValidationError) return fail(e.message, 422, "VALIDATION_ERROR");
    throw e;
  }

  const created = await db.$transaction(createData.map((data) => db.question.create({ data })));

  await audit({
    user,
    action: "CREATE",
    entity: "COURSE",
    entityId: courseId,
    entityRef: course.code,
    description: `Approved ${created.length} AI-generated question(s) into the Question Bank for course ${course.code}`,
    descriptionAr: `اعتماد ${created.length} سؤالاً مولّداً بالذكاء الاصطناعي في بنك الأسئلة لدورة ${course.code}`,
    req,
    metadata: { count: created.length, testType, aiModel, materialIds: [...materialIds] },
  });

  return ok({
    created: created.map((q) => ({
      ...q,
      options: parseJsonColumn(q.options, [] as string[], "question.options"),
      optionsAr: parseJsonColumn(q.optionsAr, null as string[] | null, "question.optionsAr"),
      correctAnswers: parseJsonColumn(q.correctAnswers, [] as number[], "question.correctAnswers"),
    })),
    count: created.length,
    testType,
  });
});
