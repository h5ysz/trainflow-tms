"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { CertReleasePanel } from "@/components/common/cert-release-panel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CalendarDays, ArrowLeft, ArrowRight, Users, Play, Pause, RotateCcw, CheckCircle2,
  GraduationCap, QrCode, BadgeCheck, Plus, Trash2, AlertCircle, Loader2, Building2,
  RefreshCw, ArrowRightLeft,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";
import { QrImage } from "@/components/common/qr-image";
import { buildCheckInUrl } from "@/lib/qr/urls";

interface TraineeOption { id: string; fullName: string; refNumber: string; }
interface TrainerOption { id: string; fullName: string; }

interface Session {
  id: string;
  refNumber: string;
  title: string;
  status: string;
  lifecycleStatus: string;
  startDate: string;
  endDate: string;
  trainerId?: string | null;
  qrToken?: string | null;
  courseTitle?: string | null;
}

interface Enrollment {
  id: string;
  traineeId: string;
  trainee?: { id: string; fullName: string; refNumber: string } | null;
  company?: { id: string; name: string } | null;
  attendanceStatus?: string | null;
  preTestStatus?: string | null;
  finalTestStatus?: string | null;
  evaluationStatus?: string | null;
  certificateStatus?: string | null;
}

interface CompanySummary {
  companyId: string;
  companyName: string | null;
  traineeCount: number;
}

interface CertResult {
  traineeName: string;
  generated: boolean;
  reason?: string | null;
  certificateRef?: string | null;
}

// Mirrors LIFECYCLE_TRANSITIONS in src/app/api/sessions/[id]/lifecycle/route.ts.
const LIFECYCLE_TRANSITIONS: Record<string, string[]> = {
  NOT_STARTED: ["STARTED"],
  STARTED: ["BREAK", "COMPLETED"],
  ON_BREAK: ["RESUMED", "COMPLETED"],
  COMPLETED: [],
};

const EVENT_ICONS = {
  STARTED: Play,
  BREAK: Pause,
  RESUMED: RotateCcw,
  COMPLETED: CheckCircle2,
} as const;

type LifecycleEvent = keyof typeof EVENT_ICONS;

