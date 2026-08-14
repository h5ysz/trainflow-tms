// ─────────────────────────────────────────────────────────────────────────────
// Bilingual AI Question Generator — Course Material → Question Bank draft
// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 of the AI feature set. This module:
//
//   1. Takes the REAL text extracted from an uploaded course material
//      (material-extractor.ts) plus generation options (count / types /
//      difficulty).
//   2. Asks the existing AI provider (getAIProvider) to produce questions.
//   3. Parses the provider response with a robust JSON extractor (fenced code
//      blocks, leading/trailing prose, wrapped { "questions": [...] }).
//   4. STRICTLY validates that every question is fully bilingual — English AND
//      Arabic — per the product rule: "all questions bilingual always". There
//      is no Arabic-only or English-only fallback, and no content guessing:
//      if the model returns a question missing either language (or options in
//      one language only) the whole batch is rejected so the trainer can
//      regenerate instead of approving broken questions.
//
// This module never touches the database. It returns validated draft questions;
// the approve route persists them as source=AI_GENERATED.
import { getAIProvider } from "@/lib/ai/provider";
import type { ChatMessage } from "@/lib/ai/provider";
import { DO_NOT_REPEAT_TEXT_BEGIN, DO_NOT_REPEAT_TEXT_END, FIGURES_BEGIN, FIGURES_END } from "@/lib/ai/prompt-markers";

export const QUESTION_TYPES = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"] as const;
export type GeneratedQuestionType = (typeof QUESTION_TYPES)[number];
export type GeneratedDifficulty = "EASY" | "MEDIUM" | "HARD";

/** A figure extracted from the source material, numbered for the prompt. */
export interface QuestionFigure {
  /** 1-based index used by the model's `imageRef`. */
  index: number;
  /** 1-based source page. */
  page: number;
  /** Cleaned text of the figure's source page (used for relevance matching). */
  pageText: string;
  /** Caption/label text near the figure (e.g. "Figure 3 — PPE"). Optional. */
  caption?: string;
  /** Text surrounding the figure on the page (the paragraph it belongs to). */
  surroundText?: string;
}

/** A single validated, fully bilingual generated question (draft). */
export interface GeneratedQuestion {
  type: GeneratedQuestionType;
  /** English stem — REQUIRED (never omitted). */
  text: string;
  /** Arabic stem — REQUIRED (never omitted). */
  textAr: string;
  /** English options. Empty only for SHORT_ANSWER. */
  options: string[];
  /** Arabic options — same length & order as `options`. */
  optionsAr: string[];
  /** Indices into options. For SHORT_ANSWER: [] or [0]. */
  correctAnswers: number[];
  /** English explanation. Both explanation + explanationAr, or neither. */
  explanation?: string;
  /** Arabic explanation. Both explanation + explanationAr, or neither. */
  explanationAr?: string;
  /** Optional figure/image extracted from the source material (public URL). */
  imageUrl?: string;
  /**
   * Which numbered figure (FIGURES list in the prompt) this question is
   * directly related to. Set ONLY when the figure's page text genuinely
   * illustrates/answers the tested fact — never at random.
   */
  imageRef?: number;
  difficulty: GeneratedDifficulty;
  category?: string;
  tags?: string[];
}

export interface GenerationOptions {
  /** How many questions the trainer asked for. */
  count: number;
  /** Restrict to these types (empty = any). */
  types?: GeneratedQuestionType[];
  /** Restrict difficulty (undefined = any). */
  difficulty?: GeneratedDifficulty | "ANY";
  /** The REAL extracted text of the source material. */
  materialText: string;
  /** Display name of the source material (for the prompt). */
  materialTitle: string;
  /** Course title (for the prompt). */
  courseTitle: string;
  /**
   * English stems of questions that already exist (question bank / earlier
   * drafts). The generator instructs the model to avoid re-testing the same
   * fact, and post-filters literal + near-duplicate output.
   */
  excludeTexts?: string[];
  /**
   * Figures extracted from this material. Each one is listed in the prompt so
   * the model can attach a question to the figure that actually illustrates
   * the tested fact (imageRef), instead of images being guessed afterwards.
   */
  figures?: QuestionFigure[];
}

export class QuestionGenerationError extends Error {
  readonly code = "AI_GENERATION_FAILED";
}
export class QuestionValidationError extends Error {
  readonly code = "AI_VALIDATION_FAILED";
}

