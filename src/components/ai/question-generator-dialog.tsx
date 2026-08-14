"use client";

// GCCLAB TMS — AI Question Generator dialog (Phase 2)
// =====================================================================
// Lives on the Course Detail page. Steps:
//   1. Configure: pick materials (PDF/Word/PowerPoint only), count, types,
//      difficulty, test type → Generate.
//   2. Review: every generated question is fully bilingual (Arabic + English).
//      The trainer edits / deletes / regenerates, then Approve & Add to
//      Question Bank. Nothing is persisted until approval — no auto-save, no
//      cron generation.
import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, Loader2, Trash2, Plus, RotateCcw } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";

export interface AIQuestionDraft {
  materialId: string;
  type: "SINGLE_CHOICE" | "MULTIPLE_CHOICE" | "TRUE_FALSE" | "SHORT_ANSWER";
  text: string;
  textAr: string;
  options: string[];
  optionsAr: string[];
  correctAnswers: number[];
  explanation?: string;
  explanationAr?: string;
  /** Figure extracted from the course material (shown in review, saved with the question). */
  imageUrl?: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  category?: string;
  tags?: string[];
}

interface GenerateResponse {
  questions: AIQuestionDraft[];
  count: number;
  aiModel: string | null;
  aiPrompt: string | null;
  testType: "PRE_TEST" | "FINAL_TEST";
}

interface ApproveResponse {
  created: unknown[];
  count: number;
}

const QUESTION_TYPES = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "TRUE_FALSE", "SHORT_ANSWER"] as const;
const EXTRACTABLE_TYPES = ["PDF", "POWERPOINT", "WORD"];
const DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;

