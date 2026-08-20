// ═══════════════════════════════════════════════════════════════════════════════
// E2E Real AI Generation Test — CSCC08 NG Electrical Safe Working Procedures
// ═══════════════════════════════════════════════════════════════════════════════
// Uses the REAL uploaded PDF and the REAL AI provider (OpenRouter via
// OPENAI_API_KEY). No mock, no seed data, no hardcoded questions.
//
// Runs ONLY when OPENAI_API_KEY is set in the environment. Skips automatically
// when the key is absent (local dev without a key).
//
// Never prints, logs, or exposes the API key.
// ═══════════════════════════════════════════════════════════════════════════════
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { extractMaterialText } from "@/lib/ai/material-extractor";
import { extractMaterialImages } from "@/lib/ai/material-images";
import type { ExtractedMaterialImage } from "@/lib/ai/material-images";
import {
  generateBilingualQuestions,
  validateQuestionGrounding,
  validateCorrectAnswerStructural,
  validateDistractors,
  validateGeneratedQuestion,
  type GeneratedQuestion,
} from "@/lib/ai/question-generator";
import {
  validateImageRelevance,
  bestImageForQuestion,
  significantWords,
} from "@/lib/ai/material-images";
import { _resetProviderCache } from "@/lib/ai/provider";

// ─── Safety: skip when no key is configured ─────────────────────────────────
const HAS_KEY = Boolean(process.env.OPENAI_API_KEY);

// The real uploaded CSCC08 material
const CSCC08_MATERIAL_ID = "5f62a486-c29a-435d-8435-aadac9d2019b";
const CSCC08_STORAGE = "course-materials/daefe0d14b13046eba91689f1b84cb3c.pdf";
const CSCC08_FILE_NAME = "6. CSCC08 NG Electrical Safe working Procedures.pdf";

