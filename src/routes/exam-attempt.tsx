"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { StatusBadge } from "@/components/common/status-badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Progress } from "@/components/ui/progress";
import {
  ClipboardList, Play, ArrowLeft, ArrowRight, CheckCircle2, XCircle,
  AlertCircle, Loader2, Send, Timer,
} from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api, ApiError } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";

interface Attempt {
  id: string;
  refNumber: string;
  testType: "PRE_TEST" | "FINAL_TEST";
  traineeName: string;
  traineeEmail?: string | null;
  status: string;
  attemptNumber: number;
  maxAttempts: number;
  scorePercent?: number | null;
  passed?: boolean | null;
  session?: { refNumber: string; title: string } | null;
}

interface ExamQuestion {
  id: string;
  order: number;
  text: string;
  textAr?: string | null;
  imageUrl?: string | null;
  type: string;
  points: number;
  options: string[];
  optionsAr?: string[] | null;
}

interface StartedExam {
  attemptId: string;
  refNumber: string;
  testType: "PRE_TEST" | "FINAL_TEST";
  passScore: number;
  deadline?: string | null;
  questions: ExamQuestion[];
}

interface Graded {
  refNumber: string;
  testType?: "PRE_TEST" | "FINAL_TEST";
  scorePercent: number;
  passed: boolean;
  passScore: number;
  totalPoints: number;
  earnedPoints: number;
  timedOut?: boolean;
}

const SINGLE_ANSWER_TYPES = ["SINGLE_CHOICE", "TRUE_FALSE"];

