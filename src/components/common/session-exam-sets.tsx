"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useToast } from "@/hooks/use-toast";
import { api } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { questionTypeLabel } from "@/lib/questions";
import { cn } from "@/lib/utils";
import {
  FilePen,
  FileCheck2,
  RefreshCw,
  CheckCircle2,
  Circle,
  Trash2,
  Loader2,
  AlertCircle,
  Sparkles,
  Eye,
  EyeOff,
  ImageIcon,
} from "lucide-react";

type TestType = "PRE_TEST" | "FINAL_TEST";

interface ExamSetQuestion {
  id: string;
  text: string;
  textAr?: string | null;
  options: string[];
  optionsAr?: string[] | null;
  correctAnswers: number[];
  imageUrl?: string | null;
  type: string;
  points: number;
  category?: string | null;
  difficulty: string;
}

interface ExamSetDto {
  id: string;
  sessionId: string;
  testType: TestType;
  status: "DRAFT" | "APPROVED";
  version: number;
  numQuestions: number;
  questionIds: string[];
  questions: ExamSetQuestion[];
  approvedAt?: string | null;
  approvedBy?: string | null;
  createdAt?: string | null;
  createdBy?: string | null;
}

function fmtDate(d?: string | null): string {
  return d ? new Date(d).toLocaleString() : "—";
}

/**
 * Trainer review of a sampled set: every question shows its bilingual text,
 * its image (if any), and the correct answers highlighted beside the options —
 * the trainer decides, the system only proposes.
 */