describe.skipIf(!HAS_KEY)("E2E real AI generation — CSCC08", () => {
  let materialText = "";
  let materialImages: ExtractedMaterialImage[] = [];

  beforeAll(async () => {
    _resetProviderCache();
    const { text } = await extractMaterialText({
      id: CSCC08_MATERIAL_ID,
      type: "PDF",
      storagePath: CSCC08_STORAGE,
      fileName: CSCC08_FILE_NAME,
    });
    materialText = text;
    console.log(`\n[MATERIAL] Extracted ${text.length} chars from CSCC08 PDF`);

    materialImages = await extractMaterialImages({
      id: CSCC08_MATERIAL_ID,
      type: "PDF",
      storagePath: CSCC08_STORAGE,
      fileName: CSCC08_FILE_NAME,
    });
    console.log(`[MATERIAL] Extracted ${materialImages.length} images from CSCC08 PDF`);
  }, 120_000);

  it("generates 10 bilingual questions with full validation report", async () => {
    // ─── Generate ────────────────────────────────────────────────────────
    console.log("\n[GENERATE] Requesting 10 bilingual questions (SINGLE_CHOICE + TRUE_FALSE + MULTIPLE_CHOICE)...");
    const { questions: raw, model } = await generateBilingualQuestions({
      count: 10,
      types: ["SINGLE_CHOICE", "TRUE_FALSE", "MULTIPLE_CHOICE"],
      materialText,
      materialTitle: CSCC08_FILE_NAME,
      courseTitle: "CSCC08 NG Electrical Safe Working Procedures",
      figures: materialImages.map((im, idx) => ({
        index: idx + 1,
        page: im.page,
        pageText: im.pageText,
        caption: im.caption,
        surroundText: im.surroundText,
      })),
      imageMode: "auto",
    });
    console.log(`[GENERATE] Provider model: ${model ?? "(unknown)"}`);
    console.log(`[GENERATE] Questions returned by generateBilingualQuestions: ${raw.length}`);

    expect(raw.length).toBeGreaterThan(0);

    // ─── Per-question detailed validation ────────────────────────────────
    let totalWithImage = 0;
    let totalWithoutImage = 0;
    let totalGroundingPass = 0;
    let totalGroundingFail = 0;
    let totalStructuralPass = 0;
    let totalStructuralFail = 0;
    let totalDistractorPass = 0;
    let totalDistractorFail = 0;

    console.log("\n" + "═".repeat(120));
    console.log("PER-QUESTION VALIDATION REPORT");
    console.log("═".repeat(120));

    for (let i = 0; i < raw.length; i++) {
      const q = raw[i];
      console.log(`\n┌─ Question ${i + 1}/${raw.length} ─────────────────────────────────────────────────────────────────────`);
      console.log(`│ Type:       ${q.type}`);
      console.log(`│ Difficulty: ${q.difficulty}`);
      console.log(`│ EN: ${q.text}`);
      console.log(`│ AR: ${q.textAr}`);
      console.log(`│ Options EN: ${q.options.join(" | ")}`);
      console.log(`│ Options AR: ${q.optionsAr.join(" | ")}`);
      console.log(`│ Correct:    [${q.correctAnswers.join(", ")}] → "${q.correctAnswers.map((ci) => q.options[ci]).join(", ")}"`);

      // 1. Structural validation
      const structResult = validateCorrectAnswerStructural(q);
      if (structResult) {
        console.log(`│ [STRUCTURAL] FAIL: ${structResult}`);
        totalStructuralFail++;
      } else {
        console.log(`│ [STRUCTURAL] PASS`);
        totalStructuralPass++;
      }

      // 2. Distractor validation
      const distResult = validateDistractors(q);
      if (distResult) {
        console.log(`│ [DISTRACTOR] FAIL: ${distResult}`);
        totalDistractorFail++;
      } else {
        console.log(`│ [DISTRACTOR] PASS`);
        totalDistractorPass++;
      }

      // 3. Grounding validation with detail
      const correctText = q.correctAnswers.length > 0 ? (q.options[q.correctAnswers[0]] ?? "") : "";
      const groundPass = validateQuestionGrounding(q.text, correctText, materialText);
      // Compute the raw overlap score for logging
      const materialWords = new Set(
        materialText.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3),
      );
      const STOP_WORDS = new Set("the a an and or but not no for with from this that these those are is be was were has have had of in on at to by as it its he she they we you must can will may should would could".split(" "));
      const stemWords = new Set(
        (q.text + " " + correctText).toLowerCase().replace(/[^a-z09\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
      );
      let hits = 0;
      for (const w of stemWords) { if (materialWords.has(w)) hits++; }
      const overlapPct = stemWords.size > 0 ? ((hits / stemWords.size) * 100).toFixed(1) : "N/A";
      if (groundPass) {
        console.log(`│ [GROUNDING]  PASS — ${hits}/${stemWords.size} words overlap (${overlapPct}%) ≥ 30%`);
        totalGroundingPass++;
      } else {
        console.log(`│ [GROUNDING]  FAIL — ${hits}/${stemWords.size} words overlap (${overlapPct}%) < 30%`);
        totalGroundingFail++;
      }

      // 4. Bilingual structural validation
      const bilingualResult = validateGeneratedQuestion(q, i);
      if (bilingualResult !== q) {
        console.log(`│ [BILINGUAL]  FAIL — validateGeneratedQuestion returned different object`);
      } else {
        console.log(`│ [BILINGUAL]  PASS — text/textAr/options/optionsAr all valid`);
      }

      // 5. Image analysis
      if (q.imageRef !== undefined) {
        const selectedImg = materialImages[q.imageRef - 1];
        if (selectedImg) {
          const pageScore = computePageScore(q.text, selectedImg);
          const ctxScore = computeContextScore(q.text, selectedImg);
          const relevancePass = validateImageRelevance(q.text, selectedImg);
          console.log(`│ [IMAGE_REF]  Model selected figure #${q.imageRef} (page ${selectedImg.page})`);
          console.log(`│ [IMG_RELEV]  pageScore=${pageScore.toFixed(3)} ctxScore=${ctxScore.toFixed(3)} → ${relevancePass ? "RELEVANT" : "IRRELEVANT (dropped)"}`);
        } else {
          console.log(`│ [IMAGE_REF]  Model selected figure #${q.imageRef} — NOT FOUND in extracted images`);
        }
      } else {
        console.log(`│ [IMAGE_REF]  Model did not select any figure`);
      }

      // 6. Heuristic fallback
      if (!q.imageUrl) {
        const best = bestImageForQuestion(q.text, materialImages);
        if (best) {
          const fallbackScore = computePageScore(q.text, best);
          console.log(`│ [HEURISTIC]  Best fallback: page ${best.page} (score=${fallbackScore.toFixed(3)} ≥ 0.6)`);
        } else {
          console.log(`│ [HEURISTIC]  No image passes the ≥0.6 threshold`);
        }
      } else {
        console.log(`│ [HEURISTIC]  Skipped — already has imageUrl: ${q.imageUrl}`);
      }

      // 7. Final image decision
      if (q.imageUrl) {
        console.log(`│ [FINAL_IMG]  ✅ Attached: ${q.imageUrl}`);
        totalWithImage++;
      } else {
        console.log(`│ [FINAL_IMG]  ❌ No image (question remains without image)`);
        totalWithoutImage++;
      }

      console.log(`└${"─".repeat(110)}`);
    }

    // ─── Summary ─────────────────────────────────────────────────────────
    console.log("\n" + "═".repeat(120));
    console.log("GENERATION SUMMARY");
    console.log("═".repeat(120));
    console.log(`  Provider model:            ${model ?? "(unknown)"}`);
    console.log(`  Material:                   CSCC08 NG Electrical Safe Working Procedures`);
    console.log(`  Material text length:       ${materialText.length} chars`);
    console.log(`  Extracted images available: ${materialImages.length}`);
    console.log(`  Questions generated:        ${raw.length}`);
    console.log(`  Questions with image:       ${totalWithImage}`);
    console.log(`  Questions without image:    ${totalWithoutImage}`);
    console.log(`  Grounding PASS:             ${totalGroundingPass}`);
    console.log(`  Grounding FAIL:             ${totalGroundingFail}`);
    console.log(`  Structural PASS:            ${totalStructuralPass}`);
    console.log(`  Structural FAIL:            ${totalStructuralFail}`);
    console.log(`  Distractor PASS:            ${totalDistractorPass}`);
    console.log(`  Distractor FAIL:            ${totalDistractorFail}`);
    console.log("═".repeat(120));

    // Assertions — the batch must be clean (all questions passed validation
    // inside generateBilingualQuestions, so structural/distractor/grounding
    // should all be PASS here; the per-question logging above is for the report).
    expect(totalStructuralFail).toBe(0);
    expect(totalDistractorFail).toBe(0);
    expect(totalGroundingFail).toBe(0);

    // At least some questions should exist
    expect(raw.length).toBeGreaterThanOrEqual(5);
  }, 180_000);
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function computePageScore(stem: string, image: ExtractedMaterialImage): number {
  const stemWords = significantWords(stem);
  if (stemWords.length === 0) return 0;
  const pageWords = new Set(significantWords(image.pageText));
  let hits = 0;
  for (const w of stemWords) { if (pageWords.has(w)) hits++; }
  return hits / stemWords.length;
}

function computeContextScore(stem: string, image: ExtractedMaterialImage): number {
  const stemWords = significantWords(stem);
  if (stemWords.length === 0) return 0;
  const contextText = [image.caption, image.surroundText].filter(Boolean).join(" ");
  if (contextText.length < 10) return 0;
  const ctxWords = new Set(significantWords(contextText));
  let hits = 0;
  for (const w of stemWords) { if (ctxWords.has(w)) hits++; }
  return hits / stemWords.length;
}