export function QuestionGeneratorDialog({
  open,
  onOpenChange,
  courseId,
  materials,
  onApproved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  materials: Array<{ id: string; type: string; fileName?: string | null; title: string }>;
  onApproved?: (count: number) => void;
}) {
  const { t } = useI18n();
  const { toast } = useToast();

  const extractable = useMemo(
    () => materials.filter((m) => EXTRACTABLE_TYPES.includes(m.type)),
    [materials],
  );

  const [selected, setSelected] = useState<string[]>([]);
  const [count, setCount] = useState(5);
  const [types, setTypes] = useState<Array<(typeof QUESTION_TYPES)[number]>>([]);
  const [difficulty, setDifficulty] = useState<string>("ANY");
  const [testType, setTestType] = useState<"PRE_TEST" | "FINAL_TEST">("PRE_TEST");

  const [step, setStep] = useState<"config" | "review">("config");
  const [draft, setDraft] = useState<AIQuestionDraft[]>([]);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [aiPrompt, setAiPrompt] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [approving, setApproving] = useState(false);

  const reset = () => {
    setSelected([]);
    setCount(5);
    setTypes([]);
    setDifficulty("ANY");
    setTestType("PRE_TEST");
    setStep("config");
    setDraft([]);
    setAiModel(null);
    setAiPrompt(null);
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const toggleMaterial = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const toggleType = (type: (typeof QUESTION_TYPES)[number]) => {
    setTypes((prev) => (prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type]));
  };

  const handleGenerate = async (excludeTexts?: string[]) => {
    if (selected.length === 0) {
      toast({ title: t("courses.aiSelectMaterial"), variant: "destructive" });
      return;
    }
    setGenerating(true);
    try {
      const res = await api.post<GenerateResponse>(`/courses/${courseId}/materials/ai/generate`, {
        materialIds: selected,
        count,
        types: types.length > 0 ? types : undefined,
        difficulty: difficulty === "ANY" ? undefined : difficulty,
        testType,
        excludeTexts,
      });
      setDraft(res.questions);
      setAiModel(res.aiModel);
      setAiPrompt(res.aiPrompt);
      setStep("review");
    } catch (e) {
      toast({ title: t("courses.aiGenerateError"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  };

  const handleRegenerate = async () => {
    const current = draft.map((q) => q.text).filter((t): t is string => Boolean(t));
    setDraft([]);
    await handleGenerate(current);
  };

  const updateQuestion = (index: number, patch: Partial<AIQuestionDraft>) => {
    setDraft((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  };

  const updateOption = (index: number, optionIndex: number, lang: "en" | "ar", value: string) => {
    setDraft((prev) =>
      prev.map((q, i) => {
        if (i !== index) return q;
        if (lang === "en") {
          const options = [...q.options];
          options[optionIndex] = value;
          return { ...q, options };
        }
        const optionsAr = [...q.optionsAr];
        optionsAr[optionIndex] = value;
        return { ...q, optionsAr };
      }),
    );
  };

  const addOption = (index: number) => {
    setDraft((prev) =>
      prev.map((q, i) => (i === index ? { ...q, options: [...q.options, ""], optionsAr: [...q.optionsAr, ""] } : q)),
    );
  };

  const removeOption = (index: number, optionIndex: number) => {
    setDraft((prev) =>
      prev.map((q, i) => {
        if (i !== index) return q;
        const options = q.options.filter((_, oi) => oi !== optionIndex);
        const optionsAr = q.optionsAr.filter((_, oi) => oi !== optionIndex);
        const correctAnswers = q.correctAnswers
          .filter((ci) => ci !== optionIndex)
          .map((ci) => (ci > optionIndex ? ci - 1 : ci));
        return { ...q, options, optionsAr, correctAnswers };
      }),
    );
  };

  const toggleCorrect = (index: number, optionIndex: number) => {
    setDraft((prev) =>
      prev.map((q, i) => {
        if (i !== index) return q;
        const single = q.type === "SINGLE_CHOICE" || q.type === "TRUE_FALSE";
        if (single) {
          return { ...q, correctAnswers: [optionIndex] };
        }
        return {
          ...q,
          correctAnswers: q.correctAnswers.includes(optionIndex)
            ? q.correctAnswers.filter((ci) => ci !== optionIndex)
            : [...q.correctAnswers, optionIndex].sort((a, b) => a - b),
        };
      }),
    );
  };

  const changeType = (index: number, type: AIQuestionDraft["type"]) => {
    setDraft((prev) =>
      prev.map((q, i) => {
        if (i !== index) return q;
        if (type === "TRUE_FALSE") {
          return { ...q, type, options: ["True", "False"], optionsAr: ["صحيح", "خطأ"], correctAnswers: [0] };
        }
        if (type === "SHORT_ANSWER") {
          return { ...q, type, options: [], optionsAr: [], correctAnswers: [] };
        }
        const hasOptions = q.options.length >= 2;
        return {
          ...q,
          type,
          options: hasOptions ? q.options : ["", ""],
          optionsAr: hasOptions ? q.optionsAr : ["", ""],
          correctAnswers: type === "SINGLE_CHOICE" ? q.correctAnswers.slice(0, 1) : q.correctAnswers,
        };
      }),
    );
  };

  const handleApprove = async () => {
    if (draft.length === 0) return;
    setApproving(true);
    try {
      const res = await api.post<ApproveResponse>(`/courses/${courseId}/materials/ai/approve`, {
        questions: draft,
        testType,
        aiModel,
        aiPrompt,
      });
      toast({ title: t("courses.aiApproved"), description: `${res.count} ${t("exam.questions")}` });
      onApproved?.(res.count);
      close();
    } catch (e) {
      toast({ title: t("courses.aiApproveError"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setApproving(false);
    }
  };

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !generating && !approving) close();
        else onOpenChange(o);
      }}
      title={step === "config" ? t("courses.aiGenerateTitle") : t("courses.aiReviewTitle")}
      description={step === "config" ? t("courses.aiGenerateSubtitle") : t("courses.aiReviewSubtitle")}
      icon={Sparkles}
      size="xxl"
      isSubmitting={approving}
      onSubmit={step === "config" ? () => void handleGenerate() : () => void handleApprove()}
      submitLabel={step === "config" ? t("courses.aiGenerateBtn") : t("courses.aiApprove")}
      footerExtra={
        step === "review" ? (
          <Button variant="outline" size="sm" onClick={() => void handleRegenerate()} disabled={generating}>
            {generating ? <Loader2 className="h-3.5 w-3.5 me-1 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 me-1" />}
            {t("courses.aiRegenerate")}
          </Button>
        ) : undefined
      }
    >
      {step === "config" ? (
        <div className="space-y-5">
          {extractable.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
              <Sparkles className="h-4 w-4" /> {t("courses.aiNoExtractable")}
            </div>
          ) : (
            <>
              <Field label={t("courses.aiMaterials")} required>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {extractable.map((m) => (
                    <Label
                      key={m.id}
                      className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm has-data-[state=checked]:border-primary"
                    >
                      <Checkbox
                        checked={selected.includes(m.id)}
                        onCheckedChange={() => toggleMaterial(m.id)}
                        aria-label={m.fileName ?? m.title}
                      />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{m.fileName ?? m.title}</p>
                        <p className="text-xs text-muted-foreground">{t(`courses.materialType.${m.type}` as never)}</p>
                      </div>
                    </Label>
                  ))}
                </div>
              </Field>

              <FormGrid cols={3}>
                <Field label={t("courses.aiCount")} required>
                  <Input
                    type="number"
                    min={1}
                    max={25}
                    value={count}
                    onChange={(e) => setCount(Math.max(1, Math.min(25, Number(e.target.value) || 1)))}
                  />
                </Field>
                <Field label={t("courses.aiDifficulty")}>
                  <Select value={difficulty} onValueChange={setDifficulty}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t("courses.aiDifficulty.ANY")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ANY">{t("courses.aiDifficulty.ANY")}</SelectItem>
                      {DIFFICULTIES.map((d) => (
                        <SelectItem key={d} value={d}>
                          {t(`courses.aiDifficulty.${d}` as never)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("courses.aiTestType")}>
                  <Select value={testType} onValueChange={(v) => setTestType(v as "PRE_TEST" | "FINAL_TEST")}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PRE_TEST">{t("courses.aiTestType.PRE_TEST")}</SelectItem>
                      <SelectItem value="FINAL_TEST">{t("courses.aiTestType.FINAL_TEST")}</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </FormGrid>

              <Field label={t("courses.aiTypes")} hint={t("courses.aiTypesAny")}>
                <div className="flex flex-wrap gap-2">
                  {QUESTION_TYPES.map((ty) => (
                    <Label key={ty} className="flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm">
                      <Checkbox checked={types.includes(ty)} onCheckedChange={() => toggleType(ty)} aria-label={ty} />
                      {t(`courses.aiType.${ty}` as never)}
                    </Label>
                  ))}
                </div>
              </Field>

              <p className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
                {t("courses.aiBilingualNote")}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              {draft.length} {t("exam.questions")} · {t("courses.aiReviewSubtitle")}
            </p>
          </div>

          {draft.map((q, qi) => (
            <div key={qi} className="space-y-3 rounded-lg border bg-muted/20 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-muted-foreground">
                  {t("courses.aiQuestionText")} #{qi + 1}
                </span>
                <div className="flex items-center gap-2">
                  <Select value={q.type} onValueChange={(v) => changeType(qi, v as AIQuestionDraft["type"])}>
                    <SelectTrigger size="sm" className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {QUESTION_TYPES.map((ty) => (
                        <SelectItem key={ty} value={ty}>
                          {t(`courses.aiType.${ty}` as never)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={q.difficulty}
                    onValueChange={(v) => updateQuestion(qi, { difficulty: v as AIQuestionDraft["difficulty"] })}
                  >
                    <SelectTrigger size="sm" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIFFICULTIES.map((d) => (
                        <SelectItem key={d} value={d}>
                          {t(`courses.aiDifficulty.${d}` as never)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDraft((p) => p.filter((_, i) => i !== qi))}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={`${t("courses.aiQuestionText")} — ${t("courses.aiEnglish")}`} required>
                  <Input value={q.text} onChange={(e) => updateQuestion(qi, { text: e.target.value })} />
                </Field>
                <Field label={`${t("courses.aiQuestionText")} — ${t("courses.aiArabic")}`} required>
                  <Input value={q.textAr} onChange={(e) => updateQuestion(qi, { textAr: e.target.value })} dir="rtl" />
                </Field>
              </div>

              {q.imageUrl && (
                <div className="overflow-hidden rounded-lg border bg-background">
                  <img src={q.imageUrl} alt={t("courses.aiQuestionImage")} className="max-h-64 w-full object-contain" />
                  <div className="flex items-center justify-between gap-2 border-t px-3 py-1.5 text-xs text-muted-foreground">
                    <span>{t("courses.aiQuestionImage")}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => updateQuestion(qi, { imageUrl: undefined })}
                    >
                      {t("courses.aiRemoveImage")}
                    </Button>
                  </div>
                </div>
              )}

              {q.type !== "SHORT_ANSWER" && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">{t("courses.aiOptions")}</p>
                  {q.options.map((opt, oi) => (
                    <div key={oi} className="flex items-center gap-2">
                      <Checkbox
                        checked={q.correctAnswers.includes(oi)}
                        onCheckedChange={() => toggleCorrect(qi, oi)}
                        aria-label={`${t("courses.aiCorrect")} ${oi + 1}`}
                        title={t("courses.aiCorrect")}
                        disabled={q.type === "TRUE_FALSE"}
                      />
                      <Input value={opt} onChange={(e) => updateOption(qi, oi, "en", e.target.value)} disabled={q.type === "TRUE_FALSE"} />
                      <Input
                        value={q.optionsAr[oi] ?? ""}
                        onChange={(e) => updateOption(qi, oi, "ar", e.target.value)}
                        dir="rtl"
                        disabled={q.type === "TRUE_FALSE"}
                      />
                      {q.type !== "TRUE_FALSE" && q.options.length > 2 && (
                        <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeOption(qi, oi)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ))}
                  {(q.type === "SINGLE_CHOICE" || q.type === "MULTIPLE_CHOICE") && (
                    <Button variant="outline" size="sm" onClick={() => addOption(qi)}>
                      <Plus className="h-3.5 w-3.5 me-1" /> {t("courses.aiAddOption")}
                    </Button>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label={`${t("courses.aiExplanation")} — ${t("courses.aiEnglish")}`}>
                  <Textarea rows={2} value={q.explanation ?? ""} onChange={(e) => updateQuestion(qi, { explanation: e.target.value })} />
                </Field>
                <Field label={`${t("courses.aiExplanation")} — ${t("courses.aiArabic")}`}>
                  <Textarea rows={2} value={q.explanationAr ?? ""} onChange={(e) => updateQuestion(qi, { explanationAr: e.target.value })} dir="rtl" />
                </Field>
              </div>
            </div>
          ))}

          <p className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs text-muted-foreground">
            {t("courses.aiBilingualNote")}
          </p>
        </div>
      )}
    </FormDialog>
  );
}
