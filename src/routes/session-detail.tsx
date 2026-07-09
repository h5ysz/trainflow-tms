"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CalendarDays, ArrowLeft, ArrowRight, Users, Play, Pause, RotateCcw, CheckCircle2,
  GraduationCap, QrCode, BadgeCheck, Plus, Trash2, AlertCircle, Loader2, Building2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";

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
  const canEdit = user ? canPerformAction(user.role, "sessions", "edit") : false;

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

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!enrollOpen) return;
    if (trainees.length === 0) {
      api.getList<TraineeOption>("/trainees", { pageSize: 100 })
        .then((r) => setTrainees(r.rows.map((x) => ({ id: x.id, fullName: x.fullName, refNumber: x.refNumber }))))
        .catch(() => {});
    }
  }, [enrollOpen, trainees.length]);

  useEffect(() => {
    if (trainers.length === 0) {
      api.getList<TrainerOption>("/trainers", { pageSize: 100 })
        .then((r) => setTrainers(r.rows.map((x) => ({ id: x.id, fullName: x.fullName }))))
        .catch(() => {});
    }
  }, [trainers.length]);

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

  const activateQr = () =>
    run("qr", async () => {
      await api.post(`/sessions/${sessionId}/qr-activate`, {});
      toast({ title: t("misc.success"), description: t("session.qrActivated") });
      await load();
    });

  const generateFromRequest = () =>
    run("fromRequest", async () => {
      await api.post(`/sessions/${sessionId}/generate-from-request`, {});
      toast({ title: t("misc.success"), description: t("misc.updateSuccess") });
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
          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setRemoveTarget(row)}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
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

              <div className="border-t pt-4">
                <Button variant="outline" disabled={!canEdit || busy === "fromRequest"} onClick={() => void generateFromRequest()}>
                  {busy === "fromRequest" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : null}
                  {t("session.generateFromRequest")}
                </Button>
              </div>
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
              {/* Visual QR placeholder — a real QR lib can be plugged in here. */}
              <div className="flex h-36 w-36 mx-auto items-center justify-center rounded-xl border-2 border-dashed border-primary/40 bg-primary/5">
                <QrCode className="h-14 w-14 text-primary/60" />
              </div>
              {session?.qrToken && (
                <Input readOnly value={session.qrToken} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
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
    </div>
  );
}
