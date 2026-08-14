// /api/courses/[id]/materials/ai/generate — draft bilingual questions from
// the REAL text of the course's uploaded materials.
// =====================================================================
//   POST — body:
//     materialIds: string[]  (materials to source the questions from)
//     count: number          (1..25)
//     types?: ("SINGLE_CHOICE"|"MULTIPLE_CHOICE"|"TRUE_FALSE"|"SHORT_ANSWER")[]
//     difficulty?: "EASY"|"MEDIUM"|"HARD"
//     testType?: "PRE_TEST"|"FINAL_TEST"
//
//   Returns a DRAFT — nothing is persisted here. Each question is validated as
//   fully bilingual (English + Arabic) by the generator; every question carries
//   the materialId it was sourced from, so approve can attribute it precisely.
//
//   If any selected material cannot be extracted (missing/deleted/corrupt/
//   image-only/unsupported type) the whole request fails with 422 — there is
//   no fallback that guesses material content.
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, notFound, audit } from "@/lib/auth/api";
import { ensureTrainerCanAccessCourse } from "@/lib/api/course-materials";
import { extractMaterialsText, MaterialExtractionError } from "@/lib/ai/material-extractor";
import {
  extractMaterialImages,
  type ExtractedMaterialImage,
} from "@/lib/ai/material-images";
import {
  generateBilingualQuestions,
  QuestionGenerationError,
  QuestionValidationError,
  QUESTION_TYPES,
  type GeneratedQuestion,
  type GeneratedQuestionType,
  type GeneratedDifficulty,
} from "@/lib/ai/question-generator";

const MAX_COUNT = 25;

function isIdArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string");
}

function parseTypes(v: unknown): GeneratedQuestionType[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new QuestionValidationError("types must be an array.");
  const types = v.map((t) => String(t).toUpperCase());
  const unknown = types.find((t) => !(QUESTION_TYPES as readonly string[]).includes(t));
  if (unknown) throw new QuestionValidationError(`Unsupported question type "${unknown}".`);
  return types as GeneratedQuestionType[];
}

function parseDifficulty(v: unknown): GeneratedDifficulty | "ANY" | undefined {
  if (v === undefined || v === null) return undefined;
  const d = String(v).toUpperCase();
  if (d === "ANY") return "ANY";
  if (d === "EASY" || d === "MEDIUM" || d === "HARD") return d;
  throw new QuestionValidationError(`Unsupported difficulty "${v}".`);
}

function parseCount(v: unknown): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) {
    throw new QuestionValidationError(`count must be an integer between 1 and ${MAX_COUNT}.`);
  }
  return n;
}

export type AIQuestionDraft = GeneratedQuestion & { materialId: string };

import { sessionDraftStems, rememberDraftStems } from "@/lib/ai/draft-memory";

function dedupeStems(stems: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of stems) {
    const n = s.trim().toLowerCase().replace(/\s+/g, " ");
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(s);
  }
  return out;
}