function QuestionList({ questions }: { questions: ExamSetQuestion[] }) {
  const { t } = useI18n();
  return (
    <div className="space-y-3">
      {questions.map((q, i) => (
        <div key={q.id} className="rounded-md border bg-muted/20 p-3 space-y-2">
          <div className="flex items-start gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-mono font-semibold">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{q.textAr || q.text}</p>
              {q.textAr ? <p className="text-xs text-muted-foreground mt-0.5">{q.text}</p> : null}
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge variant="secondary">{q.points} {t("preTest.points")}</Badge>
                <Badge variant="outline">{questionTypeLabel(t, q.type)}</Badge>
                {q.category ? <Badge variant="outline">{q.category}</Badge> : null}
                <Badge variant="outline">{q.difficulty}</Badge>
              </div>
            </div>
          </div>

          {q.imageUrl ? (
            <div className="ps-8">
              <img
                src={q.imageUrl}
                alt={q.textAr || q.text}
                className="max-h-56 w-auto max-w-full rounded-md border border-border bg-muted/30 object-contain"
              />
            </div>
          ) : null}

          <ul className="ps-8 space-y-1">
            {q.options.map((opt, oi) => {
              const isCorrect = q.correctAnswers.includes(oi);
              const primary = q.optionsAr?.[oi] || opt;
              return (
                <li key={oi} className="flex items-center gap-1.5 text-sm">
                  {isCorrect ? (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <Circle className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                  )}
                  <span className={cn("min-w-0", isCorrect && "font-medium text-success")}>{primary}</span>
                  {q.optionsAr?.[oi] ? <span className="text-xs text-muted-foreground truncate">/ {opt}</span> : null}
                  {isCorrect && (
                    <Badge className="ms-auto bg-success/10 text-success border-success/20">
                      {t("examSet.correctAnswer")}
                    </Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function SessionExamSets({ sessionId, canManage }: { sessionId: string; canManage: boolean }) {
  const { t } = useI18n();
  const { toast } = useToast();

  const [data, setData] = useState<{ sets: ExamSetDto[]; bank: Record<TestType, number> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [dialogType, setDialogType] = useState<TestType | null>(null);
  const [numQuestions, setNumQuestions] = useState(0);
  const [current, setCurrent] = useState<ExamSetDto | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ sets: ExamSetDto[]; bank: Record<TestType, number> }>(
        `/sessions/${sessionId}/exam-sets`
      );
      setData(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  useEffect(() => {
    const handle = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(handle);
  }, [load]);

  const bankCount = (tt: TestType) => data?.bank?.[tt] ?? 0;
  const activeFor = (tt: TestType) =>
    (data?.sets ?? [])
      .filter((s) => s.testType === tt && s.status === "APPROVED")
      .sort((a, b) => (b.approvedAt ?? "").localeCompare(a.approvedAt ?? ""))[0] ?? null;
  const draftFor = (tt: TestType) =>
    (data?.sets ?? [])
      .filter((s) => s.testType === tt && s.status === "DRAFT")
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))[0] ?? null;

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const openDialog = (tt: TestType) => {
    setDialogType(tt);
    setNumQuestions(bankCount(tt));
    setCurrent(draftFor(tt));
  };

  const closeDialog = () => {
    setDialogType(null);
    setCurrent(null);
  };

  const generate = () =>
    run("generate", async () => {
      if (!dialogType) return;
      const created = await api.post<ExamSetDto>(`/sessions/${sessionId}/exam-sets`, {
        testType: dialogType,
        numQuestions: numQuestions || undefined,
      });
      setCurrent(created);
      toast({ title: t("misc.success"), description: t("examSet.genSuccess", { count: created.numQuestions }) });
    });

  const regenerate = () =>
    run("regenerate", async () => {
      if (!current) return;
      const updated = await api.post<ExamSetDto>(`/exam-sets/${current.id}/regenerate`, {
        numQuestions: numQuestions || undefined,
      });
      setCurrent(updated);
      toast({ title: t("misc.success"), description: t("examSet.regenerated") });
    });

  const approve = (set: ExamSetDto) =>
    run("approve", async () => {
      const approved = await api.post<ExamSetDto>(`/exam-sets/${set.id}/approve`);
      toast({ title: t("misc.success"), description: t("examSet.approved", { count: approved.numQuestions }) });
      closeDialog();
      await load();
    });

  const discard = (set: ExamSetDto) =>
    run("discard", async () => {
      if (!window.confirm(t("examSet.discardConfirm"))) return;
      await api.delete(`/exam-sets/${set.id}`);
      toast({ title: t("misc.success"), description: t("examSet.discarded") });
      if (current?.id === set.id) setCurrent(null);
      await load();
    });

  if (loading) {
    return <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">{t("table.loading")}</div>;
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
        <AlertCircle className="h-4 w-4" /> {error}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-md border bg-muted/30 p-4 text-sm text-muted-foreground">{t("examSet.hint")}</div>

      <div className="grid gap-5 lg:grid-cols-2">
        {(["PRE_TEST", "FINAL_TEST"] as TestType[]).map((tt) => {
          const active = activeFor(tt);
          const draft = draftFor(tt);
          const bank = bankCount(tt);
          const isPre = tt === "PRE_TEST";
          return (
            <Card key={tt} className="p-5 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  {isPre ? <FilePen className="h-5 w-5 text-muted-foreground" /> : <FileCheck2 className="h-5 w-5 text-muted-foreground" />}
                  <div>
                    <h3 className="text-sm font-semibold">{t(isPre ? "nav.preTest" : "nav.finalTest")}</h3>
                    <p className="text-xs text-muted-foreground">
                      {bank} {t("examSet.bankCount")}
                    </p>
                  </div>
                </div>
                {canManage && (
                  <Button onClick={() => openDialog(tt)} disabled={bank === 0} size="sm">
                    <Sparkles className="h-4 w-4 me-1.5" />
                    {t("examSet.generate")}
                  </Button>
                )}
              </div>

              {active ? (
                <div className="rounded-md border border-success/20 bg-success/5 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 font-medium text-success">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    {t("examSet.active")} · v{active.version} · {active.numQuestions} {t("examSet.questions")}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t("examSet.approvedMeta", { date: fmtDate(active.approvedAt), by: active.approvedBy ?? "—" })}
                  </p>
                  <div className="mt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setExpanded(expanded === active.id ? null : active.id)}
                    >
                      {expanded === active.id ? <EyeOff className="h-4 w-4 me-1.5" /> : <Eye className="h-4 w-4 me-1.5" />}
                      {t(expanded === active.id ? "examSet.hidePreview" : "examSet.preview")}
                    </Button>
                    {expanded === active.id && (
                      <div className="mt-3">
                        <QuestionList questions={active.questions} />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                  {t("examSet.noSet")}
                </div>
              )}

              {draft && (
                <div className="rounded-md border border-amber-300/40 bg-amber-50/50 dark:bg-amber-950/20 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
                    <Circle className="h-4 w-4 shrink-0" />
                    {t("examSet.draft")} · v{draft.version} · {draft.numQuestions} {t("examSet.questions")}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t("examSet.draftNotUsed")}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setExpanded(expanded === draft.id ? null : draft.id)}>
                      {expanded === draft.id ? <EyeOff className="h-4 w-4 me-1.5" /> : <Eye className="h-4 w-4 me-1.5" />}
                      {t(expanded === draft.id ? "examSet.hidePreview" : "examSet.preview")}
                    </Button>
                    {canManage && (
                      <>
                        <Button variant="outline" size="sm" onClick={() => openDialog(tt)}>
                          <RefreshCw className="h-4 w-4 me-1.5" />
                          {t("examSet.regenerate")}
                        </Button>
                        <Button size="sm" onClick={() => void approve(draft)} disabled={busy === "approve"}>
                          {busy === "approve" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 me-1.5" />}
                          {t("examSet.approve")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => void discard(draft)}
                          disabled={busy === "discard"}
                        >
                          <Trash2 className="h-4 w-4 me-1.5" />
                          {t("examSet.discard")}
                        </Button>
                      </>
                    )}
                  </div>
                  {expanded === draft.id && (
                    <div className="mt-3">
                      <QuestionList questions={draft.questions} />
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Dialog open={dialogType !== null} onOpenChange={(o) => { if (!o) closeDialog(); }}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {t("examSet.generateTitle")} — {t(dialogType === "PRE_TEST" ? "nav.preTest" : "nav.finalTest")}
            </DialogTitle>
            <DialogDescription>{t("examSet.generateDesc")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40">
                <Label className="text-xs font-medium">{t("examSet.numQuestions")}</Label>
                <Input
                  type="number"
                  min={1}
                  max={dialogType ? bankCount(dialogType) : undefined}
                  value={numQuestions}
                  onChange={(e) => setNumQuestions(parseInt(e.target.value, 10) || 0)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t("examSet.bankCount")} · {dialogType ? bankCount(dialogType) : 0}
                </p>
              </div>
              {!current && (
                <Button onClick={() => void generate()} disabled={busy === "generate" || numQuestions <= 0}>
                  {busy === "generate" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <Sparkles className="h-4 w-4 me-1.5" />}
                  {t("examSet.generate")}
                </Button>
              )}
            </div>

            {current ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {t("examSet.draft")} v{current.version} · {current.numQuestions} {t("examSet.questions")}
                  </span>
                  <span>
                    {t("examSet.generatedMeta", { date: fmtDate(current.createdAt), by: current.createdBy ?? "—" })}
                  </span>
                </div>
                <div className="max-h-[50vh] overflow-y-auto rounded-md border bg-background p-3">
                  <QuestionList questions={current.questions} />
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <ImageIcon className="h-3.5 w-3.5 shrink-0" />
                  {t("examSet.imagesHint")}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">{t("examSet.genPrompt")}</p>
            )}
          </div>

          <DialogFooter className="flex-wrap gap-2">
            {current && (
              <>
                <Button variant="outline" onClick={() => void regenerate()} disabled={busy === "regenerate" || numQuestions <= 0}>
                  {busy === "regenerate" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 me-1.5" />}
                  {t("examSet.regenerate")}
                </Button>
                <Button onClick={() => void approve(current)} disabled={busy === "approve"}>
                  {busy === "approve" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <CheckCircle2 className="h-4 w-4 me-1.5" />}
                  {t("examSet.approve")}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