// ─── Duplicate detection ─────────────────────────────────────────────────────

/** Normalize a stem for exact-duplicate comparison (case + punctuation + whitespace). */
export function normalizeStem(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,!?;:"'“”‘’()[\]{}«»،؛؟\u0660-\u0669]/g, "")
    .trim();
}

const STOP_WORDS = new Set(
  "a an the and or but if then else of in on at by for with from to as is are was were be been being it its this that these those which who whom whose what when where why how do does did done can could would should may might must not no nor so too very".split(" "),
);

/** Content-bearing words of a stem (≥3 chars, not stop words). */
function contentTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !STOP_WORDS.has(w)),
  );
}

/** Arabic content words (≥2 chars, light stopwords dropped). */
function arabicTokens(s: string): Set<string> {
  const ARABIC_STOP = new Set(
    "في من على إلى عن أن إن لا ما مع هذا هذه التي الذي كل حسب وفق إلى وبين".split(" "),
  );
  return new Set(
    (s ?? "")
      .toLowerCase()
      .replace(/[^\u0600-\u06FF\s]/g, " ")
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length >= 2 && !ARABIC_STOP.has(w)),
  );
}

/** Jaccard similarity over content words — same fact → high score even if reworded. */
export function similarity(a: string, b: string): number {
  const ta = contentTokens(a);
  const tb = contentTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Dice coefficient over two token sets. */
function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return (2 * inter) / (a.size + b.size);
}

interface DedupQuestion {
  text: string;
  textAr?: string;
  options?: string[];
  correctAnswers?: number[];
}

/** The tested IDEA of a question = English stem + Arabic stem content words. */
function stemTokens(q: DedupQuestion): Set<string> {
  return new Set([...contentTokens(q.text ?? ""), ...arabicTokens(q.textAr ?? "")]);
}

/** The content of the question's CORRECT answer(s), if any. */
function answerTokens(q: DedupQuestion): Set<string> {
  const opts = q.options ?? [];
  const correct = q.correctAnswers ?? [];
  const en = correct.map((i) => (typeof i === "number" && opts[i] ? opts[i] : "")).join(" ");
  return contentTokens(en);
}

/**
 * Two questions test the SAME FACT when they share the tested idea (stem words
 * in English AND Arabic) and/or the same correct answer. Three independent
 * signals — a literal normalized match, a high stem overlap, or a moderately
 * overlapping stem combined with the same correct answer — so reworded facts
 * are caught without depending on any single text-similarity number.
 */
function isSemanticDuplicate(a: DedupQuestion, b: DedupQuestion): boolean {
  const normA = normalizeStem(a.text ?? "");
  const normArA = normalizeStem(a.textAr ?? "");
  const normB = normalizeStem(b.text ?? "");
  const normArB = normalizeStem(b.textAr ?? "");
  if (normA.length > 0 && (normA === normB || (normArB.length > 0 && normA === normArB))) return true;
  if (normArA.length > 0 && (normArA === normB || (normArB.length > 0 && normArA === normArB))) return true;

  const stemDice = dice(stemTokens(a), stemTokens(b));
  if (stemDice >= 0.62) return true;

  const ansA = answerTokens(a);
  const ansB = answerTokens(b);
  if (ansA.size > 0 && ansB.size > 0) {
    const ansDice = dice(ansA, ansB);
    if (stemDice >= 0.45 && ansDice >= 0.65) return true;
  }
  return false;
}

/** True when a question re-tests a fact that already exists (bank / draft). */
function isDuplicateOfStem(q: DedupQuestion, exclude: string): boolean {
  const norm = normalizeStem(q.text ?? "");
  const normEx = normalizeStem(exclude);
  if (norm.length > 0 && norm === normEx) return true;
  const exTokens = new Set([...contentTokens(exclude), ...arabicTokens(exclude)]);
  return dice(stemTokens(q), exTokens) >= 0.55;
}

/**
 * Remove duplicates — literal AND reworded (same tested idea, or same idea +
 * same correct answer) — against both the exclude list (question bank / earlier
 * drafts) and the kept items of the current batch. Order is preserved; the
 * first occurrence of each fact wins. Compares English + Arabic stems and the
 * correct answers, not only the English text.
 */
