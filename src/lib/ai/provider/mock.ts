// ─────────────────────────────────────────────────────────────────────────────
// Mock AI Provider — deterministic, offline question-generation backend
// ─────────────────────────────────────────────────────────────────────────────
// Used ONLY when AI_MOCK_ENABLED=true (or AI_MOCK=1). It lets the full
// AI Question Generator pipeline (extract real material text → clean → prompt →
// parse → strict bilingual validation → approve into the Question Bank) be
// exercised end-to-end without API keys, and makes the manual demo work on any
// machine.
//
// It behaves like a small LLM: it reads the generator's prompt markers
// (REQUESTED_COUNT / ALLOWED_TYPES / DIFFICULTY and the SOURCE_TEXT_BEGIN/END
// block), and builds one question per requested item whose English side is a
// real sentence from the cleaned material.
//
// IMPORTANT — the Arabic side is REAL Arabic text, never a verbatim copy of the
// English sentence. The product rule is "English + Arabic", never "English +
// copied English" (an earlier version of this mock committed exactly that bug).
// This mock renders the Arabic side through a set of professional bilingual
// topic templates (electrical safety / OSH), so the demo output is genuinely
// bilingual. It is intentionally template-based: a real provider (Gemini /
// OpenAI) running the generator's translation-quality rules produces true
// per-sentence professional Arabic; this mock only demonstrates the pipeline,
// the bilingual contract, and the strict validation that blocks pasted English.
import type { AIProvider, ChatRequest, ChatResponse, ProviderCapabilities } from "./types";
import { DO_NOT_REPEAT_TEXT_BEGIN, DO_NOT_REPEAT_TEXT_END, FIGURES_BEGIN, FIGURES_END } from "@/lib/ai/prompt-markers";

const CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  toolCalling: false,
  structuredOutput: true,
  imageUnderstanding: false,
  fileAnalysis: true,
  conversationMemory: false,
  tokenCounting: false,
};

const MODEL_ID = "mock-bilingual-generator";

const MAX_QUESTIONS = 100;
const QUESTION_TYPES = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"] as const;
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;

// ─── Prompt-marker parsing ───────────────────────────────────────────────────

function markerValue(content: string, name: string): string | null {
  const m = new RegExp(`^\\s*${name}\\s*:\\s*(.*)$`, "m").exec(content);
  return m?.[1]?.trim() ?? null;
}

function extractSourceText(content: string): string | null {
  const m = /SOURCE_TEXT_BEGIN\s*([\s\S]*?)\s*SOURCE_TEXT_END/.exec(content);
  return m?.[1]?.trim() ?? null;
}

export function splitSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 300 && /\s/.test(s) && /[A-Za-z]{2}/.test(s))
    // Drop TOC / all-caps header lines (pure layout noise).
    .filter((s) => !(s.length < 45 && /^[A-Z0-9\s&/()\-.,'"’]+$/.test(s)))
    // Drop running headers/footers repeated on every page.
    .filter((s) => !/TEXTBOOK\/WORKBOOK|TABLE OF CONTENTS|LESSON DESCRIPTION PAGE|Pacing Schedule|Course Target Competency|N ational G rid|Course Introduction/i.test(s))
    .map((s) => s.replace(/^[-*•▪\d.\s]+/, "").trim());

  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of parts) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

// ─── Do-not-repeat + figures parsing ─────────────────────────────────────────

/** Stems the generator marked as already-existing (question bank / drafts). */
function extractExcludedStems(content: string): string[] {
  const m = new RegExp(`${DO_NOT_REPEAT_TEXT_BEGIN}\\s*([\\s\\S]*?)\\s*${DO_NOT_REPEAT_TEXT_END}`).exec(content);
  if (!m) return [];
  return m[1]
    .split("\n")
    .map((l) => l.trim().replace(/^-\s*/, "").replace(/^"(.*)"\s*$/, "$1").trim())
    .filter((l) => l.length > 0);
}

interface MockFigure {
  index: number;
  page: number;
  pageText: string;
  caption?: string;
  surroundText?: string;
}

/**
 * Figures the generator listed as "[index] page N: <page text>" plus optional
 * "[index|caption] ..." and "[index|around] ..." lines.
 */
function extractFigures(content: string): MockFigure[] {
  const m = new RegExp(`${FIGURES_BEGIN}\\s*([\\s\\S]*?)\\s*${FIGURES_END}`).exec(content);
  if (!m) return [];
  const out: MockFigure[] = [];
  const captions = new Map<number, string>();
  const around = new Map<number, string>();
  for (const line of m[1].split("\n")) {
    const cap = /^\[(\d+)\|caption\]\s*(.*)$/.exec(line.trim());
    if (cap) {
      captions.set(Number(cap[1]), cap[2]);
      continue;
    }
    const ar = /^\[(\d+)\|around\]\s*(.*)$/.exec(line.trim());
    if (ar) {
      around.set(Number(ar[1]), ar[2]);
      continue;
    }
    const mm = /^\[(\d+)\]\s*page\s*(\d+):\s*(.*)$/.exec(line.trim());
    if (mm) {
      out.push({ index: Number(mm[1]), page: Number(mm[2]), pageText: mm[3] ?? "" });
    }
  }
  for (const f of out) {
    const c = captions.get(f.index);
    const a = around.get(f.index);
    if (c) f.caption = c;
    if (a) f.surroundText = a;
  }
  return out;
}

function mockTokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length >= 4),
  );
}

