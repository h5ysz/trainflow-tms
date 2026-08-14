"use client";

// GCCLAB TMS — Standalone Exam Questions manager.
// A trainer prepares each session's exam question sets here, days ahead of the
// exam: the overview lists sessions with the readiness of their Pre-Test and
// Final-Test sets, and "Manage questions" opens the full generate -> preview ->
// approve workflow (correct answers + images) without entering the session page.
import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";
import { api } from "@/lib/api/client";
import { PageHeader } from "@/components/common/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SessionExamSets } from "@/components/common/session-exam-sets";
import {
  ListChecks,
  Search,
  Loader2,
  AlertCircle,
  FileCheck2,
  FilePen,
  Circle,
  CalendarDays,
  ArrowLeft,
  X,
} from "lucide-react";

type TestType = "PRE_TEST" | "FINAL_TEST";
type SetState = "APPROVED" | "DRAFT" | "NONE";

interface SetSummary {
  state: SetState;
  approved: { id: string; version: number; numQuestions: number; approvedAt: string | Date | null } | null;
  draft: { id: string; version: number; numQuestions: number } | null;
}

interface OverviewSession {
  id: string;
  refNumber: string;
  title: string;
  status: string;
  startDate: string | Date;
  endDate: string | Date;
  trainerId?: string | null;
  course: { id: string; code: string | null; title: string } | null;
  sets: Record<TestType, SetSummary>;
}

function fmtDate(d?: string | Date | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
}

function StateChip({ state }: { state: SetState }) {
  const { t } = useI18n();
  if (state === "APPROVED") {
    return (
      <Badge className="bg-success/10 text-success border-success/20">
        <FileCheck2 className="h-3.5 w-3.5 me-1" />
        {t("examSet.ready")}
      </Badge>
    );
  }
  if (state === "DRAFT") {
    return (
      <Badge className="bg-amber-100/70 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-300/40">
        <FilePen className="h-3.5 w-3.5 me-1" />
        {t("examSet.draftExists")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground">
      <Circle className="h-3.5 w-3.5 me-1" />
      {t("examSet.notReady")}
    </Badge>
  );
}

export function ExamSetsRoute() {
  const { t, locale } = useI18n();
  const { user } = useAppStore();

  const [sessions, setSessions] = useState<OverviewSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeSession, setActiveSession] = useState<OverviewSession | null>(null);

  const canManage = user
    ? canPerformAction(user.permissions, "pre-test", "edit") || canPerformAction(user.permissions, "final-test", "edit")
    : false;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<{ sessions: OverviewSession[] }>("/exam-sets/overview");
      setSessions(res.sessions ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(handle);
  }, [load]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? sessions.filter((s) =>
        [s.refNumber, s.title, s.course?.title, s.course?.code]
          .filter(Boolean)
          .some((v) => (v as string).toLowerCase().includes(q))
      )
    : sessions;

  return (
    <div className="p-6 space-y-5">
      <PageHeader
        title={t("examSet.overviewTitle")}
        subtitle={t("examSet.overviewSubtitle")}
        icon={ListChecks}
      />

      <div className="relative w-full sm:max-w-sm">
        <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="ps-9"
          placeholder={t("examSet.searchPlaceholder")}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border bg-card p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("table.loading")}
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center text-sm text-muted-foreground">
          {t("examSet.noSessions")}
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {filtered.map((s) => (
            <Card key={s.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-primary">{s.refNumber}</span>
                    <Badge variant="outline" className="text-muted-foreground">
                      {s.status}
                    </Badge>
                  </div>
                  <p className="mt-0.5 truncate text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.course ? `${t("examSet.course")}: ${s.course.code ?? ""} ${s.course.title}` : "—"}
                  </p>
                  <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {fmtDate(s.startDate)} → {fmtDate(s.endDate)}
                  </p>
                </div>

                <div className="flex flex-col items-end gap-2">
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <StateChip state={s.sets.PRE_TEST.state} />
                    <StateChip state={s.sets.FINAL_TEST.state} />
                  </div>
                  <Button size="sm" onClick={() => setActiveSession(s)}>
                    <FilePen className="h-4 w-4 me-1.5" />
                    {t("examSet.manage")}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={activeSession !== null} onOpenChange={(o) => { if (!o) setActiveSession(null); }}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="-ms-2 px-2"
                onClick={() => setActiveSession(null)}
                title={t("examSet.backToList")}
              >
                <ArrowLeft className="h-4 w-4 rtl:rotate-180" />
              </Button>
              <span>{t("examSet.openManager")} — {activeSession?.refNumber}</span>
              <span className="text-xs font-normal text-muted-foreground truncate">
                {activeSession?.course ? `${activeSession.course.code ?? ""} ${activeSession.course.title}` : ""}
              </span>
            </DialogTitle>
            <DialogDescription className="flex items-center gap-1.5">
              <CalendarDays className="h-3.5 w-3.5" />
              {fmtDate(activeSession?.startDate)} → {fmtDate(activeSession?.endDate)}
              <span className="mx-1 text-muted-foreground/40">·</span>
              <span className="uppercase">{activeSession?.status}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {activeSession ? (
              <SessionExamSets sessionId={activeSession.id} canManage={canManage} />
            ) : null}
          </div>

          <div className="flex justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => setActiveSession(null)}>
              <X className="h-4 w-4 me-1.5" />
              {locale === "en" ? "Close" : "إغلاق"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