export function dedupeQuestions<T extends DedupQuestion>(items: T[], excludes: string[]): T[] {
  const kept: T[] = [];
  const excludeList = excludes.map((s) => String(s).trim()).filter((s) => s.length > 0);
  for (const item of items) {
    const text = item.text ?? "";
    if (normalizeStem(text).length === 0) continue;
    const dupInBatch = kept.some((k) => isSemanticDuplicate(item, k));
    if (dupInBatch) continue;
    const dupInExcludes = excludeList.some((e) => isDuplicateOfStem(item, e));
    if (dupInExcludes) continue;
    kept.push(item);
  }
  return kept;
}

const MAX_COUNT = 25;
/** Upper bound on the number of already-used questions passed into the prompt. */
const MAX_EXCLUDE_INPUT = 60;

// ─── Prompt building ─────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional question generator for a bilingual training-management system (English + Arabic).
Every question you produce MUST be fully bilingual: an English version AND an Arabic version. It is FORBIDDEN to output any question in only one language.

Reply with ONLY a valid JSON object of the exact shape { "questions": [ ...question objects... ] }. No markdown fences, no commentary, no trailing text.

Schema for each element (ALL fields):
{
  "type": "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER",
  "text": "English question stem",
  "textAr": "نص السؤال بالعربية",
  "options": ["English option 1", "English option 2"],
  "optionsAr": ["الخيار الأول بالعربية", "الخيار الثاني بالعربية"],
  "correctAnswers": [0],
  "explanation": "English explanation of the correct answer",
  "explanationAr": "شرح الإجابة الصحيحة بالعربية",
  "difficulty": "EASY" | "MEDIUM" | "HARD",
  "category": "topic or subject tag",
  "tags": ["tag1", "tag2"]
}

Rules:
- text AND textAr are BOTH required and non-empty for every question.
- For SINGLE_CHOICE / MULTIPLE_CHOICE / TRUE_FALSE: options AND optionsAr are BOTH required, with the SAME number of items in the SAME order.
- For TRUE_FALSE: options = ["True","False"], optionsAr = ["صحيح","خطأ"], correctAnswers = [0] or [1].
- For SHORT_ANSWER: options = [], optionsAr = [], correctAnswers = [].
- correctAnswers are zero-based indices into options; every index must be valid.
- explanation AND explanationAr are BOTH required, or BOTH omitted.
- Base questions ONLY on the source text in the user message. Never invent facts not present in the material.

DISTINCTNESS (NON-NEGOTIABLE):
- Every question in the response must test a DIFFERENT fact/concept than every other question in the SAME response.
- If the user message contains a DO_NOT_REPEAT_TEXT_BEGIN/END block, you MUST NOT create a question that is identical to — OR tests the same fact as — ANY question in that block. This is enforced: re-testing the same information (even reworded) is a duplicate and is forbidden.
- Spread your questions across DIFFERENT paragraphs/sections of the source text. NEVER take one paragraph and rephrase it into multiple questions, and never build a batch from the same few sentences.

DIFFICULTY GUIDE — each level must produce genuinely different, level-appropriate questions:
- EASY: direct recall / definition / recognition. Ask about a stated fact plainly ("Which statement is correct?", "What is X called?", "According to the material, ..."). Simple vocabulary, one clear fact per question.
- MEDIUM: application / interpretation. Ask what a worker must DO, which procedure applies, or to interpret a rule in a scenario ("What must a worker do when ...?", "Which of the following is the correct procedure for ...?").
- HARD: analysis / evaluation / synthesis. Ask WHY, what is MOST important, to compare two procedures, to identify the incorrect step, or to combine multiple concepts ("Why must ... be isolated before ...?", "Which combination of precautions is required when ...?", "Identify the statement that is NOT correct.").
- When difficulty is ANY, mix all three levels and set each question's "difficulty" field to its actual level.

FIGURES — attach a real image ONLY when the question is genuinely about it:
- If the user message contains a FIGURES_BEGIN/END block, each figure is listed with its index, page, caption and surrounding text: "[index] page N: <page text>" plus "[index|caption] ..." and "[index|around] ...".
- A figure is relevant to a question ONLY when the CAPTION / surrounding text of that figure clearly describes or illustrates the EXACT fact the question tests. "The image is on the same page" is NEVER a reason to attach it.
- The question must be BUILT on the image content: if the fact being tested comes from a figure/diagram/sign/table/equipment photo, attach THAT figure via "imageRef". If the question tests plain textual content, or you cannot prove the figure shows the tested fact, set NO "imageRef" and leave the question without an image.
- NEVER attach an image just because one exists nearby, and NEVER attach the same figure to several questions.