const formatRemaining = (ms: number) => {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

/**
 * Staff-proctored exam runner. Trainees have no login — a trainer opens the
 * attempt on a shared device, so this is gated on the pre-test / final-test
 * module permissions, exactly as the start/submit endpoints are.
 */
export function ExamAttemptRoute() {
  const { t, dir } = useI18n();
  const { toast } = useToast();
  const { user, routeParam, navigate } = useAppStore();

  // routeParam optionally scopes the list to one test type.
  const testTypeFilter = routeParam === "FINAL_TEST" || routeParam === "PRE_TEST" ? routeParam : undefined;

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Attempt>("/exam-attempts", {
      extraParams: testTypeFilter ? { "filters.testType": testTypeFilter } : {},
    });

  const [exam, setExam] = useState<StartedExam | null>(null);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [graded, setGraded] = useState<Graded | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Countdown to the attempt's deadline; auto-submits when it reaches zero.
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const autoSubmitted = useRef(false);

  useEffect(() => {
    if (!exam?.deadline) {
      setRemainingMs(null);
      return;
    }
    const tick = () => {
      setRemainingMs(Math.max(0, new Date(exam.deadline!).getTime() - Date.now()));
    };
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [exam?.deadline]);

  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const canStart = (a: Attempt) =>
    user
      ? canPerformAction(user.permissions, a.testType === "FINAL_TEST" ? "final-test" : "pre-test", "create")
      : false;

  // The endpoints answer with these codes; show something a human can act on.
  const friendlyError = (e: unknown) => {
    const code = e instanceof ApiError ? e.code : undefined;
    switch (code) {
      case "MAX_ATTEMPTS_REACHED": return t("exam.maxAttempts");
      case "SESSION_NOT_COMPLETED": return t("exam.sessionNotCompleted");
      case "INVALID_STATUS": return t("exam.invalidStatus");
      default: return (e as Error).message;
    }
  };

  const start = async (a: Attempt) => {
    setBusy(a.id);
    try {
      const res = await api.post<StartedExam>(`/exam-attempts/${a.id}/start`, {});
      autoSubmitted.current = false;
      setExam(res);
      setAnswers({});
      setGraded(null);
    } catch (e) {
      toast({ title: t("misc.error"), description: friendlyError(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    if (!exam) return;
    setBusy("submit");
    try {
      const payload = {
        answers: exam.questions.map((q) => ({
          questionId: q.id,
          selectedAnswerIndices: answers[q.id] ?? [],
        })),
      };
      const res = await api.post<Graded>(`/exam-attempts/${exam.attemptId}/submit`, payload);
      setGraded(res);
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: friendlyError(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (remainingMs !== 0 || !exam || graded || busy === "submit" || autoSubmitted.current) return;
    autoSubmitted.current = true;
    toast({ title: t("exam.timeUp"), description: t("exam.autoSubmitted") });
    void submit();
  }, [remainingMs, exam, graded, busy]);

  const pick = (q: ExamQuestion, index: number) => {
    setAnswers((prev) => {
      const current = prev[q.id] ?? [];
      if (SINGLE_ANSWER_TYPES.includes(q.type)) return { ...prev, [q.id]: [index] };
      return {
        ...prev,
        [q.id]: current.includes(index) ? current.filter((i) => i !== index) : [...current, index],
      };
    });
  };

  const exitExam = () => {
    setExam(null);
    setAnswers({});
    setGraded(null);
  };

  // ── Result ──────────────────────────────────────────────────────────
  if (graded) {
    const isPreTest = graded.testType === "PRE_TEST" || exam?.testType === "PRE_TEST";
    return (
      <div className="space-y-5">
        <PageHeader title={t("exam.result")} subtitle={graded.refNumber} icon={ClipboardList} />
        <Card className="p-8 text-center space-y-4 max-w-lg mx-auto">
          {isPreTest ? (
            <ClipboardList className="h-16 w-16 mx-auto text-info" />
          ) : graded.passed ? (
            <CheckCircle2 className="h-16 w-16 mx-auto text-success" />
          ) : (
            <XCircle className="h-16 w-16 mx-auto text-destructive" />
          )}
          <div className="text-5xl font-bold tabular-nums">{graded.scorePercent}%</div>
          <div className="text-sm text-muted-foreground">
            {graded.earnedPoints} / {graded.totalPoints}
            {!isPreTest && ` · ${t("exam.passScore")}: ${graded.passScore}%`}
          </div>
          {isPreTest ? (
            <Badge variant="outline" className="text-sm">
              {t("preTest.assessment")}
            </Badge>
          ) : (
            <Badge variant={graded.passed ? "default" : "destructive"} className="text-sm">
              {graded.passed ? t("finalTest.passed") : t("status.REJECTED")}
            </Badge>
          )}
          {graded.timedOut && (
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Timer className="h-4 w-4" />
              {t("exam.timedOut")}
            </div>
          )}
          <Button className="w-full" onClick={exitExam}>{t("action.back")}</Button>
        </Card>
      </div>
    );
  }

  // ── Taking the exam ─────────────────────────────────────────────────
  if (exam) {
    const answered = exam.questions.filter((q) => (answers[q.id] ?? []).length > 0).length;
    const total = exam.questions.length;

    return (
      <div className="space-y-5">
        <PageHeader
          title={exam.refNumber}
          subtitle={`${t("exam.passScore")}: ${exam.passScore}%`}
          icon={ClipboardList}
          actions={
            <>
              {remainingMs !== null && (
                <Badge
                  variant={remainingMs < 60_000 ? "destructive" : "default"}
                  className="tabular-nums"
                  title={t("exam.timeRemaining")}
                >
                  <Timer className="h-4 w-4 me-1.5" />
                  {t("exam.timeRemaining")}: {formatRemaining(remainingMs)}
                </Badge>
              )}
              <Button variant="outline" onClick={exitExam}>
                <Back className="h-4 w-4 me-1.5" />
                {t("action.cancel")}
              </Button>
            </>
          }
        />

        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{t("exam.progress")}</span>
            <span className="tabular-nums font-medium">{answered} / {total}</span>
          </div>
          <Progress value={total ? (answered / total) * 100 : 0} />
        </Card>

        <div className="space-y-4">
          {exam.questions.map((q, qi) => {
            const selected = answers[q.id] ?? [];
            const single = SINGLE_ANSWER_TYPES.includes(q.type);
            return (
              <Card key={q.id} className="p-5 space-y-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-mono font-semibold">
                    {qi + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">
                      {q.textAr || q.text}
                    </p>
                    {q.textAr ? <p className="text-xs text-muted-foreground mt-0.5">{q.text}</p> : null}
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {q.points} {t("preTest.points")} · {single ? t("exam.pickOne") : t("exam.pickMany")}
                    </p>
                  </div>
                </div>

                {q.imageUrl && (
                  <div className="ps-10">
                    <img
                      src={q.imageUrl}
                      alt={q.textAr || q.text}
                      className="max-h-72 w-auto max-w-full rounded-md border border-border bg-muted/30 object-contain"
                    />
                  </div>
                )}

                {single ? (
                  <RadioGroup
                    value={selected[0] !== undefined ? String(selected[0]) : ""}
                    onValueChange={(v) => pick(q, parseInt(v, 10))}
                    className="ps-10 space-y-1.5"
                  >
                    {q.options.map((opt, oi) => (
                      <label key={oi} className="flex items-center gap-2.5 text-sm cursor-pointer">
                        <RadioGroupItem value={String(oi)} />
                        <span className="min-w-0">
                          <span className="block">{q.optionsAr?.[oi] || opt}</span>
                          {q.optionsAr?.[oi] ? <span className="block text-xs text-muted-foreground">{opt}</span> : null}
                        </span>
                      </label>
                    ))}
                  </RadioGroup>
                ) : (
                  <div className="ps-10 space-y-1.5">
                    {q.options.map((opt, oi) => (
                      <label key={oi} className="flex items-center gap-2.5 text-sm cursor-pointer">
                        <Checkbox checked={selected.includes(oi)} onCheckedChange={() => pick(q, oi)} />
                        <span className="min-w-0">
                          <span className="block">{q.optionsAr?.[oi] || opt}</span>
                          {q.optionsAr?.[oi] ? <span className="block text-xs text-muted-foreground">{opt}</span> : null}
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <div className="flex justify-end">
          <Button size="lg" disabled={busy === "submit"} onClick={() => void submit()}>
            {busy === "submit" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <Send className="h-4 w-4 me-1.5" />}
            {t("exam.submit")}
          </Button>
        </div>
      </div>
    );
  }

  // ── Attempt list ────────────────────────────────────────────────────
  const columns: Column<Attempt>[] = [
    {
      key: "trainee",
      header: t("evaluation.trainee"),
      cell: (r) => (
        <div>
          <div className="text-sm font-medium">{r.traineeName}</div>
          <div className="text-[10px] font-mono text-muted-foreground">{r.refNumber}</div>
        </div>
      ),
    },
    {
      key: "session",
      header: t("attendance.session"),
      cell: (r) => (
        <div>
          <div className="text-sm">{r.session?.title ?? "—"}</div>
          <div className="text-xs font-mono text-muted-foreground">{r.session?.refNumber}</div>
        </div>
      ),
    },
    {
      key: "testType",
      header: t("preTest.questionType"),
      cell: (r) => (
        <Badge variant="secondary" className="text-[10px]">
          {r.testType === "FINAL_TEST" ? t("nav.finalTest") : t("nav.preTest")}
        </Badge>
      ),
    },
    { key: "status", header: t("attendance.status"), cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: "attempt",
      header: t("exam.attempt"),
      cell: (r) => <span className="text-xs tabular-nums">{r.attemptNumber} / {r.maxAttempts}</span>,
    },
    {
      key: "score",
      header: t("finalTest.score"),
      cell: (r) =>
        r.scorePercent != null ? (
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold tabular-nums">{r.scorePercent}%</span>
            {r.testType === "PRE_TEST" ? (
              <ClipboardList className="h-3.5 w-3.5 text-muted-foreground" />
            ) : r.passed ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-success" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-destructive" />
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: (r) =>
        r.status === "GRADED" || r.status === "SUBMITTED" ? null : (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            disabled={!canStart(r) || busy === r.id}
            onClick={() => void start(r)}
          >
            {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {t("exam.start")}
          </Button>
        ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("exam.title")}
        subtitle={t("exam.subtitle")}
        icon={ClipboardList}
        actions={
          testTypeFilter && (
            <Button
              variant="outline"
              onClick={() => navigate(testTypeFilter === "FINAL_TEST" ? "final-test" : "pre-test")}
            >
              <Back className="h-4 w-4 me-1.5" />
              {t("action.back")}
            </Button>
          )
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        rowKey={(r) => r.id}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        page={page}
        total={pagination?.total ?? 0}
        pageSize={pagination?.pageSize ?? 10}
        onPageChange={setPage}
        emptyIcon={ClipboardList}
        emptyTitle={t("exam.empty.title")}
        emptySubtitle={t("exam.empty.subtitle")}
      />
    </div>
  );
}
