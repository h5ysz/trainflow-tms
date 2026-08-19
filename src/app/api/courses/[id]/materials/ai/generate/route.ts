// /api/courses/[id]/materials/ai/generate — draft bilingual questions from
// the REAL text of the course's uploaded materials.
// =====================================================================
//   POST — body:
//     materialIds: string[]  (materials to source the questions from)
//     count: number          (1..25) — required unless `counts` is provided
//     counts?: { TYPE: number }  exact per-type counts (total 1..25);
//                                overrides `count` and `types`
//     types?: ("SINGLE_CHOICE"|"MULTIPLE_CHOICE"|"TRUE_FALSE"|"SHORT_ANSWER")[]
//     difficulty?: "EASY"|"MEDIUM"|"HARD"
//     imageMode?: "auto"|"with_images"|"without_images"
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
  attachMaterialImages,
  validateImageRelevance,
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
  type GenerationOptions,
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

export type ImageMode = "auto" | "with_images" | "without_images";

/** Parse exact per-type counts; at least one type must be > 0 and the total
 *  must stay within MAX_COUNT. Returns undefined when the field is absent. */
function parseCounts(v: unknown): Partial<Record<GeneratedQuestionType, number>> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new QuestionValidationError("counts must be an object.");
  const out: Partial<Record<GeneratedQuestionType, number>> = {};
  let total = 0;
  for (const key of Object.keys(v)) {
    const type = String(key).toUpperCase();
    if (!(QUESTION_TYPES as readonly string[]).includes(type)) {
      throw new QuestionValidationError(`Unsupported question type "${key}" in counts.`);
    }
    const n = Number(v[key]);
    if (!Number.isInteger(n) || n < 0 || n > MAX_COUNT) {
      throw new QuestionValidationError(`counts.${key} must be an integer between 0 and ${MAX_COUNT}.`);
    }
    if (n > 0) {
      out[type as GeneratedQuestionType] = n;
      total += n;
    }
  }
  if (total === 0) throw new QuestionValidationError("counts must request at least one question.");
  if (total > MAX_COUNT) throw new QuestionValidationError(`counts total must not exceed ${MAX_COUNT}.`);
  return out;
}

function parseImageMode(v: unknown): ImageMode | undefined {
  if (v === undefined || v === null) return undefined;
  const s = String(v).toLowerCase();
  if (s === "auto" || s === "with_images" || s === "without_images") return s;
  throw new QuestionValidationError(`Unsupported imageMode "${v}".`);
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
  let count: number | undefined;
  let counts: Partial<Record<GeneratedQuestionType, number>> | undefined;
  let imageMode: ImageMode | undefined;
  let types: GeneratedQuestionType[] | undefined;
  let difficulty: GeneratedDifficulty | "ANY" | undefined;
  try {
    counts = parseCounts(body.counts);
    imageMode = parseImageMode(body.imageMode);
    types = parseTypes(body.types);
    difficulty = parseDifficulty(body.difficulty);
    count = body.count === undefined || body.count === null ? undefined : parseCount(body.count);
    if (!counts && count === undefined) {
      throw new QuestionValidationError("count is required when counts is not provided.");
    }
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

  // Distribute the requested generation across the selected materials so every
  // question can be attributed to the material it was sourced from.
  const n = extracted.length;
  const per = counts ? 0 : Math.floor((count ?? 0) / n);
  const extra = counts ? 0 : (count ?? 0) - per * n;
  const batches: AIQuestionDraft[] = [];
  let model: string | undefined;

  /** Per-material share of the exact per-type counts. */
  const shareCountsFor = (i: number): Partial<Record<GeneratedQuestionType, number>> | undefined => {
    if (!counts) return undefined;
    const out: Partial<Record<GeneratedQuestionType, number>> = {};
    let total = 0;
    for (const t of QUESTION_TYPES) {
      const c = counts[t] ?? 0;
      if (c <= 0) continue;
      const perMat = Math.floor(c / n);
      const rem = c - perMat * n;
      const s = perMat + (i < rem ? 1 : 0);
      if (s > 0) {
        out[t] = s;
        total += s;
      }
    }
    return total > 0 ? out : undefined;
  };

  try {
    for (let i = 0; i < n; i++) {
      const mat = extracted[i];
      const materialFigures = (imagesByMaterial.get(mat.id) ?? []).map((im, idx) => ({
        index: idx + 1,
        page: im.page,
        pageText: im.pageText,
        caption: im.caption,
        surroundText: im.surroundText,
      }));

      const genOpts: GenerationOptions = {
        count: 0,
        difficulty,
        materialText: mat.text,
        materialTitle: mat.fileName ?? `Material ${i + 1}`,
        courseTitle: course.title,
        excludeTexts,
        figures: imageMode === "without_images" ? undefined : materialFigures,
        imageMode,
      };

      if (counts) {
        const shareCounts = shareCountsFor(i);
        if (!shareCounts) continue;
        genOpts.count = Object.values(shareCounts).reduce((a, b) => a + b, 0);
        genOpts.counts = shareCounts;
      } else {
        const share = per + (i < extra ? 1 : 0);
        if (share <= 0) continue;
        genOpts.count = share;
        genOpts.types = types;
      }

      const { questions, model: m } = await generateBilingualQuestions(genOpts);
      if (m) model = m;
      // Resolve the model-selected figure (imageRef) to its URL, validating
      // relevance. For questions without a validated model image, apply the
      // word-overlap heuristic fallback.
      const images = imagesByMaterial.get(mat.id) ?? [];
      const withModelImages =
        imageMode === "without_images"
          ? questions
          : questions.map((q) => {
              if (q.imageRef !== undefined) {
                const img = images[q.imageRef - 1];
                if (img && validateImageRelevance(q.text, img)) {
                  return { ...q, imageUrl: img.url };
                }
              }
              return q;
            });
      const attached = imageMode === "without_images"
        ? withModelImages
        : attachMaterialImages(withModelImages, images);
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
    count: count ?? null,
    counts: counts ?? null,
    types: types ?? null,
    difficulty: difficulty ?? null,
    imageMode: imageMode ?? null,
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
    metadata: { materialIds, count: count ?? null, counts: counts ?? null, imageMode: imageMode ?? null, testType },
  });

  return ok({
    questions: batches,
    count: batches.length,
    aiModel: providerModel ?? null,
    aiPrompt,
    testType,
  });
});