Translation quality rules (NON-NEGOTIABLE — these are enforced by automatic validation):
- Every Arabic field (textAr, optionsAr, explanationAr) must be a NATURAL, PROFESSIONAL, technically accurate Arabic translation — written by a native technical writer in formal Modern Standard Arabic. NOT a literal word-for-word machine translation, and never transliterated English.
- Use the correct Arabic technical terminology for the domain (electrical safety, occupational safety, etc.).
- NEVER paste or embed the English sentence inside an Arabic field. An Arabic field that is mostly English — or that contains the English sentence — is REJECTED and the whole batch fails.
- NEVER carry raw PDF/Word formatting artifacts (box glyphs like □, broken symbols, control characters, page numbers, underline filler) into ANY field.
- You MAY keep widely-used technical acronyms (e.g. PPE, AC/DC, NFPA, PTW) in Latin inside otherwise-Arabic text. Never translate them.
- The English and Arabic versions must express the same question; do not let the languages drift into different questions.`;

function buildExcludeBlock(excludeTexts: string[]): string {
  const list = excludeTexts
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter((s) => s.length > 0)
    .slice(0, MAX_EXCLUDE_INPUT)
    .map((s) => `- "${s.slice(0, 200)}"`);
  if (list.length === 0) return "";
  return [
    "",
    "These questions ALREADY EXIST (question bank or a previous generation). You MUST NOT create a question identical to, or testing the same fact as, ANY of them:",
    DO_NOT_REPEAT_TEXT_BEGIN,
    ...list,
    DO_NOT_REPEAT_TEXT_END,
    "",
  ].join("\n");
}

function buildFiguresBlock(figures?: QuestionFigure[]): string {
  if (!figures || figures.length === 0) return "";
  const lines: string[] = [];
  for (const f of figures.slice(0, 20)) {
    lines.push(`[${f.index}] page ${f.page}: ${(f.pageText ?? "").slice(0, 400)}`);
    if (f.caption) lines.push(`[${f.index}|caption] ${f.caption.slice(0, 200)}`);
    if (f.surroundText) lines.push(`[${f.index}|around] ${f.surroundText.slice(0, 500)}`);
  }
  return [
    "",
    "Figures extracted from the material (use imageRef ONLY for a figure the question is genuinely built on — its caption/surrounding text must show the exact fact being tested):",
    FIGURES_BEGIN,
    ...lines,
    FIGURES_END,
    "",
  ].join("\n");
}

function buildUserPrompt(opts: GenerationOptions): string {
  const types = opts.types && opts.types.length > 0 ? opts.types.join(",") : "any";
  const difficulty = opts.difficulty && opts.difficulty !== "ANY" ? opts.difficulty : "any";
  return [
    `Course: ${opts.courseTitle}`,
    `Material: ${opts.materialTitle}`,
    "REQUESTED_COUNT: " + String(opts.count),
    "ALLOWED_TYPES: " + types,
    "DIFFICULTY: " + difficulty,
    "",
    "Note: the SOURCE_TEXT below was automatically extracted from the file and cleaned of formatting artifacts. It may still contain headers or layout text — base questions only on meaningful content, and never copy artifacts into a question.",
    "SOURCE_TEXT_BEGIN",
    opts.materialText,
    "SOURCE_TEXT_END",
    buildExcludeBlock(opts.excludeTexts ?? []),
    buildFiguresBlock(opts.figures),
    "",
    `Generate exactly ${opts.count} questions. All questions must be bilingual (Arabic + English).`,
  ].join("\n");
}

// ─── Robust JSON extraction ──────────────────────────────────────────────────

function findBalancedJson(raw: string): string | null {
  const startIndexes = [
    ...raw.split("").flatMap((_, i) => (raw[i] === "{" || raw[i] === "[") && i !== raw.length - 1 ? [i] : []),
  ];
  for (const start of startIndexes) {
    const open = raw[start];
    const close = open === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < raw.length; i++) {
      const c = raw[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') {
        inString = true;
        continue;
      }
      if (c === open) depth++;
      else if (c === close) {
        depth--;
        if (depth === 0) return raw.slice(start, i + 1);
      }
    }
  }
  return null;
}

export function extractJsonValue(raw: string): unknown {
  const trimmed = raw.trim();

  // Direct parse first (covers clean JSON array/object).
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }

  // Fenced ```json ... ``` blocks (then any ``` fence).
  for (const fence of [/```json\s*([\s\S]*?)```/i, /```([\s\S]*?)```/]) {
    const m = fence.exec(trimmed);
    if (m?.[1]) {
      const inner = m[1].trim();
      try {
        return JSON.parse(inner);
      } catch {
        const balanced = findBalancedJson(inner);
        if (balanced) {
          try {
            return JSON.parse(balanced);
          } catch {
            /* keep trying */
          }
        }
      }
    }
  }

  // Balanced first value anywhere in the text.
  const balanced = findBalancedJson(trimmed);
  if (balanced) {
    try {
      return JSON.parse(balanced);
    } catch {
      /* unrecoverable */
    }
  }

  throw new QuestionGenerationError("The AI response did not contain valid JSON. Please regenerate.");
}

