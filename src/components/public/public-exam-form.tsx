"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/context";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  ClipboardCheck, Loader2, CircleAlert, CheckCircle2, XCircle,
  ChevronLeft, ChevronRight, Send, Clock,
} from "lucide-react";
import { api } from "@/lib/api/client";

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

interface SessionInfo {
  sessionTitle: string;
  courseTitle: string | null;
  courseCode: string | null;
  startDate: string;
  endDate: string;
  city: string | null;
  venue: string | null;
  sessionId: string;
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

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="w-full max-w-2xl space-y-4">
        <div className="flex flex-col items-center text-center gap-2">
          <img src="/gcclab-logo-official.png" alt="GCC Lab" className="h-14 w-auto" />
          <h1 className="text-lg font-semibold">{title}</h1>
        </div>
        {children}
      </div>
    </main>
  );
}

export function PublicExamForm({ testType }: { testType: "PRE_TEST" | "FINAL_TEST" }) {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const token = params.get("token") ?? "";

  // Phase: identify → exam → result
  const [phase, setPhase] = useState<"identify" | "loading" | "exam" | "submitting" | "result">("identify");
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Identity form
  const [fullName, setFullName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Exam state
  const [exam, setExam] = useState<StartedExam | null>(null);
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [currentIdx, setCurrentIdx] = useState(0);
  const [graded, setGraded] = useState<Graded | null>(null);
  const deadlineRef = useRef<Date | null>(null);
  const [remaining, setRemaining] = useState<string>("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch session info
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const endpoint = testType === "PRE_TEST" ? "/public/pre-test" : "/public/final-test";
    api.get<SessionInfo>(endpoint, { token })
      .then((res) => { if (!cancelled) setInfo(res); })
      .catch((e) => { if (!cancelled) setLoadError((e as Error).message); });
    return () => { cancelled = true; };
  }, [token, testType]);

  const setAnswer = useCallback((questionId: string, indices: number[]) => {
    setAnswers((prev) => ({ ...prev, [questionId]: indices }));
  }, []);

  const handleSubmit = useCallback(async (timedOut = false) => {
    if (!exam) return;
    setPhase("submitting");
    if (timerRef.current) clearInterval(timerRef.current);
    try {
      const res = await api.post<Graded>(`/public/exam/${exam.attemptId}/submit`, {
        answers: Object.entries(answers).map(([questionId, selectedAnswerIndices]) => ({
          questionId, selectedAnswerIndices,
        })),
        timedOut,
      });
      setGraded(res);
      setPhase("result");
    } catch {
      setSubmitError(t("publicExam.submitFailed"));
      setPhase("exam");
    }
  }, [exam, answers, t]);

  // Timer
  useEffect(() => {
    if (phase !== "exam" || !deadlineRef.current) return;
    const tick = () => {
      const ms = deadlineRef.current!.getTime() - Date.now();
      if (ms <= 0) {
        setRemaining("00:00");
        void handleSubmit(true);
        return;
      }
      setRemaining(formatRemaining(ms));
    };
    tick();
    timerRef.current = setInterval(tick, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [phase, handleSubmit]);

  const identifyAndStart = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setSubmitError(t("publicExam.nameRequired"));
      return;
    }
    setPhase("loading");
    setSubmitError(null);
    try {
      const endpoint = testType === "PRE_TEST" ? "/public/pre-test" : "/public/final-test";
      const res = await api.post<{ attemptId: string; status: string; scorePercent?: number; passed?: boolean }>(
        endpoint,
        { token, traineeName: fullName.trim(), traineeIdNational: nationalId.trim() || undefined }
      );

      if (res.status === "GRADED") {
        setGraded({
          refNumber: "",
          testType,
          scorePercent: res.scorePercent ?? 0,
          passed: res.passed ?? false,
          passScore: 70,
          totalPoints: 0,
          earnedPoints: 0,
        });
        setPhase("result");
        return;
      }

      const examRes = await api.post<StartedExam>(`/public/exam/${res.attemptId}/start`, {});
      setExam(examRes);
      if (examRes.deadline) deadlineRef.current = new Date(examRes.deadline);
      setPhase("exam");
    } catch (err) {
      setSubmitError((err as Error).message);
      setPhase("identify");
    }
  };

  const missingToken = !token;

  if (missingToken || loadError || (!info && !loadError && phase === "identify")) {
    return (
      <Shell title={testType === "PRE_TEST" ? t("publicExam.titlePreTest") : t("publicExam.titleFinalTest")}>
        <Card className="p-6 text-center space-y-3 border-2 border-destructive/40 bg-destructive/5">
          <CircleAlert className="h-10 w-10 mx-auto text-destructive" />
          <p className="text-sm font-medium">{missingToken ? t("publicExam.missingToken") : loadError}</p>
        </Card>
      </Shell>
    );
  }

  // ── IDENTIFY PHASE ──
  if (phase === "identify" || phase === "loading") {
    return (
      <Shell title={testType === "PRE_TEST" ? t("publicExam.titlePreTest") : t("publicExam.titleFinalTest")}>
        <Card className="p-5 space-y-3">
          <div>
            <div className="text-base font-semibold">{info?.sessionTitle}</div>
            {info?.courseTitle && <div className="text-sm text-muted-foreground">{info.courseTitle}</div>}
          </div>
        </Card>
        <Card className="p-5">
          <form onSubmit={identifyAndStart} className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Enter your name to begin the {testType === "PRE_TEST" ? "pre-test" : "final test"}.
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="fullName">Full name *</Label>
              <Input
                id="fullName"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                autoComplete="name"
                required
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nationalId">National ID / Iqama</Label>
              <Input
                id="nationalId"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                inputMode="numeric"
              />
            </div>
            {submitError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
                <CircleAlert className="h-4 w-4 shrink-0" />
                {submitError}
              </div>
            )}
            <Button type="submit" className="w-full" disabled={phase === "loading"}>
              {phase === "loading" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <ClipboardCheck className="h-4 w-4 me-1.5" />}
              Start Exam
            </Button>
          </form>
        </Card>
      </Shell>
    );
  }

  // ── SUBMITTING PHASE ──
  if (phase === "submitting") {
    return (
      <Shell title={t("publicExam.submittingTitle")}>
        <Card className="p-10 flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">{t("publicExam.submitting")}</p>
        </Card>
      </Shell>
    );
  }

  // ── RESULT PHASE ──
  if (phase === "result" && graded) {
    return (
      <Shell title={testType === "PRE_TEST" ? t("publicExam.titlePreTestResult") : t("publicExam.titleFinalTestResult")}>
        <Card className={`p-6 text-center space-y-3 border-2 ${graded.passed ? "border-success/40 bg-success/5" : "border-destructive/40 bg-destructive/5"}`}>
          {graded.passed
            ? <CheckCircle2 className="h-12 w-12 mx-auto text-success" />
            : <XCircle className="h-12 w-12 mx-auto text-destructive" />
          }
          <p className="text-base font-semibold">
            {graded.passed ? t("publicExam.passed") : t("publicExam.failed")}
          </p>
          {graded.totalPoints > 0 && (
            <div className="space-y-1">
              <p className="text-2xl font-bold">{graded.scorePercent}%</p>
              <p className="text-xs text-muted-foreground">
                {t("publicExam.points", { earned: String(graded.earnedPoints), total: String(graded.totalPoints), passScore: String(graded.passScore) })}
              </p>
            </div>
          )}
          {testType === "FINAL_TEST" && !graded.passed && (
            <p className="text-xs text-muted-foreground">
              {t("publicExam.retestHint")}
            </p>
          )}
        </Card>
      </Shell>
    );
  }

  // ── EXAM PHASE ──
  if (!exam) return null;
  const q = exam.questions[currentIdx];
  const progress = ((currentIdx + 1) / exam.questions.length) * 100;
  const isLast = currentIdx === exam.questions.length - 1;
  const answeredCount = Object.keys(answers).length;
  const isSingle = q ? SINGLE_ANSWER_TYPES.includes(q.type) : false;

  return (
    <Shell title={testType === "PRE_TEST" ? t("publicExam.titlePreTest") : t("publicExam.titleFinalTest")}>
      {/* Header info */}
      <Card className="p-3 flex items-center justify-between text-sm">
        <span className="font-medium">{info?.sessionTitle}</span>
        {remaining && (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3.5 w-3.5" />
            {remaining}
          </span>
        )}
      </Card>

      {/* Progress */}
      <div className="space-y-1">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>{t("publicExam.question", { current: String(currentIdx + 1), total: String(exam.questions.length) })}</span>
          <span>{t("publicExam.answered", { answered: String(answeredCount), total: String(exam.questions.length) })}</span>
        </div>
        <Progress value={progress} className="h-1.5" />
      </div>

      {/* Question card */}
      {q && (
        <Card className="p-5 space-y-4">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Q{q.order} · {q.points} pt{q.points !== 1 ? "s" : ""}</div>
            <p className="text-sm font-medium leading-relaxed">
              {locale === "ar" && q.textAr ? q.textAr : q.text}
            </p>
          </div>
          {q.imageUrl && (
            <img src={q.imageUrl} alt="Question figure" className="max-h-48 rounded-md border mx-auto" />
          )}
          <div className="space-y-2">
            {q.options.map((opt, i) => {
              const optText = locale === "ar" && q.optionsAr?.[i] ? q.optionsAr[i] : opt;
              const selected = answers[q.id]?.includes(i) ?? false;
              if (isSingle) {
                return (
                  <label
                    key={i}
                    className={`flex items-start gap-3 rounded-md border p-3 text-sm cursor-pointer transition-colors ${selected ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                    onClick={() => setAnswer(q.id, [i])}
                  >
                    <div className="mt-0.5">
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${selected ? "border-primary" : "border-muted-foreground/50"}`}>
                        {selected && <div className="w-2 h-2 rounded-full bg-primary" />}
                      </div>
                    </div>
                    <span className="flex-1">{optText}</span>
                  </label>
                );
              }
              return (
                <label
                  key={i}
                  className={`flex items-start gap-3 rounded-md border p-3 text-sm cursor-pointer transition-colors ${selected ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
                >
                  <Checkbox
                    checked={selected}
                    onCheckedChange={(checked) => {
                      const current = answers[q.id] ?? [];
                      if (checked) setAnswer(q.id, [...current, i]);
                      else setAnswer(q.id, current.filter((x) => x !== i));
                    }}
                    className="mt-0.5"
                  />
                  <span className="flex-1">{optText}</span>
                </label>
              );
            })}
          </div>
        </Card>
      )}

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          onClick={() => setCurrentIdx((i) => Math.max(0, i - 1))}
          disabled={currentIdx === 0}
        >
          <ChevronLeft className="h-4 w-4 me-1" />
          {t("publicExam.previous")}
        </Button>
        {isLast ? (
          <Button onClick={() => void handleSubmit(false)}>
            <Send className="h-4 w-4 me-1.5" />
            {t("publicExam.submit")}
          </Button>
        ) : (
          <Button onClick={() => setCurrentIdx((i) => Math.min(exam.questions.length - 1, i + 1))}>
            {t("publicExam.next")}
            <ChevronRight className="h-4 w-4 ms-1" />
          </Button>
        )}
      </div>
    </Shell>
  );
}
