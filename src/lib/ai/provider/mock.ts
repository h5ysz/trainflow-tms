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

const MAX_QUESTIONS = 25;
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

function splitSentences(text: string): string[] {
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
  return excludes.some((e) => norm === e.toLowerCase() || mockSimilarity(sentence, e) >= 0.85);
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

interface TopicVariant {
  en: string;
  ar: string;
}

interface TopicTemplate {
  id: string;
  detect: RegExp;
  enTopic: string;
  arTopic: string;
  /** Arabic question-stem phrasings (rotated per question). */
  arStems: string[];
  /** English+Arabic true statements (one becomes the correct answer). */
  trues: TopicVariant[];
  /** English+Arabic false statements (distractors). */
  wrongs: TopicVariant[];
  explAr: string;
}

const TOPICS: TopicTemplate[] = [
  {
    id: "ppe",
    detect: /personal protective equipment|\bppe\b|protective equipment|gloves|helmet|goggles|face shield/i,
    enTopic: "personal protective equipment (PPE)",
    arTopic: "معدات الوقاية الشخصية",
    arStems: [
      "ما الذي يجب على العامل فعله وفقًا للمادة عند العمل على أنظمة كهربائية مكهربة؟",
      "بماذا يُلزم الموظف في المادة التدريبية قبل بدء المهام الكهربائية؟",
      "حدد السلوك الصحيح المتعلق بمعدات الوقاية الشخصية وفقًا للمادة.",
    ],
    trues: [
      { en: "Workers must wear appropriate personal protective equipment when working on live electrical systems.", ar: "يجب على العمال ارتداء معدات الوقاية الشخصية المناسبة عند العمل على الأنظمة الكهربائية المكهربة." },
      { en: "The PPE used must be matched to the hazards of the specific task.", ar: "يجب أن تتوافق معدات الوقاية الشخصية المستخدمة مع أخطار المهمة المحددة." },
      { en: "Wearing PPE does not replace the need to follow safe working procedures.", ar: "ارتداء معدات الوقاية الشخصية لا يغني عن اتباع إجراءات العمل الآمنة." },
    ],
    wrongs: [
      { en: "PPE is optional for tasks assessed as low risk.", ar: "معدات الوقاية الشخصية اختيارية في المهام المقيَّمة بأنها منخفضة الخطورة." },
      { en: "Any type of PPE is suitable for every electrical task.", ar: "أي نوع من معدات الوقاية الشخصية يصلح لجميع المهام الكهربائية." },
      { en: "Wearing PPE removes the requirement for safe working procedures.", ar: "ارتداء معدات الوقاية الشخصية يلغي اشتراط إجراءات العمل الآمنة." },
    ],
    explAr: "تنص المادة على إلزامية ارتداء معدات الوقاية الشخصية المناسبة عند العمل على الأنظمة المكهربة، مع مراعاة مطابقتها لأخطار المهمة دون أن تُغني عن الإجراءات الآمنة.",
  },
  {
    id: "fire",
    detect: /fire|extinguisher|smoke|flammable|combustible/i,
    enTopic: "fire safety",
    arTopic: "السلامة من الحرائق",
    arStems: [
      "ما المطلوب وفقًا للمادة فيما يتعلق بالسلامة من الحرائق؟",
      "بأي التزام يتعلق العمال فيما يخص الوقاية من الحرائق؟",
      "حدد القاعدة الصحيحة المتعلقة بالحرائق والمواد القابلة للاشتعال.",
    ],
    trues: [
      { en: "Fire extinguishers must be kept accessible and inspected regularly.", ar: "يجب أن تكون طفايات الحريق في متناول اليد وتُفحص بانتظام." },
      { en: "Flammable materials must be stored away from sources of heat.", ar: "يجب تخزين المواد القابلة للاشتعال بعيدًا عن مصادر الحرارة." },
      { en: "Smoke and heat detectors should be tested as part of routine checks.", ar: "يجب اختبار كاشفات الدخان والحرارة ضمن الفحوصات الدورية." },
    ],
    wrongs: [
      { en: "Fire extinguishers only need checking when a fire breaks out.", ar: "لا تُفحص طفايات الحريق إلا عند وقوع حريق." },
      { en: "Flammable materials may be stored near heat sources.", ar: "يمكن تخزين المواد القابلة للاشتعال بالقرب من مصادر الحرارة." },
      { en: "Fire safety checks are the responsibility of visitors only.", ar: "فحوصات السلامة من الحرائق مسؤولية الزوار فقط." },
    ],
    explAr: "تشدد المادة على إتاحة طفايات الحريق وفحصها دوريًا، وتخزين المواد القابلة للاشتعال بعيدًا عن مصادر الحرارة.",
  },
  {
    id: "shock",
    detect: /electric shock|live parts|live conductor|de-energi|energis|isolat|proved dead|dead before/i,
    enTopic: "electric shock protection",
    arTopic: "الوقاية من الصدمة الكهربائية",
    arStems: [
      "ما الإجراء الصحيح قبل البدء بالعمل على موصلات كهربائية وفقًا للمادة؟",
      "بماذا يجب التأكد قبل العمل على الأجزاء المكهربة؟",
      "حدد الخطوة الإلزامية للوقاية من الصدمة الكهربائية.",
    ],
    trues: [
      { en: "Live conductors must be isolated and proved dead before work begins.", ar: "يجب عزل الموصلات المكهربة والتحقق من انعدام الجهد قبل بدء العمل." },
      { en: "Other people nearby can also be affected by an electric shock.", ar: "قد يتأثر بالصدمة الكهربائية أيضًا أشخاص آخرون في الجوار." },
      { en: "Work on live parts must only happen after the energy is removed.", ar: "يُسمح بالعمل على الأجزاء المكهربة فقط بعد إزالة الطاقة." },
    ],
    wrongs: [
      { en: "Working near live parts requires no additional precautions.", ar: "لا يتطلب العمل بالقرب من الأجزاء المكهربة أي احتياطات إضافية." },
      { en: "Electric shock can only harm the person carrying out the work.", ar: "لا تضر الصدمة الكهربائية إلا الشخص الذي ينفذ العمل." },
      { en: "Proving a circuit dead is optional when the task is short.", ar: "التحقق من انعدام الجهد أمر اختياري في المهام القصيرة." },
    ],
    explAr: "تؤكد المادة على عزل الأجزاء المكهربة والتحقق من انعدام الجهد قبل العمل، وإمكانية إصابة الآخرين بالصدمة الكهربائية.",
  },
  {
    id: "voltage",
    detect: /voltage|approach distance|overhead line|transmission|substation|\bkV\b|high voltage/i,
    enTopic: "safe working near high voltage",
    arTopic: "العمل الآمن بالقرب من الجهد العالي",
    arStems: [
      "ما الذي يجب على العمال مراعاته بالقرب من الخطوط الهوائية؟",
      "بأي مسافة يتعلق الالتزام عند العمل بالقرب من الجهد العالي؟",
      "حدد القاعدة الصحيحة للعمل بالقرب من منشآت الجهد العالي.",
    ],
    trues: [
      { en: "Workers must keep the safe approach distance from overhead lines.", ar: "يجب على العمال الحفاظ على مسافة الاقتراب الآمنة من الخطوط الهوائية." },
      { en: "The minimum approach distance applies to all workers on site.", ar: "تنطبق مسافة الاقتراب الدنيا على جميع العمال في الموقع." },
      { en: "Overhead power lines are always live unless proved otherwise.", ar: "تعد خطوط الطاقة الهوائية مكهربة دائمًا ما لم يُثبت خلاف ذلك." },
    ],
    wrongs: [
      { en: "There is no minimum approach distance for trained personnel.", ar: "لا توجد مسافة دنيا للاقتراب بالنسبة للأفراد المدربين." },
      { en: "Overhead lines are safe to touch when the weather is dry.", ar: "من الآمن لمس الخطوط الهوائية عندما يكون الطقس جافًا." },
      { en: "Only workers above a certain grade must respect approach distances.", ar: "لا يلتزم بمسافات الاقتراب إلا العمال من درجة معينة." },
    ],
    explAr: "تحدد المادة مسافة اقتراب آمنة إلزامية من الخطوط الهوائية ومنشآت الجهد العالي، وتنطبق على جميع العاملين.",
  },
  {
    id: "permit",
    detect: /permit to work|work permit|\bpermit\b|authoris|authorized|competent person|qualified/i,
    enTopic: "authorization for electrical work",
    arTopic: "التصريح بالعمل على الأنظمة الكهربائية",
    arStems: [
      "من المسموح له بتنفيذ العمل الكهربائي وفقًا للمادة؟",
      "ما الشرط المطلوب قبل بدء العمل المكهرب؟",
      "حدد القاعدة الصحيحة المتعلقة بتصريح العمل.",
    ],
    trues: [
      { en: "Electrical work must only be carried out by competent, authorized persons.", ar: "يجب ألا يُنفَّذ العمل الكهربائي إلا أشخاص مؤهلون ومصرح لهم." },
      { en: "A valid work permit is required before live work starts.", ar: "يُشترط الحصول على تصريح عمل سارٍ قبل البدء بالعمل المكهرب." },
      { en: "The authorized person must confirm the work area is safe before starting.", ar: "يجب على الشخص المصرح له التأكد من سلامة منطقة العمل قبل البدء." },
    ],
    wrongs: [
      { en: "Any worker may carry out live electrical work in an emergency.", ar: "يمكن لأي عامل تنفيذ العمل الكهربائي المكهرب في حالات الطوارئ." },
      { en: "Permit documents can be completed after the work is finished.", ar: "يمكن تعبئة وثائق التصريح بعد انتهاء العمل." },
      { en: "Competence certificates are only required for supervisors.", ar: "لا تُشترط شهادات الكفاءة إلا للمشرفين." },
    ],
    explAr: "تنص المادة على أن العمل الكهربائي يُنفَّذ حصريًا من قبل أشخاص مؤهلين ومصرح لهم وبموجب تصريح عمل مسبق.",
  },
  {
    id: "risk",
    detect: /hazard|\brisk\b|risk assessment|danger|dangerous/i,
    enTopic: "hazard and risk assessment",
    arTopic: "تقييم المخاطر والأخطار",
    arStems: [
      "ما الإجراء الواجب اتباعه قبل بدء العمل وفقًا للمادة؟",
      "بماذا يتعامل العمال مع الأخطار المحددة؟",
      "حدد القاعدة الصحيحة المتعلقة بتقييم المخاطر.",
    ],
    trues: [
      { en: "A risk assessment must be carried out before work begins.", ar: "يجب إجراء تقييم المخاطر قبل بدء العمل." },
      { en: "Identified hazards must be controlled with appropriate measures.", ar: "يجب ضبط الأخطار المحددة بإجراءات تحكم مناسبة." },
      { en: "Workers must report hazards they cannot control themselves.", ar: "يجب على العمال الإبلاغ عن الأخطار التي لا يستطيعون السيطرة عليها بأنفسهم." },
    ],
    wrongs: [
      { en: "Risk assessments are only required for outdoor work.", ar: "لا يُشترط تقييم المخاطر إلا في الأعمال الخارجية." },
      { en: "A hazard that has been identified does not need to be controlled.", ar: "الخطر المحدد لا يحتاج إلى إجراءات تحكم." },
      { en: "Risk assessments may be skipped when the task is urgent.", ar: "يمكن تخطي تقييم المخاطر عندما تكون المهمة عاجلة." },
    ],
    explAr: "تشدد المادة على إجراء تقييم المخاطر قبل بدء العمل، وتحديد الأخطار ووضع إجراءات التحكم المناسبة لها.",
  },
  {
    id: "height",
    detect: /height|ladder|scaffold|fall protection|falling|harness|working at height/i,
    enTopic: "working at height",
    arTopic: "العمل على الارتفاع",
    arStems: [
      "ما المطلوب عند العمل على الارتفاع وفقًا للمادة؟",
      "بماذا يجب التحقق قبل استخدام السلالم والسقالات؟",
      "حدد القاعدة الصحيحة للعمل الآمن على الارتفاع.",
    ],
    trues: [
      { en: "Fall protection must be used when working at height.", ar: "يجب استخدام وسائل الحماية من السقوط عند العمل على الارتفاع." },
      { en: "Ladders and scaffolds must be checked before each use.", ar: "يجب فحص السلالم والسقالات قبل كل استخدام." },
      { en: "Workers at height must never exceed the safe working load of the equipment.", ar: "يجب ألا يتجاوز العمال على الارتفاع الحمولة الآمنة للمعدات." },
    ],
    wrongs: [
      { en: "Working at height is safe without fall protection for short tasks.", ar: "العمل على الارتفاع آمن دون وسائل حماية من السقوط في المهام القصيرة." },
      { en: "Ladders must be left in place when they are not in use.", ar: "يجب ترك السلالم في مكانها عند عدم استخدامها." },
      { en: "Fall protection is only needed above a certain height.", ar: "لا تُستخدم وسائل الحماية من السقوط إلا فوق ارتفاع معين." },
    ],
    explAr: "تؤكد المادة على استخدام وسائل الحماية من السقوط عند العمل على الارتفاع وفحص السلالم والسقالات قبل الاستخدام.",
  },
  {
    id: "emergency",
    detect: /first aid|emergency|accident|incident|rescue|ambulance/i,
    enTopic: "emergency procedures",
    arTopic: "إجراءات الطوارئ",
    arStems: [
      "ما الذي يجب أن يعرفه جميع العمال وفقًا للمادة؟",
      "بماذا يلتزم العمال عند وقوع حادث؟",
      "حدد القاعدة الصحيحة المتعلقة بإجراءات الطوارئ.",
    ],
    trues: [
      { en: "Workers must know the emergency procedures and emergency contacts.", ar: "يجب أن يكون العمال على دراية بإجراءات الطوارئ وأرقام الاتصال الطارئة." },
      { en: "Accidents and incidents must be reported promptly.", ar: "يجب الإبلاغ عن الحوادث فور وقوعها." },
      { en: "First aid facilities must be available and clearly identified.", ar: "يجب توفير مرافق الإسعافات الأولية وتحديدها بوضوح." },
    ],
    wrongs: [
      { en: "Reporting accidents is the responsibility of the supervisor alone.", ar: "الإبلاغ عن الحوادث مسؤولية المشرف وحده." },
      { en: "First aid kits are only needed in the workshop.", ar: "لا تُشترط صناديق الإسعافات الأولية إلا في الورشة." },
      { en: "Emergency contacts are only needed during night shifts.", ar: "لا تُحتاج أرقام الاتصال الطارئة إلا في الورديات الليلية." },
    ],
    explAr: "تؤكد المادة على معرفة الجميع بإجراءات الطوارئ وأرقام الاتصال، والإبلاغ الفوري عن الحوادث، وتوفر مرافق الإسعافات.",
  },
  {
    id: "housekeeping",
    detect: /housekeeping|tidy|clean|obstruction|clutter|good housekeeping/i,
    enTopic: "housekeeping and storage",
    arTopic: "الترتيب والنظافة والتخزين",
    arStems: [
      "ما المطلوب من العمال فيما يتعلق بمنطقة العمل؟",
      "كيف يجب تخزين المواد غير المستخدمة وفقًا للمادة؟",
      "حدد القاعدة الصحيحة المتعلقة بالنظافة والترتيب.",
    ],
    trues: [
      { en: "Work areas must be kept clean, tidy, and free of obstructions.", ar: "يجب أن تبقى مناطق العمل نظيفة ومرتبة وخالية من العوائق." },
      { en: "Materials must be stored safely and securely when not in use.", ar: "يجب تخزين المواد بأمان وبشكل آمن عند عدم استخدامها." },
      { en: "Good housekeeping reduces the risk of slips and trips.", ar: "النظافة والترتيب يقللان من خطر الانزلاق والتعثر." },
    ],
    wrongs: [
      { en: "Storage areas may be blocked during working hours.", ar: "يمكن سد مناطق التخزين خلال ساعات العمل." },
      { en: "Materials may be left on the floor overnight.", ar: "يمكن ترك المواد على الأرض طوال الليل." },
      { en: "Tidiness only matters in walkways and corridors.", ar: "لا تُشترط النظافة إلا في الممرات." },
    ],
    explAr: "تشدد المادة على النظافة والترتيب في مناطق العمل وإزالة العوائق وتخزين المواد بشكل صحيح وآمن.",
  },
  {
    id: "signage",
    detect: /safety sign|warning sign|warning label|signage|labels?|notice|markings?/i,
    enTopic: "safety signs and warnings",
    arTopic: "لافتات السلامة والتحذيرات",
    arStems: [
      "كيف يجب التعامل مع لافتات السلامة وفقًا للمادة؟",
      "بماذا تشير اللافتات التحذيرية؟",
      "حدد القاعدة الصحيحة المتعلقة بلافتات السلامة.",
    ],
    trues: [
      { en: "Safety signs must be visible, legible, and followed at all times.", ar: "يجب أن تكون لافتات السلامة واضحة ومقروءة ويُلتزم بها في جميع الأوقات." },
      { en: "Warning signs mark hazards that must not be ignored.", ar: "تشير اللافتات التحذيرية إلى أخطار لا يجوز تجاهلها." },
      { en: "Damaged or missing signs must be reported and replaced.", ar: "يجب الإبلاغ عن اللافتات التالفة أو المفقودة واستبدالها." },
    ],
    wrongs: [
      { en: "Warning signs are advisory and may be ignored by experienced staff.", ar: "اللافتات التحذيرية استرشادية ويمكن للموظفين ذوي الخبرة تجاهلها." },
      { en: "Signs are only required at the main entrance.", ar: "لا تُشترط اللافتات إلا عند المدخل الرئيسي." },
      { en: "Signs may be removed while maintenance work is in progress.", ar: "يمكن إزالة اللافتات أثناء أعمال الصيانة." },
    ],
    explAr: "تؤكد المادة على وضوح لافتات السلامة والالتزام بها في جميع الأوقات، وأنها تحدد أخطارًا لا يجوز تجاهلها.",
  },
  {
    id: "maintenance",
    detect: /inspection|maintenance|inspect|tested|fault|faulty|damage|damaged/i,
    enTopic: "inspection and maintenance",
    arTopic: "الفحص والصيانة",
    arStems: [
      "ماذا يجب فعله بالمعدات المعيبة وفقًا للمادة؟",
      "بماذا يلتزم العمال فيما يتعلق بفحص المعدات؟",
      "حدد القاعدة الصحيحة المتعلقة بالفحص والصيانة.",
    ],
    trues: [
      { en: "Equipment must be inspected and maintained on a regular basis.", ar: "يجب فحص المعدات وصيانتها بشكل منتظم." },
      { en: "Faulty equipment must be taken out of service until it is repaired.", ar: "يجب إخراج المعدات المعيبة من الخدمة حتى يتم إصلاحها." },
      { en: "Defective equipment must be clearly tagged so others do not use it.", ar: "يجب وضع علامة واضحة على المعدات المعيبة لمنع استخدامها من قبل الآخرين." },
    ],
    wrongs: [
      { en: "Faulty equipment can continue to be used until the end of the shift.", ar: "يمكن الاستمرار في استخدام المعدات المعيبة حتى نهاية الوردية." },
      { en: "Only equipment bought recently needs to be tested.", ar: "لا تحتاج إلى الاختبار إلا المعدات المشتراة حديثًا." },
      { en: "Maintenance records are only kept for large machinery.", ar: "لا تُحفظ سجلات الصيانة إلا للآلات الكبيرة." },
    ],
    explAr: "تشدد المادة على الفحص والصيانة الدورية للمعدات، وإخراج المعدات المعيبة من الخدمة ووضع علامات عليها حتى إصلاحها.",
  },
  {
    id: "safe-work",
    detect: /safe work|safety rules|employees? must|workers? must|training|course material|work procedure/i,
    enTopic: "safe working requirements",
    arTopic: "متطلبات العمل الآمن",
    arStems: [
      "ما الالتزام العام المفروض على الموظفين وفقًا للمادة؟",
      "بماذا تُلزم المادة التدريبية جميع العاملين؟",
      "حدد القاعدة الصحيحة المتعلقة بمتطلبات العمل الآمن.",
    ],
    trues: [
      { en: "Employees must follow the safety rules at all times.", ar: "يجب على الموظفين اتباع قواعد السلامة في جميع الأوقات." },
      { en: "Training material is provided to improve safety awareness.", ar: "تُقدَّم المادة التدريبية لرفع الوعي بالسلامة." },
      { en: "Workers must report unsafe conditions as soon as they notice them.", ar: "يجب على العمال الإبلاغ عن الظروف غير الآمنة فور ملاحظتها." },
    ],
    wrongs: [
      { en: "Safety rules only apply while the trainer is present.", ar: "لا تسري قواعد السلامة إلا في حضور المدرب." },
      { en: "Reporting safety issues is optional for employees.", ar: "الإبلاغ عن ملاحظات السلامة أمر اختياري للموظفين." },
      { en: "Safety rules may be relaxed when the schedule is tight.", ar: "يمكن التخفيف من قواعد السلامة عند ضيق الجدول الزمني." },
    ],
    explAr: "تؤكد المادة على التزام جميع الموظفين بقواعد السلامة في جميع الأوقات وتعزيز ثقافة السلامة في العمل.",
  },
  {
    id: "general",
    detect: /[\s\S]/,
    enTopic: "the material content",
    arTopic: "محتوى المادة",
    arStems: [
      "ما العبارة الصحيحة وفقًا للمادة التدريبية؟",
      "أي مما يلي يتوافق مع محتوى المادة التدريبية؟",
      "حدد الجملة التي وردت في المادة التدريبية.",
    ],
    trues: [
      { en: "This statement is given in the training material.", ar: "هذه العبارة وردت في المادة التدريبية." },
      { en: "The training material covers this topic in detail.", ar: "تتناول المادة التدريبية هذا الموضوع بالتفصيل." },
      { en: "The source material supports the statement above.", ar: "تدعم المادة التدريبية العبارة السابقة." },
    ],
    wrongs: [
      { en: "This statement contradicts the training material.", ar: "هذه العبارة تتعارض مع المادة التدريبية." },
      { en: "This topic is not covered by the training material.", ar: "هذا الموضوع غير مذكور في المادة التدريبية." },
      { en: "The material states the opposite of this statement.", ar: "تنص المادة على عكس هذه العبارة." },
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

// ─── Question builders ───────────────────────────────────────────────────────

function normOption(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** A distractor from the global wrong pool, skipping anything already used. */
function pickWrong(t: TopicTemplate, wrongPool: TopicVariant[] | undefined, seed: number, usedEn: string[]): TopicVariant {
  const pool = wrongPool && wrongPool.length > 0 ? wrongPool : t.wrongs;
  for (let k = 0; k < pool.length; k++) {
    const w = pool[(seed + k) % pool.length];
    if (usedEn.some((u) => normOption(u) === normOption(w.en))) continue;
    return w;
  }
  return t.wrongs[seed % t.wrongs.length];
}

function buildQuestion(
  sentence: string,
  type: (typeof QUESTION_TYPES)[number],
  t: TopicTemplate,
  difficulty: string,
  variant: number,
  imageRef?: number,
  wrongPool?: TopicVariant[],
) {
  const base = {
    type,
    text: sentence,
    textAr: t.arStems[variant % t.arStems.length],
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
      const a = t.trues[variant % t.trues.length];
      const b = t.trues[(variant + 1) % t.trues.length];
      const w = pickWrong(t, wrongPool, variant * 3 + 1, [a.en, b.en]);
      return { ...base, options: [a.en, b.en, w.en], optionsAr: [a.ar, b.ar, w.ar], correctAnswers: [0, 1] };
    }
    case "SINGLE_CHOICE":
    default: {
      const correct = t.trues[variant % t.trues.length];
      const w1 = pickWrong(t, wrongPool, variant * 5, [correct.en]);
      const w2 = pickWrong(t, wrongPool, variant * 5 + 1, [correct.en, w1.en]);
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
    const topicCounters = new Map<string, number>();
    const wrongPool = TOPICS.flatMap((t) => t.wrongs);

    const questions: unknown[] = [];
    // Each sentence (a real fact) is used at most once. When the difficulty is
    // fixed, each level draws from a different third of the pool so EASY /
    // MEDIUM / HARD cover genuinely different facts; when it is ANY, the pool
    // is walked in order and the level label cycles.
    for (let i = 0; i < count; i++) {
      if (i >= pool.length) break;
      const diff = difficulty ?? DIFFICULTIES[i % DIFFICULTIES.length];
      const offset = difficulty
        ? diff === "HARD"
          ? Math.floor((2 * pool.length) / 3)
          : diff === "MEDIUM"
            ? Math.floor(pool.length / 3)
            : 0
        : 0;
      const sentence = pool[(offset + i) % pool.length];
      const type = typePool[i % typePool.length];
      const topic = detectTopic(sentence);
      const variant = topicCounters.get(topic.id) ?? 0;
      topicCounters.set(topic.id, variant + 1);
      const imageRef = relevantFigureIndex(sentence, figures, usedFigures);
      if (imageRef !== undefined) usedFigures.add(imageRef);
      questions.push(buildQuestion(sentence, type, topic, diff, variant, imageRef, wrongPool));
    }

    return { content: JSON.stringify({ questions }), model: MODEL_ID };
  }
}