/** Envelope keys some models wrap the question list in. */
const QUESTION_ARRAY_KEYS = ["questions", "data", "items", "result", "results", "response", "outputs"] as const;

/**
 * Unwrap a model response down to a list of questions. Accepts:
 *   - a bare array
 *   - a JSON string that parses to an array (models forced into json_object
 *     sometimes stringify the list)
 *   - an object with one of the known envelope keys holding an array/string
 *   - a number-keyed object ({ "0": {...}, "1": {...} })
 */
function unwrapQuestionArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* not a JSON string */
    }
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of QUESTION_ARRAY_KEYS) {
      const hit = unwrapQuestionArray(obj[key]);
      if (hit) return hit;
    }
    const keys = Object.keys(obj);
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) {
      const list = keys.map((k) => obj[k]);
      if (list.some((q) => q && typeof q === "object")) return list;
    }
    // Some models group questions by allowed type ({ "SINGLE_CHOICE": [...], ... }).
    const grouped = keys.map((k) => obj[k]);
    if (
      grouped.length > 0 &&
      grouped.every((v) => Array.isArray(v) && v.every((q) => q && typeof q === "object"))
    ) {
      return grouped.flat();
    }
  }
  return null;
}

/** Accepts a JSON array, a { "questions": [...] } envelope, or common variants. */
export function extractQuestionArray(raw: string): unknown[] {
  const value = extractJsonValue(raw);
  const list = unwrapQuestionArray(value);
  if (list) return list;
  throw new QuestionGenerationError("The AI response did not contain a list of questions. Please regenerate.");
}

// ─── Strict bilingual validation ─────────────────────────────────────────────

function isNonEmpty(s: unknown): s is string {
  return typeof s === "string" && s.trim().length > 0;
}

// ─── Translation-quality checks ───────────────────────────────────────────────
// The product rule is "English + Arabic". A verbatim copy of the English
// sentence in the Arabic field is NOT a translation — it is the exact failure
// this pipeline must reject (the earlier mock did exactly that). These checks
// are intentionally strict: a bad translation fails the whole batch.