export function SessionDetailRoute() {
  const { t, locale, dir } = useI18n();
  const { toast } = useToast();
  const { user, routeParam, navigate } = useAppStore();

  const sessionId = routeParam;
  const canEdit = user ? canPerformAction(user.permissions, "sessions", "edit") : false;

  const [session, setSession] = useState<Session | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [trainees, setTrainees] = useState<TraineeOption[]>([]);
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);
  const [selectedTrainee, setSelectedTrainee] = useState("");
  const [selectedTrainer, setSelectedTrainer] = useState("");
  const [removeTarget, setRemoveTarget] = useState<Enrollment | null>(null);
  const [certResults, setCertResults] = useState<CertResult[] | null>(null);

  // ── Replace Trainee state ──
  const [replaceTarget, setReplaceTarget] = useState<Enrollment | null>(null);
  const [replaceTraineeId, setReplaceTraineeId] = useState("");
  const [replaceReason, setReplaceReason] = useState("");

  // ── Move Trainee state ──
  // moveTarget holds the enrollment(s) being moved. When multiple rows are
  // selected, moveTarget is set to a sentinel and selectedEnrollments is used.
  const [moveTarget, setMoveTarget] = useState<Enrollment | null>(null);
  const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState<Set<string>>(new Set());
  const [targetSessionId, setTargetSessionId] = useState("");
  const [availableSessions, setAvailableSessions] = useState<{ id: string; refNumber: string; title: string }[]>([]);

  const Back = dir === "rtl" ? ArrowRight : ArrowLeft;

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const [s, enr] = await Promise.all([
        api.get<Session>(`/sessions/${sessionId}`),
        // Note: this endpoint returns an object, not an array — useList can't be used.
        api.get<{ enrollments: Enrollment[]; companies: CompanySummary[] }>(
          `/sessions/${sessionId}/enrollments`
        ),
      ]);
      setSession(s);
      setSelectedTrainer(s.trainerId ?? "");
      setEnrollments(enr.enrollments ?? []);
      setCompanies(enr.companies ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // Async data load; state is written from inside the awaited call.
  useEffect(() => {
    const handle = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(handle);
  }, [load]);

  useEffect(() => {
    if (!enrollOpen && !replaceTarget) return;
    if (trainees.length === 0) {
      api.getList<TraineeOption>("/trainees", { pageSize: 100 })
        .then((r) => setTrainees(r.rows.map((x) => ({ id: x.id, fullName: x.fullName, refNumber: x.refNumber }))))
        .catch(() => {});
    }
  }, [enrollOpen, replaceTarget, trainees.length]);

  useEffect(() => {
    if (trainers.length === 0) {
      api.getList<TrainerOption>("/trainers", { pageSize: 100 })
        .then((r) => setTrainers(r.rows.map((x) => ({ id: x.id, fullName: x.fullName }))))
        .catch(() => {});
    }
  }, [trainers.length]);

  // Load available sessions (same course) when the Move dialog opens.
  useEffect(() => {
    if (!moveTarget && selectedEnrollmentIds.size === 0) return;
    if (availableSessions.length > 0) return;
    api.getList<{ id: string; refNumber: string; title: string }>("/sessions", { pageSize: 100 })
      .then((r) => setAvailableSessions(
        r.rows
          .filter((s) => s.id !== sessionId)
          .map((s) => ({ id: s.id, refNumber: s.refNumber, title: s.title }))
      ))
      .catch(() => {});
  }, [moveTarget, selectedEnrollmentIds, availableSessions.length, sessionId]);

  // A detail route with no subject: send the user back to the list.
  if (!sessionId) {
    return (
      <div className="space-y-5">
        <EmptyState
          icon={CalendarDays}
          title={t("sessions.title")}
          subtitle={t("sessions.empty.subtitle")}
          action={<Button onClick={() => navigate("sessions")}>{t("sessions.title")}</Button>}
        />
      </div>
    );
  }

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

  const fireLifecycle = (eventType: LifecycleEvent) =>
    run(eventType, async () => {
      const res = await api.post<{ lifecycleStatus: string; finalTestsAssigned?: number; noShowCount?: number }>(
        `/sessions/${sessionId}/lifecycle`,
        { eventType }
      );
      const extra: string[] = [];
      if (res.finalTestsAssigned) extra.push(`${t("session.finalTestsAssigned")}: ${res.finalTestsAssigned}`);
      if (res.noShowCount) extra.push(`${t("session.noShows")}: ${res.noShowCount}`);
      toast({
        title: t("misc.success"),
        description: extra.length ? extra.join(" · ") : res.lifecycleStatus,
      });
      await load();
    });

  const enroll = () =>
    run("enroll", async () => {
      await api.post(`/sessions/${sessionId}/enrollments`, { traineeId: selectedTrainee });
      toast({ title: t("misc.success"), description: t("misc.createSuccess") });
      setEnrollOpen(false);
      setSelectedTrainee("");
      await load();
    });

  const removeEnrollment = () =>
    run("remove", async () => {
      if (!removeTarget) return;
      await api.delete(`/sessions/${sessionId}/enrollments/${removeTarget.id}`);
      toast({ title: t("misc.success"), description: t("misc.deleteSuccess") });
      setRemoveTarget(null);
      await load();
    });

  const assignTrainer = () =>
    run("trainer", async () => {
      await api.post(`/sessions/${sessionId}/assign-trainer`, { trainerId: selectedTrainer });
      toast({ title: t("misc.success"), description: t("misc.updateSuccess") });
      await load();
    });

  // ── Replace Trainee: swap one enrolled trainee for another in a single
  // atomic operation. Calls the dedicated /replace-trainee endpoint.
  const replaceTrainee = () =>
    run("replace", async () => {
      if (!replaceTarget || !replaceTraineeId) return;
      await api.post(`/sessions/${sessionId}/replace-trainee`, {
        oldTraineeId: replaceTarget.traineeId,
        newTraineeId: replaceTraineeId,
        reason: replaceReason || undefined,
      });
      toast({ title: t("misc.success"), description: t("session.replaceSuccess") || t("misc.updateSuccess") });
      setReplaceTarget(null);
      setReplaceTraineeId("");
      setReplaceReason("");
      await load();
    });

  // ── Move Trainee(s): transfer one or more enrollments to another session.
  // Uses the existing /move-trainees endpoint which already handles capacity
  // checks, audit logging, and count recomputation.
  const moveTrainees = () =>
    run("move", async () => {
      if (!targetSessionId) return;
      const traineeIds = moveTarget
        ? [moveTarget.traineeId]
        : enrollments.filter((e) => selectedEnrollmentIds.has(e.id)).map((e) => e.traineeId);
      if (traineeIds.length === 0) return;
      await api.post(`/sessions/${sessionId}/move-trainees`, {
        targetSessionId,
        traineeIds,
      });
      toast({
        title: t("misc.success"),
        description: t("session.moveSuccess", { count: traineeIds.length }) || t("misc.updateSuccess"),
      });
      setMoveTarget(null);
      setSelectedEnrollmentIds(new Set());
      setTargetSessionId("");
      await load();
    });

  const activateQr = () =>
    run("qr", async () => {
      await api.post(`/sessions/${sessionId}/qr-activate`, {});
      toast({ title: t("misc.success"), description: t("session.qrActivated") });
      await load();
    });

  const generateCertificates = () =>
    run("certs", async () => {
      const res = await api.post<{ generated: number; skipped: number; results: CertResult[] }>(
        `/sessions/${sessionId}/generate-certificates`,
        {}
      );
      setCertResults(res.results ?? []);
      toast({
        title: t("misc.success"),
        description: `${t("session.generated")}: ${res.generated} · ${t("session.skipped")}: ${res.skipped}`,
      });
      await load();
    });

  const lifecycleStatus = session?.lifecycleStatus ?? "NOT_STARTED";
  const allowed = LIFECYCLE_TRANSITIONS[lifecycleStatus] ?? [];

  const enrollmentColumns: Column<Enrollment>[] = [
    {
      key: "trainee",
      header: t("evaluation.trainee"),
      cell: (r) => (
        <div>
          <div className="text-sm font-medium">{r.trainee?.fullName ?? "—"}</div>
          <div className="text-[10px] font-mono text-muted-foreground">{r.trainee?.refNumber}</div>
        </div>
      ),
    },
    {
      key: "company",
      header: t("attendance.company"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Building2 className="h-3 w-3" />{r.company?.name ?? "—"}
        </div>
      ),
    },
    { key: "attendance", header: t("nav.attendance"), cell: (r) => <StatusBadge status={r.attendanceStatus ?? "PENDING"} /> },
    { key: "preTest", header: t("nav.preTest"), cell: (r) => <StatusBadge status={r.preTestStatus ?? "PENDING"} /> },
    { key: "finalTest", header: t("nav.finalTest"), cell: (r) => <StatusBadge status={r.finalTestStatus ?? "PENDING"} /> },
    { key: "evaluation", header: t("nav.evaluation"), cell: (r) => <StatusBadge status={r.evaluationStatus ?? "PENDING"} /> },
    { key: "certificate", header: t("nav.certificates"), cell: (r) => <StatusBadge status={r.certificateStatus ?? "PENDING"} /> },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: (row) =>
        canEdit ? (
          <div className="inline-flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => { setReplaceTarget(row); setReplaceTraineeId(""); setReplaceReason(""); }}
              title={t("session.replaceTrainee") || "Replace Trainee"}
              disabled={row.certificateStatus === "ISSUED"}
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => { setMoveTarget(row); setSelectedEnrollmentIds(new Set()); setTargetSessionId(""); }}
              title={t("session.moveTrainee") || "Move to Another Session"}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive"
              onClick={() => setRemoveTarget(row)}
              title={t("action.delete") || "Remove"}
              disabled={row.certificateStatus === "ISSUED"}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={session ? `${session.refNumber} — ${session.title}` : t("sessions.title")}
        subtitle={session?.courseTitle ?? t("sessions.subtitle")}
        icon={CalendarDays}
        actions={
          <Button variant="outline" onClick={() => navigate("sessions")}>
            <Back className="h-4 w-4 me-1.5" />
            {t("action.back")}
          </Button>
        }
      />

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          {t("table.loading")}
        </div>
      ) : (
        <Tabs defaultValue="enrollments">
          <TabsList>
            <TabsTrigger value="enrollments">{t("session.enrollments")}</TabsTrigger>
            <TabsTrigger value="lifecycle">{t("session.lifecycle")}</TabsTrigger>
            <TabsTrigger value="trainer">{t("nav.trainers")}</TabsTrigger>
            <TabsTrigger value="qr">{t("nav.qrCode")}</TabsTrigger>
            <TabsTrigger value="certificates">{t("nav.certificates")}</TabsTrigger>
            <TabsTrigger value="release">{t("certRelease.title")}</TabsTrigger>
          </TabsList>

          <TabsContent value="enrollments" className="mt-4 space-y-4">
            {companies.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {companies.map((c) => (
                  <Badge key={c.companyId} variant="secondary" className="gap-1.5">
                    <Building2 className="h-3 w-3" />
                    {c.companyName} · {c.traineeCount}
                  </Badge>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {enrollments.length} {t("session.enrolled")}
              </p>
              {canEdit && (
                <Button onClick={() => setEnrollOpen(true)}>
                  <Plus className="h-4 w-4 me-1.5" />
                  {t("session.enroll")}
                </Button>
              )}
            </div>

            <DataTable
              columns={enrollmentColumns}
              data={enrollments}
              rowKey={(r) => r.id}
              emptyIcon={Users}
              emptyTitle={t("session.noEnrollments")}
              emptySubtitle={t("session.noEnrollmentsSubtitle")}
            />
          </TabsContent>

          <TabsContent value="lifecycle" className="mt-4">
            <Card className="p-6 space-y-5">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">{t("session.lifecycleStatus")}</span>
                <StatusBadge status={lifecycleStatus} />
              </div>

              <div className="flex flex-wrap gap-2">
                {(Object.keys(EVENT_ICONS) as LifecycleEvent[]).map((ev) => {
                  const Icon = EVENT_ICONS[ev];
                  const enabled = canEdit && allowed.includes(ev);
                  return (
                    <Button
                      key={ev}
                      variant={ev === "COMPLETED" ? "default" : "outline"}
                      disabled={!enabled || busy === ev}
                      onClick={() => void fireLifecycle(ev)}
                    >
                      {busy === ev ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <Icon className="h-4 w-4 me-1.5" />}
                      {t(`session.event.${ev}`)}
                    </Button>
                  );
                })}
              </div>

              <p className="text-xs text-muted-foreground">
                {allowed.length === 0 ? t("session.lifecycleDone") : t("session.lifecycleHint")}
              </p>

            </Card>
          </TabsContent>

          <TabsContent value="trainer" className="mt-4">
            <Card className="p-6 space-y-4 max-w-lg">
              <Field label={t("sessions.trainer")}>
                <Select value={selectedTrainer} onValueChange={setSelectedTrainer}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {trainers.map((x) => <SelectItem key={x.id} value={x.id}>{x.fullName}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Button disabled={!canEdit || !selectedTrainer || busy === "trainer"} onClick={() => void assignTrainer()}>
                {busy === "trainer" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <GraduationCap className="h-4 w-4 me-1.5" />}
                {t("session.assignTrainer")}
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="qr" className="mt-4">
            <Card className="p-6 space-y-4 max-w-lg text-center">
              {session?.qrToken ? (
                <>
                  <QrImage
                    value={buildCheckInUrl(typeof window === "undefined" ? "" : window.location.origin, session.qrToken)}
                    size={168}
                    className="mx-auto border"
                    label={t("qr.title")}
                  />
                  <Input
                    readOnly
                    value={buildCheckInUrl(typeof window === "undefined" ? "" : window.location.origin, session.qrToken)}
                    onFocus={(e) => e.target.select()}
                    className="font-mono text-xs"
                  />
                </>
              ) : (
                <div className="flex h-36 w-36 mx-auto items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/20">
                  <QrCode className="h-10 w-10 text-muted-foreground/40" />
                </div>
              )}
              <Button disabled={!canEdit || busy === "qr"} onClick={() => void activateQr()}>
                {busy === "qr" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <QrCode className="h-4 w-4 me-1.5" />}
                {t("session.activateQr")}
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="certificates" className="mt-4 space-y-4">
            <Card className="p-6 space-y-3">
              <p className="text-sm text-muted-foreground">{t("session.certificatesHint")}</p>
              <Button disabled={!canEdit || busy === "certs"} onClick={() => void generateCertificates()}>
                {busy === "certs" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <BadgeCheck className="h-4 w-4 me-1.5" />}
                {t("session.generateCertificates")}
              </Button>
            </Card>

            {certResults && (
              <Card className="p-0 divide-y">
                {certResults.map((r, i) => (
                  <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>{r.traineeName}</span>
                    {r.generated ? (
                      <span className="flex items-center gap-1.5 text-success text-xs font-medium">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {r.certificateRef ?? t("session.generated")}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">{r.reason ?? t("session.skipped")}</span>
                    )}
                  </div>
                ))}
              </Card>
            )}
          </TabsContent>

          <TabsContent value="release" className="mt-4">
            {session && <CertReleasePanel sessionId={session.id} />}
          </TabsContent>
        </Tabs>
      )}

      <FormDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        title={t("session.enroll")}
        icon={Users}
        size="sm"
        isSubmitting={busy === "enroll"}
        onSubmit={() => selectedTrainee && void enroll()}
      >
        <Field label={t("evaluation.trainee")} required>
          <Select value={selectedTrainee} onValueChange={setSelectedTrainee}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {trainees.map((x) => (
                <SelectItem key={x.id} value={x.id}>{x.fullName} ({x.refNumber})</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </FormDialog>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        description={removeTarget?.trainee?.fullName}
        destructive
        loading={busy === "remove"}
        onConfirm={() => void removeEnrollment()}
      />

      {/* ── Replace Trainee Dialog ── */}
      <FormDialog
        open={replaceTarget !== null}
        onOpenChange={(o) => { if (!o) { setReplaceTarget(null); setReplaceTraineeId(""); setReplaceReason(""); } }}
        title={t("session.replaceTrainee") || "Replace Trainee"}
        description={`${t("action.replace") || "Replace"}: ${replaceTarget?.trainee?.fullName ?? "—"}`}
        icon={RefreshCw}
        size="md"
        onSubmit={replaceTrainee}
        isSubmitting={busy === "replace"}
      >
        <div className="space-y-4">
          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            <div className="font-medium text-foreground mb-1">{replaceTarget?.trainee?.fullName ?? "—"}</div>
            <div>{t("session.replaceHint") || "Select a new trainee to replace the above. The old enrollment will be cancelled."}</div>
          </div>
          <Field label={t("session.newTrainee") || "New Trainee"} required>
            <Select value={replaceTraineeId} onValueChange={setReplaceTraineeId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {trainees
                  .filter((tr) => tr.id !== replaceTarget?.traineeId)
                  .map((tr) => (
                    <SelectItem key={tr.id} value={tr.id}>
                      {tr.fullName} {tr.refNumber ? `(${tr.refNumber})` : ""}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("session.reason") || "Reason (optional)"}>
            <Input
              value={replaceReason}
              onChange={(e) => setReplaceReason(e.target.value)}
              placeholder={t("session.reasonPlaceholder") || "e.g. Trainee could not attend"}
            />
          </Field>
        </div>
      </FormDialog>

      {/* ── Move Trainee Dialog ── */}
      <FormDialog
        open={moveTarget !== null || selectedEnrollmentIds.size > 0}
        onOpenChange={(o) => { if (!o) { setMoveTarget(null); setSelectedEnrollmentIds(new Set()); setTargetSessionId(""); } }}
        title={t("session.moveTrainee") || "Move Trainee to Another Session"}
        description={
          moveTarget
            ? `${t("action.move") || "Move"}: ${moveTarget.trainee?.fullName ?? "—"}`
            : `${t("action.move") || "Move"} ${selectedEnrollmentIds.size} trainee(s)`
        }
        icon={ArrowRightLeft}
        size="md"
        onSubmit={moveTrainees}
        isSubmitting={busy === "move"}
      >
        <div className="space-y-4">
          <div className="rounded-md border bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-700 dark:text-amber-400">
            {t("session.moveHint") || "Trainees can only be moved to sessions of the same course. Capacity will be checked."}
          </div>
          <Field label={t("session.targetSession") || "Target Session"} required>
            <Select value={targetSessionId} onValueChange={setTargetSessionId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {availableSessions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.refNumber} — {s.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </FormDialog>
    </div>
  );
}