function mockSimilarity(a: string, b: string): number {
  const ta = mockTokens(a);
  const tb = mockTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** True when the sentence repeats (verbatim or near-verbatim) an excluded stem. */
function isExcluded(sentence: string, excludes: string[]): boolean {
  const norm = sentence.toLowerCase().replace(/\s+/g, " ").trim();
  return excludes.some((e) => norm === e.toLowerCase() || mockSimilarity(sentence, e) >= 0.55);
}

// Words that indicate a fact is about something VISUAL (a figure/diagram/sign/
// table/equipment photo). "Same page" proximity is never enough — the sentence
// itself must describe visual content for a figure to be attached without a
// matching caption.
const VISUAL_KEYWORDS =
  /figure|diagram|chart|table|sign\b|warning\b|label|symbol|schematic|drawing|photo|image|illustration|shown|depicts|glove|helmet|goggles|harness|ladder|extinguisher|mask\b/i;

/**
 * The figure the question is GENUINELY built on — not the closest one on the
 * page. Evidence is required, strongest first:
 *   1. The figure's caption shares ≥30% of the sentence's content words.
 *   2. The sentence describes visual content AND the figure's caption +
 *      surrounding + page text covers ≥70% of its content words.
 * Returns undefined when there is no caption overlap and no visual-language
 * evidence — in that case the question must stay image-less.
 */
function relevantFigureIndex(sentence: string, figures: MockFigure[], used: Set<number>): number | undefined {
  if (figures.length === 0) return undefined;
  const sent = mockTokens(sentence);
  if (sent.size < 3) return undefined;

  const scored = figures
    .map((f) => {
      const haystack = [f.caption, f.surroundText, f.pageText].filter(Boolean).join(" ");
      const page = mockTokens(haystack);
      let hits = 0;
      for (const t of sent) if (page.has(t)) hits += 1;
      const score = page.size === 0 ? 0 : hits / sent.size;
      let capHits = 0;
      if (f.caption) {
        const cap = mockTokens(f.caption);
        for (const t of sent) if (cap.has(t)) capHits += 1;
        capHits = cap.size === 0 ? 0 : capHits / sent.size;
      }
      return { f, score, capHits };
    })
    .sort((a, b) => b.score - a.score);

  for (const { f, score, capHits } of scored) {
    if (used.has(f.index)) continue;
    if (score < 0.6) return undefined; // sorted desc — nothing else qualifies
    if (capHits >= 0.3) return f.index;
    if (VISUAL_KEYWORDS.test(sentence) && score >= 0.7) return f.index;
  }
  return undefined;
}

// ─── Bilingual topic templates ───────────────────────────────────────────────
// Each template maps a detected topic onto several REAL, natural Arabic and
// English renderings. Questions rotate through the variants so a batch never
// repeats the same Arabic stem or the same correct answer — even when several
// sentences belong to the same topic. First topic whose `detect` regex matches
// the sentence wins; `general` is the fallback and must be declared last.

type TopicDifficulty = (typeof DIFFICULTIES)[number];

interface TopicVariant {
  en: string;
  ar: string;
}

/** 4 Arabic question stems per difficulty level (index-matched to the trues). */
interface TopicStemGroup {
  easy: string[];
  medium: string[];
  hard: string[];
}

/** 4 English+Arabic true statements per difficulty level. */
interface TopicTrueGroup {
  easy: TopicVariant[];
  medium: TopicVariant[];
  hard: TopicVariant[];
}

interface TopicTemplate {
  id: string;
  detect: RegExp;
  enTopic: string;
  arTopic: string;
  /** 12 Arabic question stems — 4 EASY + 4 MEDIUM + 4 HARD (never cycled via %3). */
  arStems: TopicStemGroup;
  /**
   * 12 English question stems, INDEX-MATCHED to arStems (same difficulty, same
   * index = the same question in both languages). Each enStem is the exact
   * English counterpart of its arStem, so the pair is a faithful bilingual
   * question. The generator matches each source sentence to the enStem whose
   * subject is closest and renders the ARABIC side from that stem — which makes
   * the Arabic question always ask about the SAME fact the English sentence
   * states, instead of a canned per-topic stem that drifts off-subject.
   */
  enStems: TopicStemGroup;
  /** 12 English+Arabic true statements — 4 per difficulty, one per stem index. */
  trues: TopicTrueGroup;
  /** English+Arabic false statements (distractors). Topic-scoped, never reused within a question. */
  wrongs: TopicVariant[];
  explAr: string;
}

export const TOPICS: TopicTemplate[] = [
  {
    id: "ppe",
    detect: /personal protective equipment|\bppe\b|protective equipment|gloves|helmet|goggles|face shield/i,
    enTopic: "personal protective equipment (PPE)",
    arTopic: "معدات الوقاية الشخصية",
    arStems: {
      easy: [
        "ما الذي يجب على العامل فعله وفقًا للمادة عند العمل على أنظمة كهربائية مكهربة؟",
        "كيف يجب اختيار معدات الوقاية الشخصية وفقًا للمادة؟",
        "ماذا يعني ارتداء معدات الوقاية الشخصية بالنسبة لإجراءات العمل الآمنة وفقًا للمادة؟",
        "ماذا تحمي الخوذ والنظارات الواقية وفقًا للمادة؟",
      ],
      medium: [
        "ما الذي يجب على العامل فعله بمعدات الوقاية الشخصية قبل كل استخدام؟",
        "كيف يجب اختيار القفازات الواقية وفقًا للمادة؟",
        "ماذا يجب أن يفعل العامل بمعدات الوقاية الشخصية البالية أو التالفة؟",
        "ما المتطلب التدريبي المرتبط بمعدات الوقاية الشخصية وفقًا للمادة؟",
      ],
      hard: [
        "لماذا لا يُكتفى بمعدات الوقاية الشخصية عند العمل على الأنظمة المكهربة؟",
        "ما الترتيب الصحيح لإجراءات الحماية وفقًا للمادة؟",
        "كيف تعمل معدات الوقاية الشخصية إلى جانب الضوابط الهندسية وفقًا للمادة؟",
        "قارن بين عزل الطاقة وارتداء المعدات الواقية وفقًا للمادة.",
      ],
    },
    enStems: {
      easy: [
        "What must a worker do according to the material when working on live electrical systems?",
        "How must personal protective equipment be selected according to the material?",
        "What does wearing PPE mean for safe working procedures according to the material?",
        "What do helmets and goggles protect according to the material?",
      ],
      medium: [
        "What must a worker do with PPE before each use?",
        "How must protective gloves be selected according to the material?",
        "What must a worker do with worn-out or damaged PPE?",
        "What training requirement relates to PPE according to the material?",
      ],
      hard: [
        "Why is PPE not enough when working on live systems?",
        "What is the correct order of protection measures according to the material?",
        "How does PPE work alongside engineering controls according to the material?",
        "Compare isolating energy with wearing protective equipment according to the material.",
      ],
    },
    trues: {
      easy: [
        { en: "Workers must wear appropriate personal protective equipment when working on live electrical systems.", ar: "يجب على العمال ارتداء معدات الوقاية الشخصية المناسبة عند العمل على الأنظمة الكهربائية المكهربة." },
        { en: "The PPE used must be matched to the hazards of the specific task.", ar: "يجب أن تتوافق معدات الوقاية الشخصية المستخدمة مع أخطار المهمة المحددة." },
        { en: "Wearing PPE does not replace the need to follow safe working procedures.", ar: "ارتداء معدات الوقاية الشخصية لا يغني عن اتباع إجراءات العمل الآمنة." },
        { en: "Helmets and goggles protect workers from falling objects and flying particles.", ar: "تحمي الخوذ والنظارات الواقية العمال من الأجسام المتساقطة والجزيئات المتطايرة." },
      ],
      medium: [
        { en: "A worker must inspect their PPE for damage before each use.", ar: "يجب على العامل فحص معدات الوقاية الشخصية بحثًا عن أي تلف قبل كل استخدام." },
        { en: "Gloves must be selected according to the electrical hazards of the task.", ar: "يجب اختيار القفازات وفقًا للأخطار الكهربائية للمهمة." },
        { en: "PPE that is worn out or damaged must be replaced immediately.", ar: "يجب استبدال معدات الوقاية الشخصية البالية أو التالفة فورًا." },
        { en: "Workers must be trained on how to put on and adjust their PPE correctly.", ar: "يجب تدريب العمال على كيفية ارتداء معدات الوقاية الشخصية وضبطها بشكل صحيح." },
      ],
      hard: [
        { en: "PPE protects only the wearer, so power must still be isolated before live work.", ar: "تحمي معدات الوقاية الشخصية مرتديها فقط، لذا يجب عزل الطاقة قبل العمل المكهرب." },
        { en: "Engineering controls take priority and PPE is the last line of defence.", ar: "تأخذ الضوابط الهندسية الأولوية وتُعد معدات الوقاية الشخصية خط الدفاع الأخير." },
        { en: "PPE supplements engineering controls against hazards that cannot be fully removed.", ar: "تُكمل معدات الوقاية الشخصية الضوابط الهندسية تجاه الأخطار التي لا يمكن إزالتها بالكامل." },
        { en: "Isolating energy removes the hazard, whereas PPE only reduces the risk of injury.", ar: "عزل الطاقة يزيل الخطر، بينما تقلل معدات الوقاية الشخصية من خطر الإصابة فقط." },
      ],
    },
    wrongs: [
      { en: "PPE is optional for tasks assessed as low risk.", ar: "معدات الوقاية الشخصية اختيارية في المهام المقيَّمة بأنها منخفضة الخطورة." },
      { en: "Any type of PPE is suitable for every electrical task.", ar: "أي نوع من معدات الوقاية الشخصية يصلح لجميع المهام الكهربائية." },
      { en: "Wearing PPE removes the requirement for safe working procedures.", ar: "ارتداء معدات الوقاية الشخصية يلغي اشتراط إجراءات العمل الآمنة." },
      { en: "Damaged PPE can still be used as long as it looks clean.", ar: "يمكن استخدام معدات الوقاية الشخصية التالفة ما دامت تبدو نظيفة." },
      { en: "PPE may be shared between workers without cleaning.", ar: "يمكن تداول معدات الوقاية الشخصية بين العمال دون تنظيف." },
      { en: "Training is unnecessary for workers who already have PPE.", ar: "لا حاجة للتدريب بالنسبة للعمال الذين يمتلكون معدات الوقاية الشخصية." },
      { en: "Only the supervisor must wear PPE on site.", ar: "المشرف هو الشخص الوحيد الذي يجب أن يرتدي معدات الوقاية الشخصية في الموقع." },
      { en: "Face shields are only required for welding tasks.", ar: "لا تُشترط واقيات الوجه إلا في أعمال اللحام." },
    ],
    explAr: "تنص المادة على إلزامية ارتداء معدات الوقاية الشخصية المناسبة عند العمل على الأنظمة المكهربة، مع مراعاة مطابقتها لأخطار المهمة دون أن تُغني عن الإجراءات الآمنة.",
  },
  {
    id: "fire",
    detect: /fire|extinguisher|smoke|flammable|combustible/i,
    enTopic: "fire safety",
    arTopic: "السلامة من الحرائق",
    arStems: {
      easy: [
        "ما المطلوب وفقًا للمادة فيما يتعلق بطفايات الحريق؟",
        "ما الالتزام المفروض على جميع العمال فيما يتعلق بالحرائق وفقًا للمادة؟",
        "أين يجب توفير بطانية الحريق وفقًا للمادة؟",
        "من يجب تدريبه لقيادة عمليات الإخلاء وفقًا للمادة؟",
      ],
      medium: [
        "كيف يجب تخزين المواد القابلة للاشتعال وفقًا للمادة؟",
        "ما الذي يجب فعله بطفاية الحريق بعد كل استخدام وفقًا للمادة؟",
        "ما القاعدة المتعلقة بصنابير الحريق وفقًا للمادة؟",
        "ما الإجراء الصحيح تجاه طفاية حريق استُخدمت في الإطفاء وفقًا للمادة؟",
      ],
      hard: [
        "لماذا يجب اختبار كاشفات الدخان والحرارة بانتظام وفقًا للمادة؟",
        "ما السبب في إبقاء مسارات الهروب خالية دائمًا وفقًا للمادة؟",
        "ما الإجراء الصحيح تجاه الغبار القابل للاشتعال وفقًا للمادة؟",
        "كيف يجب حفظ السوائل القابلة للاشتعال وفقًا للمادة؟",
      ],
    },
    enStems: {
      easy: [
        "What is required according to the material regarding fire extinguishers?",
        "What obligation applies to all workers regarding fires according to the material?",
        "Where must a fire blanket be provided according to the material?",
        "Who must be trained to lead evacuations according to the material?",
      ],
      medium: [
        "How must flammable materials be stored according to the material?",
        "What must be done with a fire extinguisher after every use according to the material?",
        "What rule applies to fire hydrants according to the material?",
        "What is the correct action for a fire extinguisher that has been discharged?",
      ],
      hard: [
        "Why must smoke and heat detectors be tested regularly according to the material?",
        "Why must escape routes be kept clear at all times according to the material?",
        "What is the correct action for combustible dust according to the material?",
        "How must flammable liquids be kept according to the material?",
      ],
    },
    trues: {
      easy: [
        { en: "Fire extinguishers must be kept accessible and inspected regularly.", ar: "يجب أن تكون طفايات الحريق في متناول اليد وتُفحص بانتظام." },
        { en: "Fire drills must be practiced by all workers at least once a year.", ar: "يجب على جميع العمال ممارسة تدريبات الإخلاء مرة واحدة سنويًا على الأقل." },
        { en: "A fire blanket should be available in areas where cooking takes place.", ar: "يجب توفير بطانية الحريق في المناطق التي يُطبخ فيها." },
        { en: "Fire wardens must be trained to lead evacuations during an emergency.", ar: "يجب تدريب مشرفي السلامة من الحرائق لقيادة عمليات الإخلاء أثناء الطوارئ." },
      ],
      medium: [
        { en: "Flammable materials must be stored away from sources of heat.", ar: "يجب تخزين المواد القابلة للاشتعال بعيدًا عن مصادر الحرارة." },
        { en: "Fire extinguishers must be tagged with an inspection date after every use.", ar: "يجب وضع علامة بتاريخ الفحص على طفاية الحريق بعد كل استخدام." },
        { en: "Fire hydrants must not be blocked by parked vehicles or stored goods.", ar: "يجب ألا تُحجب صنابير الحريق بالمركبات المتوقفة أو البضائع المخزنة." },
        { en: "Fire extinguishers should be refilled immediately after any discharge.", ar: "يجب إعادة تعبئة طفايات الحريق فورًا بعد أي عملية إطفاء." },
      ],
      hard: [
        { en: "Smoke and heat detectors must be tested routinely because they warn of fire before it spreads.", ar: "يجب اختبار كاشفات الدخان والحرارة بانتظام لأنها تنذر بالحريق قبل انتشاره." },
        { en: "Fire escape routes must remain clear so that everyone can evacuate quickly.", ar: "يجب أن تبقى مسارات الهروب خالية حتى يتمكن الجميع من الإخلاء بسرعة." },
        { en: "Combustible dust must be cleaned up promptly to prevent it from igniting.", ar: "يجب تنظيف الغبار القابل للاشتعال فورًا لمنع اشتعاله." },
        { en: "Flammable liquids must be kept in approved containers with clear labels to prevent misuse.", ar: "يجب حفظ السوائل القابلة للاشتعال في حاويات معتمدة ذات ملصقات واضحة لمنع سوء الاستخدام." },
      ],
    },
    wrongs: [
      { en: "Fire extinguishers only need checking when a fire breaks out.", ar: "لا تُفحص طفايات الحريق إلا عند وقوع حريق." },
      { en: "Flammable materials may be stored near heat sources.", ar: "يمكن تخزين المواد القابلة للاشتعال بالقرب من مصادر الحرارة." },
      { en: "Fire safety checks are the responsibility of visitors only.", ar: "فحوصات السلامة من الحرائق مسؤولية الزوار فقط." },
      { en: "Fire escape routes may be used for storage when space is tight.", ar: "يمكن استخدام مسارات الهروب للتخزين عند ضيق المساحة." },
      { en: "Smoke detectors only need testing once every five years.", ar: "لا تُختبر كاشفات الدخان إلا مرة كل خمس سنوات." },
      { en: "Fire drills are optional for experienced workers.", ar: "تدريبات الإخلاء من الحرائق اختيارية للعمال ذوي الخبرة." },
      { en: "A fire blanket is only needed in industrial kitchens.", ar: "لا تُشترط بطانية الحريق إلا في المطابخ الصناعية." },
      { en: "Fire extinguishers can be refilled at any time after a discharge.", ar: "يمكن إعادة تعبئة طفاية الحريق في أي وقت بعد الإطفاء." },
    ],
    explAr: "تشدد المادة على إتاحة طفايات الحريق وفحصها دوريًا، وتخزين المواد القابلة للاشتعال بعيدًا عن مصادر الحرارة.",
  },
  {
    id: "shock",
    detect: /electric shock|live parts|live conductor|de-energi|energis|isolat|proved dead|dead before/i,
    enTopic: "electric shock protection",
    arTopic: "الوقاية من الصدمة الكهربائية",
    arStems: {
      easy: [
        "ما الإجراء الصحيح قبل البدء بالعمل على موصلات كهربائية وفقًا للمادة؟",
        "ماذا قد تُحدث الصدمة الكهربائية وفقًا للمادة؟",
        "متى يُسمح بالعمل على الأجزاء المكهربة وفقًا للمادة؟",
        "ما الذي يميز جسم الإنسان فيما يتعلق بالكهرباء وفقًا للمادة؟",
      ],
      medium: [
        "ما الذي يجب على العامل التحقق منه قبل لمس أي دائرة وفقًا للمادة؟",
        "متى يجب إعادة اختبار الدائرة وفقًا للمادة؟",
        "من المسموح له العمل على الأجزاء المكهربة وفقًا للمادة؟",
        "ما فائدة إجراءات الإقفال أثناء العمل وفقًا للمادة؟",
      ],
      hard: [
        "قارن بين العزل والعازل وفقًا للمادة.",
        "متى تكون الصدمة الكهربائية في أشد خطورتها وفقًا للمادة؟",
        "لماذا يجب التحقق من انعدام الجهد حتى عند إيقاف تشغيل المفتاح وفقًا للمادة؟",
        "ما الإجراء الذي يحمي العمال الآخرين القريبين من منطقة العمل وفقًا للمادة؟",
      ],
    },
    enStems: {
      easy: [
        "What is the correct step before starting work on electrical conductors according to the material?",
        "What can an electric shock do according to the material?",
        "When is work on live parts permitted according to the material?",
        "What is true of the human body regarding electricity according to the material?",
      ],
      medium: [
        "What must a worker check before touching any circuit according to the material?",
        "When must a circuit be re-tested according to the material?",
        "Who is allowed to work on live parts according to the material?",
        "What is the benefit of lockout procedures during work according to the material?",
      ],
      hard: [
        "Compare isolation and insulation according to the material.",
        "When is an electric shock most dangerous according to the material?",
        "Why must the absence of voltage be proved even when the switch is off according to the material?",
        "What measure protects other workers near the work area according to the material?",
      ],
    },
    trues: {
      easy: [
        { en: "Live conductors must be isolated and proved dead before work begins.", ar: "يجب عزل الموصلات المكهربة والتحقق من انعدام الجهد قبل بدء العمل." },
        { en: "Electric shock can affect more than the person doing the work.", ar: "قد تؤثر الصدمة الكهربائية على أكثر من الشخص الذي ينفذ العمل." },
        { en: "Work on live parts must only happen after the energy is removed.", ar: "يُسمح بالعمل على الأجزاء المكهربة فقط بعد إزالة الطاقة." },
        { en: "The human body conducts electricity.", ar: "جسم الإنسان يوصل الكهرباء." },
      ],
      medium: [
        { en: "Before touching a circuit, a worker must prove it is dead.", ar: "يجب على العامل التحقق من انعدام الجهد في الدائرة قبل لمسها." },
        { en: "A circuit must be re-tested after it is isolated and before work starts.", ar: "يجب إعادة اختبار الدائرة بعد عزلها وقبل بدء العمل." },
        { en: "Only authorised persons may work on or near live parts.", ar: "لا يجوز العمل على الأجزاء المكهربة أو بالقرب منها إلا للأشخاص المصرح لهم." },
        { en: "Lockout procedures prevent accidental re-energising while work is in progress.", ar: "تمنع إجراءات الإقفال إعادة التغذية العرضية أثناء سير العمل." },
      ],
      hard: [
        { en: "Isolation removes the hazard entirely, whereas insulation only reduces the risk.", ar: "العزل يزيل الخطر بالكامل، بينما يقلل العازل الخطر فقط." },
        { en: "The most serious shocks occur when a current passes through the heart.", ar: "تحدث أخطر الصدمات عندما يمر التيار عبر القلب." },
        { en: "Switches can fail or be closed by accident, so a test proves the circuit is actually dead.", ar: "قد تتعطل المفاتيح أو تُغلق بالخطأ، لذا يثبت الاختبار أن الدائرة غير مكهربة فعليًا." },
        { en: "Barriers and warning signs keep people away from live parts.", ar: "تحفظ الحواجز واللافتات التحذيرية الأشخاص بعيدًا عن الأجزاء المكهربة." },
      ],
    },
    wrongs: [
      { en: "Working near live parts requires no additional precautions.", ar: "لا يتطلب العمل بالقرب من الأجزاء المكهربة أي احتياطات إضافية." },
      { en: "Electric shock can only harm the person carrying out the work.", ar: "لا تضر الصدمة الكهربائية إلا الشخص الذي ينفذ العمل." },
      { en: "Proving a circuit dead is optional when the task is short.", ar: "التحقق من انعدام الجهد أمر اختياري في المهام القصيرة." },
      { en: "An open switch guarantees the circuit is dead.", ar: "يضمن فتح المفتاح انعدام الجهد في الدائرة." },
      { en: "Rubber gloves make it safe to touch any live conductor.", ar: "تجعل القفازات المطاطية لمس أي موصل مكهرب أمرًا آمنًا." },
      { en: "Live work is permitted for anyone who has completed the induction.", ar: "يُسمح بالعمل المكهرب لأي شخص أكمل التدريب التعريفي." },
      { en: "Lockout is only needed during maintenance, not installation.", ar: "لا يُشترط الإقفال إلا أثناء الصيانة وليس أثناء التركيب." },
      { en: "Once isolated, a circuit can never become live again.", ar: "لا يمكن أن تصبح الدائرة مكهربة مجددًا بعد عزلـها." },
    ],
    explAr: "تؤكد المادة على عزل الأجزاء المكهربة والتحقق من انعدام الجهد قبل العمل، وإمكانية إصابة الآخرين بالصدمة الكهربائية.",
  },
  {
    id: "voltage",
    detect: /voltage|approach distance|overhead line|transmission|substation|\bkV\b|high voltage/i,
    enTopic: "safe working near high voltage",
    arTopic: "العمل الآمن بالقرب من الجهد العالي",
    arStems: {
      easy: [
        "ما الذي يجب على العمال مراعاته بالقرب من الخطوط الهوائية وفقًا للمادة؟",
        "على من تنطبق مسافة الاقتراب الدنيا وفقًا للمادة؟",
        "كيف تُعامل خطوط الطاقة الهوائية ما لم يُثبت خلاف ذلك وفقًا للمادة؟",
        "ما الذي يمكن أن يفعله الجهد العالي دون ملامسة الخط وفقًا للمادة؟",
      ],
      medium: [
        "كيف يجب تخطيط المهام بالقرب من الخطوط الهوائية وفقًا للمادة؟",
        "ما الذي يجب على المشرف التحقق منه قبل العمل بالقرب من الخطوط الهوائية وفقًا للمادة؟",
        "ما الذي يجب فعله بالسلالم والرافعات بالقرب من الموصلات الهوائية وفقًا للمادة؟",
        "من الذي يجب الاتصال به قبل العمل بالقرب من خطوط الطاقة وفقًا للمادة؟",
      ],
      hard: [
        "لماذا يجب الحفاظ على مسافة الاقتراب حتى دون ملامسة الخط وفقًا للمادة؟",
        "ما مجموعة إجراءات التحكم المطلوبة عند العمل بالقرب من الجهد العالي وفقًا للمادة؟",
        "كيف تتغير مسافة الاقتراب مع ارتفاع الجهد وفقًا للمادة؟",
        "ما الإجراء الواجب عند تشغيل الرافعات بالقرب من الخطوط الهوائية وفقًا للمادة؟",
      ],
    },
    enStems: {
      easy: [
        "What must workers observe near overhead lines according to the material?",
        "Whom does the minimum approach distance apply to according to the material?",
        "How are overhead power lines treated unless proved otherwise according to the material?",
        "What can high voltage do without touching the line according to the material?",
      ],
      medium: [
        "How must tasks near overhead lines be planned according to the material?",
        "What must the supervisor check before working near overhead lines according to the material?",
        "What must be done with ladders and cranes near overhead conductors according to the material?",
        "Who must be contacted before working near power lines according to the material?",
      ],
      hard: [
        "Why must the approach distance be kept even without touching the line according to the material?",
        "What set of control measures is required when working near high voltage according to the material?",
        "How does the approach distance change as the voltage rises according to the material?",
        "What action is required when operating cranes near overhead lines according to the material?",
      ],
    },
    trues: {
      easy: [
        { en: "Workers must keep the safe approach distance from overhead lines.", ar: "يجب على العمال الحفاظ على مسافة الاقتراب الآمنة من الخطوط الهوائية." },
        { en: "The minimum approach distance applies to all workers on site.", ar: "تنطبق مسافة الاقتراب الدنيا على جميع العمال في الموقع." },
        { en: "Overhead power lines are always treated as live unless proved otherwise.", ar: "تُعامل خطوط الطاقة الهوائية دائمًا كمكهربة ما لم يُثبت خلاف ذلك." },
        { en: "High voltage can jump across a gap without touching the line.", ar: "يمكن للجهد العالي أن يقفز عبر الفجوة دون ملامسة الخط." },
      ],
      medium: [
        { en: "Workers must plan their tasks so that equipment never enters the approach zone.", ar: "يجب على العمال تخطيط مهامهم بحيث لا تدخل المعدات منطقة الاقتراب أبدًا." },
        { en: "Before working near overhead lines, the supervisor must confirm the approach distance.", ar: "قبل العمل بالقرب من الخطوط الهوائية، يجب على المشرف التأكد من مسافة الاقتراب." },
        { en: "Ladders and cranes must be kept away from overhead conductors.", ar: "يجب إبعاد السلالم والرافعات عن الموصلات الهوائية." },
        { en: "The utility provider must be contacted before working close to power lines.", ar: "يجب الاتصال بمزود الكهرباء قبل العمل بالقرب من خطوط الطاقة." },
      ],
      hard: [
        { en: "Electricity can arc across the gap, so distance is the only safe defence.", ar: "يمكن للكهرباء أن تقفز عبر الفجوة، لذا تُعد المسافة خط الدفاع الآمن الوحيد." },
        { en: "A safe work plan, the correct distance, and an authorised supervisor are all required.", ar: "يُشترط جميعًا خطة عمل آمنة ومسافة صحيحة ومشرف مصرح له." },
        { en: "A higher line voltage requires a larger approach distance.", ar: "يتطلب الجهد الأعلى للخط مسافة اقتراب أكبر." },
        { en: "A spotter must guide cranes and lifting equipment near overhead lines.", ar: "يجب أن يوجه مراقب متخصص الرافعات ومعدات الرفع بالقرب من الخطوط الهوائية." },
      ],
    },
    wrongs: [
      { en: "There is no minimum approach distance for trained personnel.", ar: "لا توجد مسافة دنيا للاقتراب بالنسبة للأفراد المدربين." },
      { en: "Overhead lines are safe to touch when the weather is dry.", ar: "من الآمن لمس الخطوط الهوائية عندما يكون الطقس جافًا." },
      { en: "Only workers above a certain grade must respect approach distances.", ar: "لا يلتزم بمسافات الاقتراب إلا العمال من درجة معينة." },
      { en: "Rubber-tyred vehicles may pass under lines at any height.", ar: "يمكن للمركبات ذات العجلات المطاطية المرور تحت الخطوط مهما كان ارتفاعها." },
      { en: "A visible gap between a ladder and the line means there is no danger.", ar: "وجود فجوة ظاهرة بين السلَّم والخط يعني انعدام الخطر." },
      { en: "Approach distances are the same for all voltage levels.", ar: "مسافات الاقتراب متساوية لجميع مستويات الجهد." },
      { en: "Work near overhead lines requires no prior planning.", ar: "لا يتطلب العمل بالقرب من الخطوط الهوائية أي تخطيط مسبق." },
      { en: "The utility provider must only be notified after work is complete.", ar: "لا يُخطر مزود الكهرباء إلا بعد انتهاء العمل." },
    ],
    explAr: "تحدد المادة مسافة اقتراب آمنة إلزامية من الخطوط الهوائية ومنشآت الجهد العالي، وتنطبق على جميع العاملين.",
  },
  {
    id: "permit",
    detect: /permit to work|work permit|\bpermit\b|authoris|authorized|competent person|qualified/i,
    enTopic: "authorization for electrical work",
    arTopic: "التصريح بالعمل على الأنظمة الكهربائية",
    arStems: {
      easy: [
        "من المسموح له بتنفيذ العمل الكهربائي وفقًا للمادة؟",
        "ما الشرط المطلوب قبل البدء بالعمل المكهرب وفقًا للمادة؟",
        "ما الذي يجب على الشخص المصرح له التحقق منه قبل البدء وفقًا للمادة؟",
        "ماذا يُوثق تصريح العمل وفقًا للمادة؟",
      ],
      medium: [
        "من يجب أن يوقَّع تصريح العمل وفقًا للمادة؟",
        "ماذا يجب فعله عندما تتغير شروط التصريح وفقًا للمادة؟",
        "متى يُصدر تصريح العمل وفقًا للمادة؟",
        "ماذا يجب على حامل التصريح فعله عند انتهاء العمل وفقًا للمادة؟",
      ],
      hard: [
        "لماذا يجب إلغاء التصريح عند توقف العمل لفترة طويلة وفقًا للمادة؟",
        "كيف يحمي تصريح العمل الأشخاص وفقًا للمادة؟",
        "ما إجراء التسليم المطلوب عند بدء وردية جديدة وفقًا للمادة؟",
        "متى يجب إعادة التحقق من منطقة العمل وفقًا للمادة؟",
      ],
    },
    enStems: {
      easy: [
        "Who is allowed to carry out electrical work according to the material?",
        "What condition is required before live work begins according to the material?",
        "What must the authorised person check before starting according to the material?",
        "What does the work permit record according to the material?",
      ],
      medium: [
        "Who must sign the work permit according to the material?",
        "What must be done when the conditions of the permit change according to the material?",
        "When is the work permit issued according to the material?",
        "What must the permit holder do when the work is finished according to the material?",
      ],
      hard: [
        "Why must the permit be cancelled when work stops for a long period according to the material?",
        "How does the work permit protect people according to the material?",
        "What handover is required when a new shift starts according to the material?",
        "When must the work area be checked again according to the material?",
      ],
    },
    trues: {
      easy: [
        { en: "Electrical work must only be carried out by competent, authorised persons.", ar: "يجب ألا يُنفَّذ العمل الكهربائي إلا أشخاص مؤهلون ومصرح لهم." },
        { en: "A valid work permit is required before live work starts.", ar: "يُشترط الحصول على تصريح عمل سارٍ قبل البدء بالعمل المكهرب." },
        { en: "The authorised person must confirm the work area is safe before starting.", ar: "يجب على الشخص المصرح له التأكد من سلامة منطقة العمل قبل البدء." },
        { en: "A work permit records the scope and conditions of the job.", ar: "يُوثق تصريح العمل نطاق المهمة وشروطها." },
      ],
      medium: [
        { en: "The permit must be signed by the person responsible for the work.", ar: "يجب أن يوقَّع التصريح من الشخص المسؤول عن العمل." },
        { en: "Work must stop when the conditions of the permit change.", ar: "يجب إيقاف العمل عندما تتغير شروط التصريح." },
        { en: "A permit is issued only after the area is checked as safe.", ar: "لا يُصدر التصريح إلا بعد التحقق من سلامة المنطقة." },
        { en: "The permit holder must return the permit when the work is finished.", ar: "يجب على حامل التصريح إعادته عند انتهاء العمل." },
      ],
      hard: [
        { en: "Conditions may change while the area is unattended, so the permit must be renewed after a re-check.", ar: "قد تتغير الظروف أثناء غياب المراقبة، لذا يجب تجديد التصريح بعد إعادة التحقق." },
        { en: "A permit protects people by linking authorisation to a verified safe state.", ar: "يحمي التصريح الأشخاص بربط التفويض بحالة أمان موثقة." },
        { en: "The permit and its safety conditions must be handed over to the incoming shift.", ar: "يجب تسليم التصريح وشروط السلامة الخاصة به إلى الوردية القادمة." },
        { en: "The competent person must verify the work area again if the work is interrupted.", ar: "يجب على الشخص المؤهل إعادة التحقق من منطقة العمل إذا انقطع العمل." },
      ],
    },
    wrongs: [
      { en: "Any worker may carry out live electrical work in an emergency.", ar: "يمكن لأي عامل تنفيذ العمل الكهربائي المكهرب في حالات الطوارئ." },
      { en: "Permit documents can be completed after the work is finished.", ar: "يمكن تعبئة وثائق التصريح بعد انتهاء العمل." },
      { en: "Competence certificates are only required for supervisors.", ar: "لا تُشترط شهادات الكفاءة إلا للمشرفين." },
      { en: "A permit remains valid even if the work area changes.", ar: "يبقى التصريح ساريًا حتى إذا تغيرت منطقة العمل." },
      { en: "The permit can be transferred verbally to another worker.", ar: "يمكن نقل التصريح شفهيًا إلى عامل آخر." },
      { en: "Once issued, a permit stays valid for the whole day without review.", ar: "يبقى التصريح ساريًا طوال اليوم دون مراجعة بمجرد إصداره." },
      { en: "Checking the work area is the contractor's responsibility only.", ar: "التحقق من منطقة العمل مسؤولية المقاول وحده." },
      { en: "A permit is not needed for jobs shorter than one hour.", ar: "لا حاجة لتصريح العمل في المهام التي تقل عن ساعة واحدة." },
    ],
    explAr: "تنص المادة على أن العمل الكهربائي يُنفَّذ حصريًا من قبل أشخاص مؤهلين ومصرح لهم وبموجب تصريح عمل مسبق.",
  },
  {
    id: "risk",
    detect: /hazard|\brisk\b|risk assessment|danger|dangerous/i,
    enTopic: "hazard and risk assessment",
    arTopic: "تقييم المخاطر والأخطار",
    arStems: {
      easy: [
        "ما الإجراء الواجب اتباعه قبل بدء العمل وفقًا للمادة؟",
        "بماذا يتعامل العمال مع الأخطار المحددة وفقًا للمادة؟",
        "ماذا يجب على العمال فعله تجاه الأخطار التي لا يستطيعون السيطرة عليها وفقًا للمادة؟",
        "كيف يُعرَّف الخطر وفقًا للمادة؟",
      ],
      medium: [
        "كيف يُقيَّم مستوى الخطر وفقًا للمادة؟",
        "متى يجب مراجعة إجراءات التحكم وفقًا للمادة؟",
        "ما الذي يجب إبلاغ العمال به قبل بدء المهمة وفقًا للمادة؟",
        "ماذا يجب على منفذ العمل التحقق منه وفقًا للمادة؟",
      ],
      hard: [
        "لماذا يجب ضبط الخطر حتى لو لم يصب أحد بعد وفقًا للمادة؟",
        "لماذا يُفضَّل استبعاد الخطر على غيره من إجراءات التحكم وفقًا للمادة؟",
        "ما خطر إجراء تحكم غير مُصان وفقًا للمادة؟",
        "ما الأفضل عند وجود خطر شديد وفقًا للمادة؟",
      ],
    },
    enStems: {
      easy: [
        "What step must be taken before work begins according to the material?",
        "How are identified hazards handled by workers according to the material?",
        "What must workers do about hazards they cannot control according to the material?",
        "How is a hazard defined according to the material?",
      ],
      medium: [
        "How is the risk level assessed according to the material?",
        "When must the control measures be reviewed according to the material?",
        "What must workers be told before the task starts according to the material?",
        "What must the person doing the work check according to the material?",
      ],
      hard: [
        "Why must a hazard be controlled even if nobody has been hurt yet according to the material?",
        "Why is eliminating the hazard preferred over other controls according to the material?",
        "What is the danger of a control that is not maintained according to the material?",
        "What is best when a hazard is severe according to the material?",
      ],
    },
    trues: {
      easy: [
        { en: "A risk assessment must be carried out before work begins.", ar: "يجب إجراء تقييم المخاطر قبل بدء العمل." },
        { en: "Identified hazards must be controlled with appropriate measures.", ar: "يجب ضبط الأخطار المحددة بإجراءات تحكم مناسبة." },
        { en: "Workers must report hazards they cannot control themselves.", ar: "يجب على العمال الإبلاغ عن الأخطار التي لا يستطيعون السيطرة عليها بأنفسهم." },
        { en: "A hazard is something with the potential to cause harm.", ar: "الخطر هو شيء يمكن أن يسبب الأذى." },
      ],
      medium: [
        { en: "The risk level is assessed by combining likelihood and severity.", ar: "يُقيَّم مستوى الخطر من خلال الجمع بين الاحتمالية وشدة الأثر." },
        { en: "Controls must be reviewed when the work method changes.", ar: "يجب مراجعة إجراءات التحكم عند تغير أسلوب العمل." },
        { en: "Workers must be informed of the hazards before the task starts.", ar: "يجب إبلاغ العمال بالأخطار قبل بدء المهمة." },
        { en: "The person doing the job must check the controls are in place.", ar: "يجب على منفذ العمل التحقق من وجود إجراءات التحكم." },
      ],
      hard: [
        { en: "Harm can happen on the first exposure, so the hazard must be controlled before anyone is hurt.", ar: "قد يحدث الضرر من أول تعرض، لذا يجب ضبط الخطر قبل إصابة أي شخص." },
        { en: "Elimination is preferred because it removes the hazard completely.", ar: "يُفضَّل الاستبعاد لأنه يزيل الخطر بالكامل." },
        { en: "A control that is used but not maintained gives a false sense of safety.", ar: "إجراء التحكم المستخدم دون صيانة يمنح إحساسًا زائفًا بالأمان." },
        { en: "Two separate controls are better than one when the hazard is severe.", ar: "إجراءا تحكم منفصلان أفضل من إجراء واحد عند شدة الخطر." },
      ],
    },
    wrongs: [
      { en: "Risk assessments are only required for outdoor work.", ar: "لا يُشترط تقييم المخاطر إلا في الأعمال الخارجية." },
      { en: "A hazard that has been identified does not need to be controlled.", ar: "الخطر المحدد لا يحتاج إلى إجراءات تحكم." },
      { en: "Risk assessments may be skipped when the task is urgent.", ar: "يمكن تخطي تقييم المخاطر عندما تكون المهمة عاجلة." },
      { en: "A low-risk job can never cause harm.", ar: "لا يمكن للمهمة منخفضة الخطورة أن تسبب أذى." },
      { en: "Risk controls only need review when someone is injured.", ar: "لا تُراجع إجراءات التحكم إلا عند وقوع إصابة." },
      { en: "Reporting hazards is optional for workers.", ar: "الإبلاغ عن الأخطار أمر اختياري للعمال." },
      { en: "The risk level depends only on how often the task is done.", ar: "يعتمد مستوى الخطر على مدى تكرار المهمة فقط." },
      { en: "Once a control is installed, it never needs maintenance.", ar: "لا يحتاج إجراء التحكم إلى صيانة بعد تركيبه." },
    ],
    explAr: "تشدد المادة على إجراء تقييم المخاطر قبل بدء العمل، وتحديد الأخطار ووضع إجراءات التحكم المناسبة لها.",
  },
  {
    id: "height",
    detect: /height|ladder|scaffold|fall protection|falling|harness|working at height/i,
    enTopic: "working at height",
    arTopic: "العمل على الارتفاع",
    arStems: {
      easy: [
        "ما المطلوب عند العمل على الارتفاع وفقًا للمادة؟",
        "ماذا يجب التحقق منه قبل استخدام السلالم والسقالات وفقًا للمادة؟",
        "ما القاعدة المتعلقة بالحمولة الآمنة للمعدات وفقًا للمادة؟",
        "ماذا تحمي الحواجز الواقية العمال منه وفقًا للمادة؟",
      ],
      medium: [
        "على أي أساس يجب وضع قاعدة السلَّم وفقًا للمادة؟",
        "كم نقطة تلامس يجب أن يحافظ عليها العامل أثناء صعود السلَّم وفقًا للمادة؟",
        "كيف يجب أن يواجه مستخدم السلَّم السلَّم أثناء الصعود وفقًا للمادة؟",
        "كيف تُمنع سقوط الأدوات من الارتفاع وفقًا للمادة؟",
      ],
      hard: [
        "لماذا يجب اختيار نقاط تثبيت حزام الأمان بعناية وفقًا للمادة؟",
        "من يجب أن يفحص السقالة قبل كل وردية وفقًا للمادة؟",
        "ما أفضل وسيلة حماية على الحواف المفتوحة وفقًا للمادة؟",
        "ما الأسلوب الأكثر أمانًا عند العمل على الارتفاع وفقًا للمادة؟",
      ],
    },
    enStems: {
      easy: [
        "What is required when working at height according to the material?",
        "What must be checked before using ladders and scaffolds according to the material?",
        "What rule applies to the safe working load of equipment according to the material?",
        "What do guardrails protect workers from according to the material?",
      ],
      medium: [
        "On what must the base of a ladder be set according to the material?",
        "How many points of contact must a worker keep while climbing a ladder according to the material?",
        "How must the ladder user face the ladder while climbing according to the material?",
        "How are falling tools prevented when working at height according to the material?",
      ],
      hard: [
        "Why must harness anchor points be chosen carefully according to the material?",
        "Who must inspect the scaffold before every shift according to the material?",
        "What is the best protection on open edges according to the material?",
        "What is the safest approach when working at height according to the material?",
      ],
    },
    trues: {
      easy: [
        { en: "Fall protection must be used when working at height.", ar: "يجب استخدام وسائل الحماية من السقوط عند العمل على الارتفاع." },
        { en: "Ladders and scaffolds must be checked before each use.", ar: "يجب فحص السلالم والسقالات قبل كل استخدام." },
        { en: "Workers at height must never exceed the safe working load of the equipment.", ar: "يجب ألا يتجاوز العمال على الارتفاع الحمولة الآمنة للمعدات." },
        { en: "Guardrails protect workers from falling off an open edge.", ar: "تحمي الحواجز الواقية العمال من السقوط من الحواف المفتوحة." },
      ],
      medium: [
        { en: "The base of a ladder must be set on firm, level ground.", ar: "يجب وضع قاعدة السلَّم على أرض ثابتة ومستوية." },
        { en: "A worker must maintain three points of contact while climbing a ladder.", ar: "يجب على العامل الحفاظ على ثلاث نقاط تلامس أثناء صعود السلَّم." },
        { en: "The person using a ladder must face it while climbing.", ar: "يجب أن يواجه مستخدم السلَّم السلَّم أثناء الصعود." },
        { en: "Falling objects must be prevented by using tool lanyards and barriers.", ar: "يجب منع سقوط الأدوات باستخدام حبال الأمان والحواجز." },
      ],
      hard: [
        { en: "A weak anchor can fail under a fall load, so the anchor point must be certified.", ar: "قد يفشل التثبيت الضعيف تحت ثقل السقوط، لذا يجب أن تكون نقطة التثبيت معتمدة." },
        { en: "Scaffolds must be inspected by a competent person before each work shift.", ar: "يجب فحص السقالة من قبل شخص مؤهل قبل كل وردية عمل." },
        { en: "A properly installed guardrail is the most effective protection on an open edge.", ar: "يُعد الحاجز الواقي المثبت بشكل صحيح أفضل وسيلة حماية على الحواف المفتوحة." },
        { en: "Working at height is safest when the work is planned to avoid the hazard entirely.", ar: "يكون العمل على الارتفاع أكثر أمانًا عندما يُخطط العمل لتجنب الخطر بالكامل." },
      ],
    },
    wrongs: [
      { en: "Working at height is safe without fall protection for short tasks.", ar: "العمل على الارتفاع آمن دون وسائل حماية من السقوط في المهام القصيرة." },
      { en: "Ladders must be left in place when they are not in use.", ar: "يجب ترك السلالم في مكانها عند عدم استخدامها." },
      { en: "Fall protection is only needed above a certain height.", ar: "لا تُستخدم وسائل الحماية من السقوط إلا فوق ارتفاع معين." },
      { en: "A ladder may be used on uneven ground if a colleague holds it.", ar: "يمكن استخدام السلَّم على أرض غير مستوية إذا أمسكه زميل." },
      { en: "Two workers may climb a ladder at the same time.", ar: "يمكن لعاملين صعود السلَّم في الوقت نفسه." },
      { en: "Scaffolds need inspection only when they are first erected.", ar: "لا تُفحص السقالات إلا عند تركيبها لأول مرة." },
      { en: "Objects may be thrown down from a scaffold to save time.", ar: "يمكن رمي الأجسام من السقالة لتوفير الوقت." },
      { en: "Guardrails are unnecessary on low scaffolds.", ar: "لا حاجة للحواجز الواقية في السقالات المنخفضة." },
    ],
    explAr: "تؤكد المادة على استخدام وسائل الحماية من السقوط عند العمل على الارتفاع وفحص السلالم والسقالات قبل الاستخدام.",
  },
  {
    id: "emergency",
    detect: /first aid|emergency|accident|incident|rescue|ambulance/i,
    enTopic: "emergency procedures",
    arTopic: "إجراءات الطوارئ",
    arStems: {
      easy: [
        "ما الذي يجب أن يعرفه جميع العمال وفقًا للمادة؟",
        "بماذا يلتزم العمال عند وقوع حادث وفقًا للمادة؟",
        "ما المطلوب فيما يتعلق بمرافق الإسعافات الأولية وفقًا للمادة؟",
        "كيف يجب أن تكون مخارج الطوارئ وفقًا للمادة؟",
      ],
      medium: [
        "ما التصرف الصحيح عند وقوع حادث وفقًا للمادة؟",
        "أين يجب تعليق قائمة أرقام الاتصال الطارئة وفقًا للمادة؟",
        "ما المتطلب المتعلق بمسعفي الإسعافات الأولية وفقًا للمادة؟",
        "متى يمكن نقل العامل المصاب وفقًا للمادة؟",
      ],
      hard: [
        "لماذا يجب الإبلاغ عن الحوادث حتى دون إصابات وفقًا للمادة؟",
        "ما أول إجراء في حالة الطوارئ الطبية وفقًا للمادة؟",
        "لماذا تساعد تدريبات الطوارئ العمال وفقًا للمادة؟",
        "متى يجب معرفة مسارات الإخلاء وفقًا للمادة؟",
      ],
    },
    enStems: {
      easy: [
        "What must all workers know according to the material?",
        "What must workers do when an accident happens according to the material?",
        "What is required regarding first aid facilities according to the material?",
        "How must emergency exits be according to the material?",
      ],
      medium: [
        "What is the correct action when an accident occurs according to the material?",
        "Where must the emergency contact list be posted according to the material?",
        "What is required of first aiders according to the material?",
        "When may an injured worker be moved according to the material?",
      ],
      hard: [
        "Why must accidents be reported even without injuries according to the material?",
        "What is the first action in a medical emergency according to the material?",
        "Why do emergency drills help workers according to the material?",
        "When must evacuation routes be known according to the material?",
      ],
    },
    trues: {
      easy: [
        { en: "Workers must know the emergency procedures and emergency contacts.", ar: "يجب أن يكون العمال على دراية بإجراءات الطوارئ وأرقام الاتصال الطارئة." },
        { en: "Accidents and incidents must be reported promptly.", ar: "يجب الإبلاغ عن الحوادث فور وقوعها." },
        { en: "First aid facilities must be available and clearly identified.", ar: "يجب توفير مرافق الإسعافات الأولية وتحديدها بوضوح." },
        { en: "Emergency exit routes must be kept clear at all times.", ar: "يجب أن تبقى مخارج الطوارئ خالية في جميع الأوقات." },
      ],
      medium: [
        { en: "When an accident occurs, the nearest worker must raise the alarm immediately.", ar: "عند وقوع حادث، يجب على أقرب عامل إطلاق الإنذار فورًا." },
        { en: "The emergency contact list must be posted in each work area.", ar: "يجب تعليق قائمة أرقام الاتصال الطارئة في كل منطقة عمل." },
        { en: "First aiders must be trained and their names made known.", ar: "يجب تدريب مسعفي الإسعافات الأولية وإعلان أسمائهم." },
        { en: "Injured workers must not be moved unless they are in immediate danger.", ar: "يجب ألا يُنقل العامل المصاب إلا إذا كان في خطر مباشر." },
      ],
      hard: [
        { en: "Near misses are reported because they reveal hazards before someone gets hurt.", ar: "تُبلَّغ حوادث الاقتراب لأنها تكشف الأخطار قبل إصابة أحد." },
        { en: "Calling for help and starting first aid are the first actions in a medical emergency.", ar: "يُعد طلب المساعدة وبدء الإسعافات الأولية أول إجراء في الطوارئ الطبية." },
        { en: "Emergency drills help people react correctly under pressure.", ar: "تساعد تدريبات الطوارئ الأشخاص على التصرف الصحيح تحت الضغط." },
        { en: "Evacuation routes must be known before an emergency, not discovered during one.", ar: "يجب معرفة مسارات الإخلاء قبل الطوارئ وليس اكتشافها أثناءها." },
      ],
    },
    wrongs: [
      { en: "Reporting accidents is the responsibility of the supervisor alone.", ar: "الإبلاغ عن الحوادث مسؤولية المشرف وحده." },
      { en: "First aid kits are only needed in the workshop.", ar: "لا تُشترط صناديق الإسعافات الأولية إلا في الورشة." },
      { en: "Emergency contacts are only needed during night shifts.", ar: "لا تُحتاج أرقام الاتصال الطارئة إلا في الورديات الليلية." },
      { en: "Accidents with no injury do not need to be reported.", ar: "الحوادث التي لا تسبب إصابات لا تحتاج إلى الإبلاغ." },
      { en: "The nearest worker should wait for the supervisor before raising the alarm.", ar: "يجب على أقرب عامل انتظار المشرف قبل إطلاق الإنذار." },
      { en: "Moving an injured worker quickly is always the right action.", ar: "نقل العامل المصاب بسرعة هو التصرف الصحيح دائمًا." },
      { en: "Emergency exits may be locked during working hours.", ar: "يمكن قفل مخارج الطوارئ خلال ساعات العمل." },
      { en: "First aid is a task for the medical team only, not trained workers.", ar: "الإسعافات الأولية مهمة الطاقم الطبي فقط، وليست من مهام العمال المدربين." },
    ],
    explAr: "تؤكد المادة على معرفة الجميع بإجراءات الطوارئ وأرقام الاتصال، والإبلاغ الفوري عن الحوادث، وتوفر مرافق الإسعافات.",
  },
  {
    id: "housekeeping",
    detect: /housekeeping|tidy|clean|obstruction|clutter|good housekeeping/i,
    enTopic: "housekeeping and storage",
    arTopic: "الترتيب والنظافة والتخزين",
    arStems: {
      easy: [
        "ما المطلوب من العمال فيما يتعلق بمنطقة العمل وفقًا للمادة؟",
        "كيف يجب تخزين المواد غير المستخدمة وفقًا للمادة؟",
        "ما أثر النظافة والترتيب على مخاطر الانزلاق وفقًا للمادة؟",
        "كيف يجب أن تبقى الممرات وفقًا للمادة؟",
      ],
      medium: [
        "متى يجب تنظيف الانسكابات وفقًا للمادة؟",
        "متى تُعاد الأدوات إلى أماكن تخزينها وفقًا للمادة؟",
        "أين يجب التخلص من النفايات والقصاصات وفقًا للمادة؟",
        "ماذا يجب على العمال فعله بالكابلات والخراطيم وفقًا للمادة؟",
      ],
      hard: [
        "لماذا تقلل النظافة والترتيب من مخاطر الحريق وفقًا للمادة؟",
        "ما الطريقة الأكثر فاعلية لمنع الانزلاق والتعثر وفقًا للمادة؟",
        "كيف يجب تنظيم مناطق التخزين وفقًا للمادة؟",
        "ما أثر عدم الترتيب على رؤية الأخطار وفقًا للمادة؟",
      ],
    },
    enStems: {
      easy: [
        "What is required of workers regarding the work area according to the material?",
        "How must unused materials be stored according to the material?",
        "What is the effect of cleanliness and tidiness on slip risks according to the material?",
        "How must walkways be kept according to the material?",
      ],
      medium: [
        "When must spills be cleaned up according to the material?",
        "When must tools be returned to their storage according to the material?",
        "Where must waste and scraps be disposed of according to the material?",
        "What must workers do with cables and hoses according to the material?",
      ],
      hard: [
        "Why does cleanliness and tidiness reduce fire risks according to the material?",
        "What is the most effective way to prevent slips and trips according to the material?",
        "How must storage areas be organised according to the material?",
        "What is the effect of untidiness on seeing hazards according to the material?",
      ],
    },
    trues: {
      easy: [
        { en: "Work areas must be kept clean, tidy, and free of obstructions.", ar: "يجب أن تبقى مناطق العمل نظيفة ومرتبة وخالية من العوائق." },
        { en: "Materials must be stored safely and securely when not in use.", ar: "يجب تخزين المواد بأمان وبشكل آمن عند عدم استخدامها." },
        { en: "Good housekeeping reduces the risk of slips and trips.", ar: "النظافة والترتيب يقللان من خطر الانزلاق والتعثر." },
        { en: "Walkways and corridors must stay clear of stored items.", ar: "يجب أن تبقى الممرات خالية من المواد المخزنة." },
      ],
      medium: [
        { en: "Spills must be cleaned up immediately as they occur.", ar: "يجب تنظيف الانسكابات فور حدوثها." },
        { en: "Tools must be returned to their storage after each task.", ar: "يجب إعادة الأدوات إلى أماكن تخزينها بعد كل مهمة." },
        { en: "Waste and scraps must be disposed of in the correct containers.", ar: "يجب التخلص من النفايات والقصاصات في الحاويات المخصصة." },
        { en: "Workers must keep cables and hoses off walkways.", ar: "يجب على العمال إبعاد الكابلات والخراطيم عن الممرات." },
      ],
      hard: [
        { en: "Clutter and waste provide fuel for fires and block escape routes.", ar: "يُوفر الازدحام والنفايات وقودًا للحرائق وتسد مسارات الهروب." },
        { en: "Keeping floors clean and walkways clear is the most effective way to prevent slips and trips.", ar: "يُعد الحفاظ على نظافة الأرضيات وخالية الممرات أكثر وسيلة فاعلية لمنع الانزلاق والتعثر." },
        { en: "Storage areas must be organised so items are easy to find and safe to reach.", ar: "يجب تنظيم مناطق التخزين بحيث يسهل العثور على المواد والوصول إليها بأمان." },
        { en: "Untidy areas make it harder to see hazards before they cause harm.", ar: "يجعل عدم الترتيب رؤية الأخطار قبل حدوث الضرر أكثر صعوبة." },
      ],
    },
    wrongs: [
      { en: "Storage areas may be blocked during working hours.", ar: "يمكن سد مناطق التخزين خلال ساعات العمل." },
      { en: "Materials may be left on the floor overnight.", ar: "يمكن ترك المواد على الأرض طوال الليل." },
      { en: "Tidiness only matters in walkways and corridors.", ar: "لا تُشترط النظافة إلا في الممرات." },
      { en: "Spills can be cleaned up at the end of the shift.", ar: "يمكن تنظيف الانسكابات في نهاية الوردية." },
      { en: "Waste bins are optional when work is moving quickly.", ar: "حاويات النفايات اختيارية عندما يكون العمل سريعًا." },
      { en: "Cables may lie across walkways if they are taped flat.", ar: "يمكن مد الكابلات عبر الممرات إذا كانت مثبتة على الأرض." },
      { en: "Tools can be left at the work spot for the next shift.", ar: "يمكن ترك الأدوات في مكان العمل للوردية التالية." },
      { en: "Clutter in storage areas does not affect safety.", ar: "لا يؤثر الازدحام في مناطق التخزين على السلامة." },
    ],
    explAr: "تشدد المادة على النظافة والترتيب في مناطق العمل وإزالة العوائق وتخزين المواد بشكل صحيح وآمن.",
  },
  {
    id: "signage",
    detect: /safety sign|warning sign|warning label|signage|labels?|notice|markings?/i,
    enTopic: "safety signs and warnings",
    arTopic: "لافتات السلامة والتحذيرات",
    arStems: {
      easy: [
        "كيف يجب التعامل مع لافتات السلامة وفقًا للمادة؟",
        "بماذا تشير اللافتات التحذيرية وفقًا للمادة؟",
        "ماذا يجب فعله باللافتات التالفة أو المفقودة وفقًا للمادة؟",
        "كيف تنقل رموز السلامة التحذيرات وفقًا للمادة؟",
      ],
      medium: [
        "ما الذي يجب أن يفهمه العمال في منطقة عملهم وفقًا للمادة؟",
        "أين يجب وضع اللافتات وفقًا للمادة؟",
        "متى يجب إطلاع العمال الجدد على معنى اللافتات وفقًا للمادة؟",
        "متى يمكن إزالة اللافتات وفقًا للمادة؟",
      ],
      hard: [
        "لماذا يجب أن تبقى اللافتة التحذيرية حتى بعد وقوع حادث وفقًا للمادة؟",
        "لماذا تساعد الألوان في اللافتات العمال وفقًا للمادة؟",
        "ما الإجراء المطلوب عندما تبهت اللافتة وفقًا للمادة؟",
        "متى تكون اللافتات فعّالة وفقًا للمادة؟",
      ],
    },
    enStems: {
      easy: [
        "How must safety signs be treated according to the material?",
        "What do warning signs indicate according to the material?",
        "What must be done with damaged or missing signs according to the material?",
        "How do safety symbols convey warnings according to the material?",
      ],
      medium: [
        "What must workers understand in their work area according to the material?",
        "Where must signs be placed according to the material?",
        "When must new workers be taught the meaning of signs according to the material?",
        "When may signs be removed according to the material?",
      ],
      hard: [
        "Why must a warning sign remain even after an incident according to the material?",
        "Why do colours on signs help workers according to the material?",
        "What action is required when a sign fades according to the material?",
        "When are signs effective according to the material?",
      ],
    },
    trues: {
      easy: [
        { en: "Safety signs must be visible, legible, and followed at all times.", ar: "يجب أن تكون لافتات السلامة واضحة ومقروءة ويُلتزم بها في جميع الأوقات." },
        { en: "Warning signs mark hazards that must not be ignored.", ar: "تشير اللافتات التحذيرية إلى أخطار لا يجوز تجاهلها." },
        { en: "Damaged or missing signs must be reported and replaced.", ar: "يجب الإبلاغ عن اللافتات التالفة أو المفقودة واستبدالها." },
        { en: "Safety symbols convey warnings quickly even from a distance.", ar: "تنقل رموز السلامة التحذيرات بسرعة حتى من مسافة بعيدة." },
      ],
      medium: [
        { en: "Workers must understand the meaning of the signs in their work area.", ar: "يجب أن يفهم العمال معنى اللافتات الموجودة في منطقة عملهم." },
        { en: "Signs must be positioned where they can be seen before entering a hazard zone.", ar: "يجب وضع اللافتات في مكان يُرى قبل دخول منطقة الخطر." },
        { en: "New workers must be told what each sign means during induction.", ar: "يجب إطلاع العمال الجدد على معنى كل لافتة أثناء التدريب التعريفي." },
        { en: "Signs must not be removed while the hazard still exists.", ar: "يجب ألا تُزال اللافتات ما دام الخطر قائمًا." },
      ],
      hard: [
        { en: "The hazard still exists until it is controlled, so the sign must stay until then.", ar: "يبقى الخطر قائمًا حتى يتم ضبطه، لذا يجب أن تبقى اللافتة حتى ذلك الحين." },
        { en: "Colour coding helps workers react quickly without reading text.", ar: "تساعد رموز الألوان العمال على التصرف بسرعة دون قراءة النص." },
        { en: "A faded sign must be replaced so it can be read clearly.", ar: "يجب استبدال اللافتة الباهتة لتكون مقروءة بوضوح." },
        { en: "Signs are only effective when every worker understands and obeys them.", ar: "لا تكون اللافتات فعّالة إلا عندما يفهمها كل عامل ويلتزم بها." },
      ],
    },
    wrongs: [
      { en: "Warning signs are advisory and may be ignored by experienced staff.", ar: "اللافتات التحذيرية استرشادية ويمكن للموظفين ذوي الخبرة تجاهلها." },
      { en: "Signs are only required at the main entrance.", ar: "لا تُشترط اللافتات إلا عند المدخل الرئيسي." },
      { en: "Signs may be removed while maintenance work is in progress.", ar: "يمكن إزالة اللافتات أثناء أعمال الصيانة." },
      { en: "A damaged sign can stay until the end of the month.", ar: "يمكن ترك اللافتة التالفة حتى نهاية الشهر." },
      { en: "Workers only need to learn the signs for their own task.", ar: "لا يحتاج العمال إلى تعلم إلا لافتات مهمتهم الخاصة." },
      { en: "Symbols on signs are decorative and carry no meaning.", ar: "الرموز على اللافتات زخرفية ولا تحمل أي معنى." },
      { en: "Signs should be placed only after an incident has occurred.", ar: "لا تُوضع اللافتات إلا بعد وقوع حادث." },
      { en: "Colour codes are the same for warnings and instructions.", ar: "الألوان متطابقة في اللافتات التحذيرية والإرشادية." },
    ],
    explAr: "تؤكد المادة على وضوح لافتات السلامة والالتزام بها في جميع الأوقات، وأنها تحدد أخطارًا لا يجوز تجاهلها.",
  },
  {
    id: "maintenance",
    detect: /inspection|maintenance|inspect|tested|fault|faulty|damage|damaged/i,
    enTopic: "inspection and maintenance",
    arTopic: "الفحص والصيانة",
    arStems: {
      easy: [
        "ماذا يجب فعله بالمعدات وفقًا للمادة؟",
        "ماذا يجب أن يحدث للمعدات المعيبة وفقًا للمادة؟",
        "كيف تُميَّز المعدات المعيبة وفقًا للمادة؟",
        "ما فائدة سجلات الصيانة وفقًا للمادة؟",
      ],
      medium: [
        "ما التصرف الصحيح عند اكتشاف عطل في المعدة وفقًا للمادة؟",
        "من المسموح له إصلاح المعدات وفقًا للمادة؟",
        "كيف يجب تخطيط الصيانة المجدولة وفقًا للمادة؟",
        "ما المطلوب قبل بدء أعمال الصيانة وفقًا للمادة؟",
      ],
      hard: [
        "لماذا يجب وضع علامة على المعدات المعيبة بدلًا من إزالتها فقط وفقًا للمادة؟",
        "ما الإجراء الذي يمنع تشغيل آلة مُصلحة قبل الأوان وفقًا للمادة؟",
        "ما خطر استخدام معدات غير مُختبَرة وفقًا للمادة؟",
        "متى تكون سجلات الفحص مفيدة وفقًا للمادة؟",
      ],
    },
    enStems: {
      easy: [
        "What must be done with equipment according to the material?",
        "What must happen to faulty equipment according to the material?",
        "How is defective equipment identified according to the material?",
        "What is the benefit of maintenance records according to the material?",
      ],
      medium: [
        "What is the correct action when a fault is found in equipment according to the material?",
        "Who is allowed to repair equipment according to the material?",
        "How must scheduled maintenance be planned according to the material?",
        "What is required before maintenance work begins according to the material?",
      ],
      hard: [
        "Why must defective equipment be tagged rather than just removed according to the material?",
        "What prevents a repaired machine from being started too early according to the material?",
        "What is the risk of using untested equipment according to the material?",
        "When are inspection records useful according to the material?",
      ],
    },
    trues: {
      easy: [
        { en: "Equipment must be inspected and maintained on a regular basis.", ar: "يجب فحص المعدات وصيانتها بشكل منتظم." },
        { en: "Faulty equipment must be taken out of service until it is repaired.", ar: "يجب إخراج المعدات المعيبة من الخدمة حتى يتم إصلاحها." },
        { en: "Defective equipment must be clearly tagged so others do not use it.", ar: "يجب وضع علامة واضحة على المعدات المعيبة لمنع استخدامها من قبل الآخرين." },
        { en: "Maintenance records help track the condition of equipment.", ar: "تساعد سجلات الصيانة على تتبع حالة المعدات." },
      ],
      medium: [
        { en: "A worker who finds a fault must report it and stop using the equipment.", ar: "يجب على العامل الذي يكتشف عطلًا الإبلاغ عنه والتوقف عن استخدام المعدة." },
        { en: "Only authorised persons may carry out repairs on equipment.", ar: "لا يجوز إجراء إصلاحات على المعدات إلا للأشخاص المصرح لهم." },
        { en: "Scheduled maintenance must be planned so it does not create new risks.", ar: "يجب تخطيط الصيانة المجدولة بحيث لا تخلق أخطارًا جديدة." },
        { en: "Before maintenance work, the equipment must be isolated and locked out.", ar: "يجب عزل المعدات وإقفالها قبل أعمال الصيانة." },
      ],
      hard: [
        { en: "A tag explains why the equipment is out of service and prevents someone from using it by mistake.", ar: "توضح العلامة سبب إخراج المعدة من الخدمة وتمنع استخدامها عن طريق الخطأ." },
        { en: "The lockout tag stays in place until the repair is verified safe to start.", ar: "تبقى علامة الإقفال في مكانها حتى يُتحقق من سلامة بدء التشغيل بعد الإصلاح." },
        { en: "Untested equipment can fail without warning during operation.", ar: "قد تتعطل المعدات غير المُختبَرة دون سابق إنذار أثناء التشغيل." },
        { en: "An inspection record is only useful if it is kept up to date.", ar: "لا تكون سجلات الفحص مفيدة إلا إذا حُدثت باستمرار." },
      ],
    },
    wrongs: [
      { en: "Faulty equipment can continue to be used until the end of the shift.", ar: "يمكن الاستمرار في استخدام المعدات المعيبة حتى نهاية الوردية." },
      { en: "Only equipment bought recently needs to be tested.", ar: "لا تحتاج إلى الاختبار إلا المعدات المشتراة حديثًا." },
      { en: "Maintenance records are only kept for large machinery.", ar: "لا تُحفظ سجلات الصيانة إلا للآلات الكبيرة." },
      { en: "A faulty machine can be left running if it still works.", ar: "يمكن ترك الآلة المعيبة تعمل ما دامت تعمل." },
      { en: "Any worker may repair equipment without authorisation.", ar: "يمكن لأي عامل إصلاح المعدات دون تصريح." },
      { en: "Tagging defective equipment is optional during busy shifts.", ar: "وضع العلامات على المعدات المعيبة اختياري أثناء الورديات المزدحمة." },
      { en: "Machines can be worked on without isolating the power.", ar: "يمكن العمل على الآلات دون عزل الطاقة." },
      { en: "An inspection is enough; no record needs to be kept.", ar: "يكفي الفحص دون الحاجة إلى حفظ سجل." },
    ],
    explAr: "تشدد المادة على الفحص والصيانة الدورية للمعدات، وإخراج المعدات المعيبة من الخدمة ووضع علامات عليها حتى إصلاحها.",
  },
  {
    id: "safe-work",
    detect: /safe work|safety rules|employees? must|workers? must|training|course material|work procedure/i,
    enTopic: "safe working requirements",
    arTopic: "متطلبات العمل الآمن",
    arStems: {
      easy: [
        "ما الالتزام العام المفروض على الموظفين وفقًا للمادة؟",
        "لماذا تُقدَّم المادة التدريبية وفقًا للمادة؟",
        "ماذا يجب على العمال فعله عند ملاحظة ظروف غير آمنة وفقًا للمادة؟",
        "ما الذي يجب اتباعه في كل مهمة وفقًا للمادة؟",
      ],
      medium: [
        "ما الذي يجب على العمال التأكد منه قبل بدء المهمة وفقًا للمادة؟",
        "ما المطلوب فيما يتعلق بالأدوات في كل مهمة وفقًا للمادة؟",
        "ماذا يفعل العامل غير المتأكد من المهمة وفقًا للمادة؟",
        "كيف يجب اتباع تعليمات السلامة وفقًا للمادة؟",
      ],
      hard: [
        "لماذا تسري قواعد السلامة حتى دون حضور المشرف وفقًا للمادة؟",
        "ما السلوك الذي يخلق أكبر خطر في الموقع وفقًا للمادة؟",
        "على ماذا تعتمد ثقافة السلامة وفقًا للمادة؟",
        "لماذا يجب تجديد التدريب وفقًا للمادة؟",
      ],
    },
    enStems: {
      easy: [
        "What general duty applies to employees according to the material?",
        "Why is training material provided according to the material?",
        "What must workers do when they notice unsafe conditions according to the material?",
        "What must be followed in every task according to the material?",
      ],
      medium: [
        "What must workers confirm before starting a task according to the material?",
        "What is required regarding tools in every task according to the material?",
        "What does a worker who is unsure about a task do according to the material?",
        "How must safety instructions be followed according to the material?",
      ],
      hard: [
        "Why do safety rules apply even without the supervisor present according to the material?",
        "What behaviour creates the greatest risk on site according to the material?",
        "What does a safety culture depend on according to the material?",
        "Why must training be refreshed according to the material?",
      ],
    },
    trues: {
      easy: [
        { en: "Employees must follow the safety rules at all times.", ar: "يجب على الموظفين اتباع قواعد السلامة في جميع الأوقات." },
        { en: "Training material is provided to improve safety awareness.", ar: "تُقدَّم المادة التدريبية لرفع الوعي بالسلامة." },
        { en: "Workers must report unsafe conditions as soon as they notice them.", ar: "يجب على العمال الإبلاغ عن الظروف غير الآمنة فور ملاحظتها." },
        { en: "Safe work procedures must be followed on every task.", ar: "يجب اتباع إجراءات العمل الآمنة في كل مهمة." },
      ],
      medium: [
        { en: "Before starting a task, workers must confirm they know the safe procedure.", ar: "قبل بدء المهمة، يجب على العمال التأكد من معرفتهم بالإجراء الآمن." },
        { en: "Workers must use the correct tools for each job.", ar: "يجب على العمال استخدام الأدوات الصحيحة لكل مهمة." },
        { en: "A worker who is unsure about a task must ask before acting.", ar: "يجب على العامل غير المتأكد من المهمة أن يسأل قبل التنفيذ." },
        { en: "Safety instructions from the supervisor must be followed without shortcuts.", ar: "يجب اتباع تعليمات السلامة من المشرف دون اختصارات." },
      ],
      hard: [
        { en: "The hazard exists with or without supervision, so the rules always apply.", ar: "الخطر قائم مع وجود المشرف أو غيابه، لذا تسري القواعد دائمًا." },
        { en: "Taking shortcuts in safe procedures creates the greatest risk on site.", ar: "يخلق اختصار الإجراءات الآمنة أكبر خطر في الموقع." },
        { en: "A safe culture depends on every worker reporting issues.", ar: "تعتمد ثقافة السلامة على إبلاغ كل عامل عن الملاحظات." },
        { en: "Training must be refreshed because rules and conditions change.", ar: "يجب تجديد التدريب لأن القواعد والظروف تتغير." },
      ],
    },
    wrongs: [
      { en: "Safety rules only apply while the trainer is present.", ar: "لا تسري قواعد السلامة إلا في حضور المدرب." },
      { en: "Reporting safety issues is optional for employees.", ar: "الإبلاغ عن ملاحظات السلامة أمر اختياري للموظفين." },
      { en: "Safety rules may be relaxed when the schedule is tight.", ar: "يمكن التخفيف من قواعد السلامة عند ضيق الجدول الزمني." },
      { en: "Any tool can be used if the job is quick.", ar: "يمكن استخدام أي أداة إذا كانت المهمة سريعة." },
      { en: "Workers should decide for themselves which rules to follow.", ar: "يجب على العمال تحديد القواعد التي يتبعونها بأنفسهم." },
      { en: "Shortcuts in procedures save time without increasing risk.", ar: "الاختصارات في الإجراءات توفر الوقت دون زيادة الخطر." },
      { en: "Asking questions about a task shows a lack of skill.", ar: "طرح الأسئلة حول المهمة دليل على ضعف المهارة." },
      { en: "Training is only needed when starting a new job.", ar: "لا حاجة للتدريب إلا عند بدء عمل جديد." },
    ],
    explAr: "تؤكد المادة على التزام جميع الموظفين بقواعد السلامة في جميع الأوقات وتعزيز ثقافة السلامة في العمل.",
  },
  {
    id: "general",
    detect: /[\s\S]/,
    enTopic: "the material content",
    arTopic: "محتوى المادة",
    arStems: {
      easy: [
        "ما العبارة الصحيحة وفقًا للمادة التدريبية؟",
        "أي مما يلي يتوافق مع محتوى المادة التدريبية؟",
        "ما العبارة التي تدعمها المادة التدريبية؟",
        "أي حقيقة وردت في مادة الدورة وفقًا لما ذُكر؟",
      ],
      medium: [
        "أي قاعدة يجب تطبيقها عمليًا وفقًا للمادة التدريبية؟",
        "ماذا توضح المادة التدريبية في هذا الشأن؟",
        "ما الواجب المنصوص عليه للعمال وفقًا للمادة التدريبية؟",
        "ما الإجراء الذي توجّه إليه المادة التدريبية العمال؟",
      ],
      hard: [
        "ما المطلب الذي تنص المادة على عدم إغفاله؟",
        "ما النقطة الأساسية التي تتوقع المادة تذكرها؟",
        "ما القاعدة التي تعتبرها المادة أساسية للعمل الآمن؟",
        "ما الممارسة التي تحددها مادة الدورة بأنها إلزامية؟",
      ],
    },
    enStems: {
      easy: [
        "Which statement is correct according to the training material?",
        "Which of the following matches the training material?",
        "Which statement does the training material support?",
        "Which fact is given in the course material as stated?",
      ],
      medium: [
        "Which rule must be applied in practice according to the training material?",
        "What does the training material explain about this?",
        "What duty is stated for workers according to the training material?",
        "What instruction does the training material direct workers to follow?",
      ],
      hard: [
        "Which requirement does the material state must not be overlooked?",
        "What is the key point the material expects to be remembered?",
        "Which rule does the material consider essential for safe work?",
        "Which practice does the course material identify as mandatory?",
      ],
    },
    trues: {
      easy: [
        { en: "This statement is given in the training material.", ar: "هذه العبارة وردت في المادة التدريبية." },
        { en: "The training material covers this topic in detail.", ar: "تتناول المادة التدريبية هذا الموضوع بالتفصيل." },
        { en: "The source material supports the statement above.", ar: "تدعم المادة التدريبية العبارة السابقة." },
        { en: "The fact stated here appears in the course material.", ar: "الحقيقة المذكورة هنا وردت في مادة الدورة." },
      ],
      medium: [
        { en: "According to the material, this rule must be followed in practice.", ar: "وفقًا للمادة، يجب تطبيق هذه القاعدة عمليًا." },
        { en: "The material explains how this procedure should be applied.", ar: "توضح المادة كيفية تطبيق هذا الإجراء." },
        { en: "This requirement is stated as a duty for the workers concerned.", ar: "تُذكر هذه المتطلبات كواجب على العمال المعنيين." },
        { en: "The training material directs workers to follow this instruction.", ar: "توجّه المادة التدريبية العمال إلى اتباع هذا الإجراء." },
      ],
      hard: [
        { en: "The material states that this requirement must not be overlooked.", ar: "تنص المادة على أنه لا يجوز إغفال هذا المطلب." },
        { en: "This statement is the key point the material expects workers to remember.", ar: "هذه العبارة هي النقطة الأساسية التي تتوقع المادة من العمال تذكرها." },
        { en: "The material presents this rule as essential for safe operation.", ar: "تعرض المادة هذه القاعدة باعتبارها أساسية للعمل الآمن." },
        { en: "The course material identifies this statement as a mandatory practice.", ar: "تحدد مادة الدورة هذه العبارة كممارسة إلزامية." },
      ],
    },
    wrongs: [
      { en: "This statement contradicts the training material.", ar: "هذه العبارة تتعارض مع المادة التدريبية." },
      { en: "This topic is not covered by the training material.", ar: "هذا الموضوع غير مذكور في المادة التدريبية." },
      { en: "The material states the opposite of this statement.", ar: "تنص المادة على عكس هذه العبارة." },
      { en: "This fact does not appear anywhere in the course material.", ar: "لا تظهر هذه الحقيقة في أي مكان من مادة الدورة." },
      { en: "The training material advises against following this instruction.", ar: "تنصح المادة التدريبية بعدم اتباع هذا الإجراء." },
      { en: "This rule applies only to supervisors.", ar: "لا تنطبق هذه القاعدة إلا على المشرفين." },
      { en: "The material lists this statement as optional.", ar: "تعدّد المادة هذه العبارة ضمن الأمور الاختيارية." },
      { en: "This instruction is not part of the safe work procedures.", ar: "هذا الإجراء ليس جزءًا من إجراءات العمل الآمنة." },
    ],
    explAr: "وردت العبارة في المادة التدريبية المرفوعة، وهي أساس السؤال.",
  },
];

function detectTopic(sentence: string): TopicTemplate {
  for (const t of TOPICS) {
    if (t.detect.test(sentence)) return t;
  }
  return TOPICS[TOPICS.length - 1];
}

/**
 * Small, deterministic complexity heuristic used ONLY to RANK sentences within
 * a topic, so absolute values never matter. Longer sentences, more clauses and
 * connectives, and more technical tokens (uppercase acronyms, kV, multi-digit
 * numbers) read as harder facts than short, plain statements.
 */
function complexityScore(sentence: string): number {
  const words = sentence.trim().split(/\s+/).length;
  const clauses = (sentence.match(/[;,:(]/g) ?? []).length;
  const connectives = (sentence.match(
    /\b(because|whereas|however|therefore|unless|although|whenever|if|but|since|while|such that|in order to|in case|must not|shall|required|requires|ensure|prevents?|never|always)\b/gi,
  ) ?? []).length;
  const technical = (sentence.match(/\b[A-Z]{2,}\b|\bkV\b|\b[0-9]{2,}\b/g) ?? []).length;
  return words + clauses * 3 + connectives * 4 + technical * 2;
}

// ─── Question builders ───────────────────────────────────────────────────────

function normOption(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** A distractor from the topic's own wrong pool, skipping anything already used in this question. */
function pickWrong(pool: TopicVariant[], seed: number, usedEn: string[]): TopicVariant {
  for (let k = 0; k < pool.length; k++) {
    const w = pool[(seed + k) % pool.length];
    if (usedEn.some((u) => normOption(u) === normOption(w.en))) continue;
    return w;
  }
  return pool[seed % pool.length];
}

/**
 * Rank the level's enStems by subject similarity to the source sentence, best
 * first. The winning stem's index selects BOTH the Arabic stem (textAr) and the
 * true statement (answer) — they are index-matched per difficulty level, so the
 * Arabic question always asks about the SAME fact the English sentence states,
 * instead of a canned per-topic stem that drifts off-subject.
 */
function rankedStemIndices(sentence: string, level: keyof TopicStemGroup, t: TopicTemplate): number[] {
  const stems = t.enStems[level];
  return stems
    .map((s, i) => ({ i, score: mockSimilarity(sentence, s) }))
    .sort((a, b) => b.score - a.score)
    .map((x) => x.i);
}

/**
 * Build one question. `text` is always a REAL sentence from the material.
 * `textAr` is the Arabic stem whose English counterpart best matches that
 * sentence, and the correct statement is index-matched to the same stem — so
 * the two languages always ask the same thing. `usedIdx` is the set of stem
 * indices already assigned in this batch's difficulty level: each sentence gets
 * its best-ranked stem that is still free, which keeps same-topic batches from
 * repeating an Arabic stem (that would make the validator treat a good question
 * as a duplicate and silently shrink the batch). When every stem of the level
 * is taken (batch larger than the template), the level counter `idx` wraps.
 * `seed` is the global question index: it varies the distractors per question,
 * so two questions never repeat the same options.
 */
function buildQuestion(
  sentence: string,
  type: (typeof QUESTION_TYPES)[number],
  t: TopicTemplate,
  difficulty: TopicDifficulty,
  idx: number,
  seed: number,
  imageRef?: number,
  usedIdx: Set<number> = new Set(),
) {
  const level = difficulty.toLowerCase() as keyof TopicStemGroup;
  const arStems = t.arStems[level];
  const trues = t.trues[level];
  const ranked = rankedStemIndices(sentence, level, t);
  let stemIdx = ranked.find((i) => !usedIdx.has(i));
  if (stemIdx === undefined) stemIdx = ranked[idx % ranked.length];
  usedIdx.add(stemIdx);
  const stem = arStems[stemIdx];
  const correct = trues[stemIdx % trues.length];
  const base = {
    type,
    text: sentence,
    textAr: stem,
    difficulty,
    category: t.id === "general" ? "Material Content" : t.enTopic,
    tags: [t.enTopic, "AI-generated"],
    explanation: sentence,
    explanationAr: t.explAr,
    ...(imageRef !== undefined ? { imageRef } : {}),
  };

  switch (type) {
    case "TRUE_FALSE":
      return { ...base, options: ["True", "False"], optionsAr: ["صحيح", "خطأ"], correctAnswers: [0] };
    case "SHORT_ANSWER":
      return { ...base, options: [], optionsAr: [], correctAnswers: [] };
    case "MULTIPLE_CHOICE": {
      const a = trues[stemIdx % trues.length];
      const b = trues[(stemIdx + 1) % trues.length];
      const w = pickWrong(t.wrongs, seed * 3 + 1, [a.en, b.en]);
      return { ...base, options: [a.en, b.en, w.en], optionsAr: [a.ar, b.ar, w.ar], correctAnswers: [0, 1] };
    }
    case "SINGLE_CHOICE":
    default: {
      const w1 = pickWrong(t.wrongs, seed * 5, [correct.en]);
      const w2 = pickWrong(t.wrongs, seed * 5 + 1, [correct.en, w1.en]);
      return { ...base, options: [correct.en, w1.en, w2.en], optionsAr: [correct.ar, w1.ar, w2.ar], correctAnswers: [0] };
    }
  }
}

// ─── The provider ────────────────────────────────────────────────────────────

export class MockProvider implements AIProvider {
  readonly name = "mock";
  readonly capabilities = CAPABILITIES;

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const user = request.messages.find((m) => m.role === "user");
    const content = user?.content ?? "";

    const countRaw = Number(markerValue(content, "REQUESTED_COUNT"));
    const count = Number.isFinite(countRaw) ? Math.max(1, Math.min(MAX_QUESTIONS, Math.floor(countRaw))) : 3;

    const allowedRaw = markerValue(content, "ALLOWED_TYPES");
    const allowed = (allowedRaw && allowedRaw !== "any"
      ? allowedRaw.split(",").map((s) => s.trim().toUpperCase())
      : []
    ).filter((t): t is (typeof QUESTION_TYPES)[number] => (QUESTION_TYPES as readonly string[]).includes(t));
    const typePool: (typeof QUESTION_TYPES)[number][] = allowed.length > 0 ? allowed : [...QUESTION_TYPES];

    const difficultyRaw = markerValue(content, "DIFFICULTY");
    const difficulty: (typeof DIFFICULTIES)[number] | null =
      difficultyRaw && (DIFFICULTIES as readonly string[]).includes(difficultyRaw)
        ? (difficultyRaw as (typeof DIFFICULTIES)[number])
        : null;

    const source = extractSourceText(content);
    if (!source) {
      throw new Error("Mock provider requires a prompt with SOURCE_TEXT_BEGIN/END markers (AI question generator).");
    }

    const excludedStems = extractExcludedStems(content);
    const pool = splitSentences(source).filter((s) => !isExcluded(s, excludedStems));
    if (pool.length === 0) {
      throw new Error("Mock provider could not find usable sentences in the source text.");
    }

    const figures = extractFigures(content);
    const usedFigures = new Set<number>();
    const diffCounters = new Map<string, number>();

    // Difficulty is decided by CONTENT, not by position in the document. Each
    // topic's sentences are ranked by the complexity heuristic and split into
    // EASY / MEDIUM / HARD thirds, so:
    //   - each level draws genuinely different facts (disjoint sets),
    //   - every topic contributes to every level (no topic collapses into one third),
    //   - the level label reflects the fact's complexity, not its page number.
    const groups = new Map<string, { sentence: string; topic: TopicTemplate }[]>();
    for (const s of pool) {
      const topic = detectTopic(s);
      const list = groups.get(topic.id) ?? [];
      list.push({ sentence: s, topic });
      groups.set(topic.id, list);
    }
    const byLevel = new Map<TopicDifficulty, { sentence: string; topic: TopicTemplate }[]>();
    for (const list of groups.values()) {
      const sorted = [...list].sort((a, b) => complexityScore(a.sentence) - complexityScore(b.sentence));
      sorted.forEach((item, i) => {
        const level = DIFFICULTIES[Math.min(DIFFICULTIES.length - 1, Math.floor((DIFFICULTIES.length * i) / Math.max(1, sorted.length)))];
        const arr = byLevel.get(level) ?? [];
        arr.push(item);
        byLevel.set(level, arr);
      });
    }

    // Ordered question stream — each sentence (a real fact) is used at most
    // once. Round-robin over topics (and over levels when ANY) so a batch mixes
    // topics and levels instead of being monopolised by the first ones.
    const ordered: Array<{ sentence: string; topic: TopicTemplate; diff: TopicDifficulty }> = [];
    const levels: TopicDifficulty[] = difficulty ? [difficulty] : [...DIFFICULTIES];
    const maxRound = Math.max(
      0,
      ...[...groups.keys()].map((id) =>
        levels.reduce((n, d) => n + (byLevel.get(d) ?? []).filter((x) => x.topic.id === id).length, 0),
      ),
    );
    for (let r = 0; r < maxRound; r++) {
      for (const d of levels) {
        for (const id of groups.keys()) {
          const levelItems = byLevel.get(d) ?? [];
          let k = 0;
          for (const item of levelItems) {
            if (item.topic.id !== id) continue;
            if (k === r) ordered.push({ ...item, diff: d });
            k++;
          }
        }
      }
    }

    const questions: unknown[] = [];
    // Content is selected by a per-topic-per-difficulty counter — never by a
    // modulo that re-uses the same stem/answer every N questions. Each level
    // also tracks which stem indices it already assigned, so same-topic batches
    // keep their Arabic stems distinct (see buildQuestion).
    const usedStemIdx = new Map<string, Set<number>>();
    for (let i = 0; i < count; i++) {
      if (i >= ordered.length) break;
      const { sentence, topic, diff } = ordered[i];
      const type = typePool[i % typePool.length];
      const key = topic.id + ":" + diff;
      const idx = diffCounters.get(key) ?? 0;
      diffCounters.set(key, idx + 1);
      const usedSet = usedStemIdx.get(key) ?? new Set<number>();
      usedStemIdx.set(key, usedSet);
      const imageRef = relevantFigureIndex(sentence, figures, usedFigures);
      if (imageRef !== undefined) usedFigures.add(imageRef);
      questions.push(buildQuestion(sentence, type, topic, diff, idx, i, imageRef, usedSet));
    }

    return { content: JSON.stringify({ questions }), model: MODEL_ID };
  }
}