const ARABIC_LETTERS = /[\u0600-\u06FF]/;
const ARTIFACT_CHARS = /[\uFFFD\uFFFE\uFFFF□■▪◻▢�]/;
const PRIVATE_USE_CHARS = /[\uE000-\uF8FF\uFDD0-\uFDEF]/;
const LATIN_WORD = /^[A-Za-z][A-Za-z'-]*$/;

function countChars(s: string, re: RegExp): number {
  return (s.match(re) || []).length;
}

/** Reject raw formatting artifacts in any text field (English or Arabic). */
function assertNoArtifacts(s: string, field: string): void {
  if (ARTIFACT_CHARS.test(s) || PRIVATE_USE_CHARS.test(s)) {
    throw new QuestionValidationError(
      `${field} contains raw formatting artifacts (broken glyphs / box symbols / control characters).`,
    );
  }
}

/**
 * Reject an "Arabic" field that is not genuinely Arabic:
 *   - must contain at least one Arabic character;
 *   - must not be mostly Latin letters (the English text pasted into Arabic);
 *   - must not embed a whole English sentence (≥3 consecutive Latin words).
 * Short Latin acronyms (PPE, AC/DC, NFPA) inside Arabic text are fine.
 */
function assertArabicQuality(s: string, field: string): void {
  assertNoArtifacts(s, field);
  if (!ARABIC_LETTERS.test(s)) {
    throw new QuestionValidationError(`${field} is not Arabic — it contains no Arabic characters.`);
  }
  const ar = countChars(s, ARABIC_LETTERS);
  const latin = countChars(s, /[A-Za-z]/g);
  if (ar > 0 && latin / (ar + latin) > 0.45) {
    throw new QuestionValidationError(
      `${field} is mostly English — Arabic fields must be a real Arabic translation, not the English text pasted in.`,
    );
  }
  let run = 0;
  for (const word of s.split(/\s+/)) {
    if (LATIN_WORD.test(word) && word.length >= 4) {
      run++;
      if (run >= 3) {
        throw new QuestionValidationError(
          `${field} embeds an English sentence — Arabic fields must be genuine Arabic translations.`,
        );
      }
    } else {
      run = 0;
    }
  }
}

function asStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  if (!v.every((x) => typeof x === "string")) return null;
  return v as string[];
}

function normalizeType(v: unknown): GeneratedQuestionType | null {
  if (typeof v !== "string") return null;
  const t = v.toUpperCase();
  return (QUESTION_TYPES as readonly string[]).includes(t) ? (t as GeneratedQuestionType) : null;
}

function normalizeDifficulty(v: unknown): GeneratedDifficulty | null {
  if (typeof v !== "string") return null;
  const d = v.toUpperCase();
  return d === "EASY" || d === "MEDIUM" || d === "HARD" ? d : null;
}

/**
 * Validate + normalize a raw model question into a fully bilingual
 * GeneratedQuestion. Throws QuestionValidationError (with a human-readable
 * reason) on the FIRST violation — a bilingual gap anywhere fails the batch.
 */