export const POST = withModuleAction("course-materials", "create", async ({ user, req, params }) => {
  const courseId = params.id as string;
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course || course.deletedAt) return notFound("Course not found");
  if (!(await ensureTrainerCanAccessCourse(user, courseId))) return notFound("Course not found");

  const body = await req.json().catch(() => ({}));
  const materialIds = body.materialIds;
  if (!isIdArray(materialIds)) {
    return fail("materialIds (non-empty array of strings) is required", 422, "VALIDATION_ERROR");
  }
  let count: number;
  let types: GeneratedQuestionType[] | undefined;
  let difficulty: GeneratedDifficulty | "ANY" | undefined;
  try {
    count = parseCount(body.count);
    types = parseTypes(body.types);
    difficulty = parseDifficulty(body.difficulty);
  } catch (e) {
    const err = e as Error;
    return fail(err.message, 422, "VALIDATION_ERROR");
  }
  const testType = body.testType === "FINAL_TEST" ? "FINAL_TEST" : "PRE_TEST";
  const clientExcludeTexts = Array.isArray(body.excludeTexts)
    ? body.excludeTexts.filter((x): x is string => typeof x === "string")
    : [];

  const materials = await db.courseResource.findMany({
    where: { id: { in: materialIds }, courseId, deletedAt: null, isActive: true },
  });
  if (materials.length !== materialIds.length) {
    return fail("One or more selected materials were not found in this course.", 422, "VALIDATION_ERROR");
  }

  // Everything the trainer has already seen for these materials: approved
  // question-bank rows + drafts generated earlier in this session + stems the
  // client explicitly asked to avoid. Passed into the prompt so the model does
  // not re-test the same facts.
  const bankExcludes = (
    await db.question.findMany({
      where: { courseId, materialId: { in: materialIds }, isActive: true },
      select: { text: true, textAr: true },
      take: 500,
    })
  ).flatMap((q) => [q.text, q.textAr ?? ""])
    .filter((s): s is string => s.length > 0);
  const sessionExcludes = sessionDraftStems(courseId);
  const excludeTexts = dedupeStems([...clientExcludeTexts, ...bankExcludes, ...sessionExcludes]);

  // Extract REAL text from every selected material — fails fast on any problem.
  let extracted: Array<{ id: string; text: string; type: string; fileName: string | null }>;
  try {
    extracted = await extractMaterialsText(materials);
  } catch (e) {
    if (e instanceof MaterialExtractionError) return fail(e.message, 422, "VALIDATION_ERROR");
    throw e;
  }

  // Extract REAL images from every selected material in parallel with text
  // extraction. This is best-effort decoration: a PDF with no extractable
  // images just yields no imageUrl — it never fails or blocks generation.
  const imageResults = await Promise.all(
    materials.map(async (m) => {
      try {
        return { id: m.id, images: await extractMaterialImages(m) };
      } catch (e) {
        console.error(`[ai-generate] image extraction failed for material "${m.id}"`, e);
        return { id: m.id, images: [] as ExtractedMaterialImage[] };
      }
    }),
  );
  const imagesByMaterial = new Map<string, ExtractedMaterialImage[]>(
    imageResults.map((r) => [r.id, r.images]),
  );

  // Distribute the requested count across the selected materials so every
  // question can be attributed to the material it was generated from.
  const n = extracted.length;
  const per = Math.floor(count / n);
  const extra = count - per * n;
  const batches: AIQuestionDraft[] = [];
  let model: string | undefined;

  try {
    for (let i = 0; i < n; i++) {
      const share = per + (i < extra ? 1 : 0);
      if (share <= 0) continue;
      const mat = extracted[i];
      const { questions, model: m } = await generateBilingualQuestions({
        count: share,
        types,
        difficulty,
        materialText: mat.text,
        materialTitle: mat.fileName ?? `Material ${i + 1}`,
        courseTitle: course.title,
        excludeTexts,
        figures: (imagesByMaterial.get(mat.id) ?? []).map((im, idx) => ({
          index: idx + 1,
          page: im.page,
          pageText: im.pageText,
          caption: im.caption,
          surroundText: im.surroundText,
        })),
      });
      if (m) model = m;
      // Resolve the model-selected figure (imageRef) to its URL. No heuristic
      // fallback: a question without a genuine figure stays image-less.
      const images = imagesByMaterial.get(mat.id) ?? [];
      const withRef = questions.map((q) => {
        if (q.imageRef !== undefined) {
          const img = images[q.imageRef - 1];
          if (img) return { ...q, imageUrl: img.url };
        }
        return q;
      });
      const attached = withRef;
      rememberDraftStems(courseId, questions.map((q) => q.text));
      for (const q of attached) {
        batches.push({ ...q, materialId: mat.id });
      }
    }
  } catch (e) {
    if (e instanceof QuestionGenerationError || e instanceof QuestionValidationError) {
      return fail(e.message, e instanceof QuestionValidationError ? 422 : 503, e instanceof QuestionValidationError ? "VALIDATION_ERROR" : "AI_ERROR");
    }
    throw e;
  }

  if (batches.length === 0) {
    return fail("The AI returned no questions. Please try again.", 503, "AI_ERROR");
  }

  const providerModel = model;
  const aiPrompt = JSON.stringify({
    count,
    types: types ?? null,
    difficulty: difficulty ?? null,
    materialIds: materials.map((m) => m.id),
    materialTitles: materials.map((m) => m.title),
    courseTitle: course.title,
  });

  await audit({
    user,
    action: "CREATE",
    entity: "COURSE",
    entityId: courseId,
    entityRef: course.code,
    description: `Generated ${batches.length} AI question draft(s) for course ${course.code}`,
    descriptionAr: `توليد ${batches.length} سؤالاً بالذكاء الاصطناعي لدورة ${course.code}`,
    req,
    metadata: { materialIds, count, testType },
  });

  return ok({
    questions: batches,
    count: batches.length,
    aiModel: providerModel ?? null,
    aiPrompt,
    testType,
  });
});