export function validateGeneratedQuestion(raw: unknown, index: number): GeneratedQuestion {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const fail = (reason: string): never => {
    throw new QuestionValidationError(`Question #${index + 1} failed validation: ${reason}`);
  };

  const type = normalizeType(obj.type) ?? fail(`unsupported type "${String(obj.type)}".`);

  const text = obj.text;
  const textAr = obj.textAr;
  if (!isNonEmpty(text)) fail('"text" (English) is required.');
  if (!isNonEmpty(textAr)) fail('"textAr" (Arabic) is required — every question must be bilingual.');
  assertNoArtifacts(text as string, '"text"');
  assertArabicQuality(textAr as string, '"textAr"');

  const difficulty = normalizeDifficulty(obj.difficulty) ?? fail(`unsupported difficulty "${String(obj.difficulty)}".`);

  const category = isNonEmpty(obj.category) ? obj.category : undefined;
  const tags = asStringArray(obj.tags);
  let imageUrl: string | undefined;
  if (obj.imageUrl !== undefined && obj.imageUrl !== null) {
    const rawUrl = String(obj.imageUrl).trim();
    if (rawUrl !== "") {
      if (/[\u0000-\u001F\u007F\r\n]/.test(rawUrl) || !(rawUrl.startsWith("/") || rawUrl.startsWith("http://") || rawUrl.startsWith("https://"))) {
        fail('"imageUrl" must be a URL (e.g. /api/uploads/question-images/...) or an absolute http(s) link.');
      }
      imageUrl = rawUrl;
    }
  }
  let imageRef: number | undefined;
  if (obj.imageRef !== undefined && obj.imageRef !== null) {
    const n = Number(obj.imageRef);
    if (!Number.isInteger(n) || n < 1) {
      fail('"imageRef" must be a positive integer (an index from the FIGURES list).');
    }
    imageRef = n;
  }
  const explanation = obj.explanation;
  const explanationAr = obj.explanationAr;
  if (explanation !== undefined && explanation !== null && String(explanation).trim() !== "") {
    if (!isNonEmpty(explanationAr)) fail('"explanationAr" is required whenever "explanation" is provided.');
    assertArabicQuality(String(explanationAr), '"explanationAr"');
  }
  if (explanationAr !== undefined && explanationAr !== null && String(explanationAr).trim() !== "") {
    if (!isNonEmpty(explanation)) fail('"explanation" is required whenever "explanationAr" is provided.');
    assertNoArtifacts(String(explanation), '"explanation"');
  }
  const hasExplanation = isNonEmpty(explanation) || isNonEmpty(explanationAr);

  let options = asStringArray(obj.options);
  let optionsAr = asStringArray(obj.optionsAr);

  if (type === "SHORT_ANSWER") {
    const correct = Array.isArray(obj.correctAnswers) ? obj.correctAnswers : [];
    if (options && options.length > 0) fail('"options" must be empty for SHORT_ANSWER.');
    if (!correct.every((i) => i === 0)) fail('"correctAnswers" for SHORT_ANSWER must be [] or [0].');
    return {
      type,
      text: text as string,
      textAr: textAr as string,
      options: [],
      optionsAr: [],
      correctAnswers: [],
      ...(hasExplanation ? { explanation: String(explanation), explanationAr: String(explanationAr) } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(imageRef !== undefined ? { imageRef } : {}),
      difficulty,
      ...(category ? { category } : {}),
      ...(tags ? { tags } : {}),
    };
  }

  options = options ?? fail('"options" must contain at least 2 items.');
  if (options.length < 2) fail('"options" must contain at least 2 items.');
  optionsAr = optionsAr ?? fail('"optionsAr" is required — bilingual options are mandatory.');
  if (optionsAr.length !== options.length) {
    fail('"optionsAr" must mirror "options" — same count and order (bilingual options are mandatory).');
  }
  for (let i = 0; i < options.length; i++) {
    if (!isNonEmpty(options[i])) fail(`option ${i + 1} (English) is empty.`);
    if (!isNonEmpty(optionsAr[i])) fail(`option ${i + 1} (Arabic) is empty — every option must be bilingual.`);
    assertNoArtifacts(options[i], `"options[${i}]"`);
    assertArabicQuality(optionsAr[i], `"optionsAr[${i}]"`);
  }

  const correct = Array.isArray(obj.correctAnswers) ? obj.correctAnswers : [];
  if (correct.length === 0) fail('"correctAnswers" must contain at least one index.');
  const seen = new Set<number>();
  for (const i of correct) {
    if (typeof i !== "number" || !Number.isInteger(i) || i < 0 || i >= options.length) {
      fail(`"correctAnswers" index ${String(i)} is out of range for ${options.length} options.`);
    }
    seen.add(i);
  }

  if (type === "TRUE_FALSE") {
    const en = options.map((o) => o.trim().toLowerCase());
    const okTf = en.length === 2 && en.every((o) => o === "true" || o === "false");
    if (!okTf) fail('TRUE_FALSE must have exactly options ["True","False"].');
  }

  return {
    type,
    text: text as string,
    textAr: textAr as string,
    options,
    optionsAr,
    correctAnswers: [...seen],
    ...(hasExplanation ? { explanation: String(explanation), explanationAr: String(explanationAr) } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(imageRef !== undefined ? { imageRef } : {}),
    difficulty,
    ...(category ? { category } : {}),
    ...(tags ? { tags } : {}),
  };
}

// ─── Main entry ──────────────────────────────────────────────────────────────

/**
 * Generate a validated batch of fully bilingual questions from real extracted
 * material text. Throws QuestionGenerationError / QuestionValidationError —
 * never returns partial or monolingual questions.
 */
export async function generateBilingualQuestions(opts: GenerationOptions): Promise<{ questions: GeneratedQuestion[]; model?: string }> {
  const count = Math.max(1, Math.min(MAX_COUNT, opts.count));
  const provider = getAIProvider();
  const excludeTexts = (opts.excludeTexts ?? [])
    .map((s) => String(s).trim())
    .filter((s) => s.length > 0);

  // Ask for more than needed so deduplication can drop repeats without leaving
  // the batch short. A single provider call is faster than retry loops and the
  // model already sees the do-not-repeat list.
  const requestCount = Math.min(MAX_COUNT, Math.ceil(count * 1.5));

  const runGeneration = async (): Promise<{ questions: GeneratedQuestion[]; model?: string }> => {
    const generateOnce = async (): Promise<{ questions: GeneratedQuestion[]; model?: string }> => {
      let raw: string;
      let model: string | undefined;
      try {
        const response = await provider.chat({
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: buildUserPrompt({ ...opts, count: requestCount }) },
          ],
          temperature: 0.4,
          maxTokens: 4000,
          responseFormat: "json",
        });
        raw = response.content;
        model = response.model;
      } catch (e) {
        const cause = e instanceof Error ? e.message : String(e);
        throw new QuestionGenerationError(`AI question generation failed: ${cause}`);
      }

      if (!raw || raw.trim().length === 0) {
        throw new QuestionGenerationError("The AI returned an empty response. Please regenerate.");
      }

      let array: unknown[];
      try {
        array = extractQuestionArray(raw);
      } catch (e) {
        // Log the actual provider output so the root cause is visible in the
        // server logs instead of only a client-side "Invalid JSON response".
        const msg = e instanceof Error ? e.message : String(e);
        console.error(
          `[ai-generate] provider returned non-JSON content (model=${model ?? "?"}). ` +
            `First 1500 chars of raw response >>> ${raw.slice(0, 1500)}`,
        );
        throw new QuestionGenerationError(
          `${msg} [diag model=${model ?? "?"} raw=${raw.slice(0, 1200)}]`,
        );
      }
      if (array.length === 0) {
        throw new QuestionGenerationError("The AI returned no questions. Please regenerate.");
      }

      return { questions: array.map((q, i) => validateGeneratedQuestion(q, i)), model };
    };

    // The openrouter/free router can land on a non-generative model (e.g. a
    // content-safety classifier) whenever the capable free models are busy.
    // Retry a few times with backoff — each attempt may hit a different model —
    // so a single unlucky routing does not fail the whole batch.
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await generateOnce();
      } catch (e) {
        lastError = e;
        console.error(
          `[ai-generate] attempt ${attempt + 1} of 3 failed: ${e instanceof Error ? e.message : String(e)}`,
        );
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
        }
      }
    }
    if (lastError instanceof Error) throw lastError;
    throw new QuestionGenerationError(String(lastError));
  };

  const first = await runGeneration();
  const deduped = dedupeQuestions(first.questions, excludeTexts).slice(0, count);
  const model = first.model;

  // Top-up: if duplicates dropped the batch below the requested count, ask once
  // more with the accepted questions added to the do-not-repeat list.
  if (deduped.length < count) {
    const shortfall = Math.min(count, requestCount);
    const needs = shortfall - deduped.length;
    try {
      const extraOpts: GenerationOptions = {
        ...opts,
        count: needs,
        excludeTexts: [...excludeTexts, ...deduped.map((q) => q.text)],
      };
      const extra = await runGeneration();
      const extraDeduped = dedupeQuestions(extra.questions, extraOpts.excludeTexts ?? []);
      return {
        model,
        questions: dedupeQuestions([...deduped, ...extraDeduped], excludeTexts).slice(0, count),
      };
    } catch {
      // The first batch is still valid — return it rather than failing the UI.
      return { model, questions: deduped };
    }
  }

  return { model, questions: deduped };
}

// ─── Draft → persisted question mapping (used by the approve route) ─────────

export interface QuestionPersistMeta {
  courseId: string;
  materialId: string;
  testType: "PRE_TEST" | "FINAL_TEST";
  aiModel?: string | null;
  aiPrompt?: string | null;
  createdBy: string;
}

/** Map a validated GeneratedQuestion to Question.create data. */
export function toQuestionCreateData(question: GeneratedQuestion, meta: QuestionPersistMeta) {
  return {
    courseId: meta.courseId,
    materialId: meta.materialId,
    type: question.type,
    testType: meta.testType,
    text: question.text,
    textAr: question.textAr,
    options: JSON.stringify(question.options),
    optionsAr: JSON.stringify(question.optionsAr),
    correctAnswers: JSON.stringify(question.correctAnswers),
    points: 1,
    order: 1,
    isActive: true,
    category: question.category ?? null,
    difficulty: question.difficulty,
    tags: question.tags ? JSON.stringify(question.tags) : null,
    imageUrl: question.imageUrl ?? null,
    source: "AI_GENERATED" as const,
    aiGeneratedAt: new Date(),
    aiModel: meta.aiModel ?? null,
    aiPrompt: meta.aiPrompt ?? null,
    createdBy: meta.createdBy,
    updatedBy: meta.createdBy,
  };
}
