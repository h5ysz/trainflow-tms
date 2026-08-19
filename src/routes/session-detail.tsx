"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { EnrollTraineeDialog } from "@/components/common/enroll-trainee-dialog";
import { CompanyTraineePicker } from "@/components/common/company-trainee-picker";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { CertReleasePanel } from "@/components/common/cert-release-panel";
import { SessionContactDirectory } from "@/components/common/session-contact-directory";
import { SessionExamSets } from "@/components/common/session-exam-sets";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CalendarDays, ArrowLeft, ArrowRight, Users, Play, Pause, RotateCcw, CheckCircle2,
  GraduationCap, QrCode, BadgeCheck, Plus, Trash2, AlertCircle, Loader2, Building2, Fingerprint,
  RefreshCw, ArrowRightLeft, ClipboardCheck, Zap, UserCheck,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";
import { QrImage } from "@/components/common/qr-image";
import { buildCheckInUrl, buildPreTestUrl, buildFinalTestUrl, buildEvaluationUrl } from "@/lib/qr/urls";
import { trainerName } from "@/lib/i18n/trainer-name";

interface TrainerOption { id: string; nameEn: string; nameAr?: string | null; }

interface Session {
  id: string;
  refNumber: string;
  title: string;
  status: string;
  lifecycleStatus: string;
  startDate: string;
  endDate: string;
  trainerId?: string | null;
  qrCodeToken?: string | null;
  preTestQrToken?: string | null;
  finalTestQrToken?: string | null;
  evaluationQrToken?: string | null;
  courseId?: string | null;
  courseTitle?: string | null;
}

interface Enrollment {
  id: string;
  traineeId: string;
  trainee?: {
    id: string;
    fullName: string;
    refNumber: string;
    nationalId?: string | null;
    nationality?: string | null;
    jobTitle?: string | null;
    mobile?: string | null;
    email?: string | null;
    documents?: Array<{ url: string; filename: string; type: string; uploadedAt: string }> | null;
  } | null;
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

/** Format a Date as a local `datetime-local` input value: YYYY-MM-DDTHH:mm. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function SessionDetailRoute() {
  const { t, locale, dir } = useI18n();
  const { toast } = useToast();
  const { user, routeParam, navigate } = useAppStore();

  const sessionId = routeParam;
  const canEdit = user ? canPerformAction(user.permissions, "sessions", "edit") : false;

  // Trainer-owned exam question sets are authorized against the pre-test /
  // final-test modules (the same modules that authorize the Question Bank).
  // The coordinator does NOT manage tests — they start/end the session only —
  // so the Exams tab (exam preparation) is never rendered for them even if a
  // stale Role row still carries a pre-test/final-test grant.
  const canViewExams =
    !!user && user.role !== "COORDINATOR"
      ? canPerformAction(user.permissions, "pre-test", "view") || canPerformAction(user.permissions, "final-test", "view")
      : false;

  // The session barcode (QR) is a trainer delivery tool for check-in — the
  // coordinator never generates/activates a barcode for sessions, so the tab is
  // hidden for them even if a stale Role row still carries a qr-code grant.
  const canViewQr =
    !!user && user.role !== "COORDINATOR"
      ? canPerformAction(user.permissions, "qr-code", "view")
      : false;
  const canManageExams = user
    ? canPerformAction(user.permissions, "pre-test", "edit") || canPerformAction(user.permissions, "final-test", "edit")
    : false;

  const [session, setSession] = useState<Session | null>(null);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [companies, setCompanies] = useState<CompanySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [enrollOpen, setEnrollOpen] = useState(false);
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);
  const [selectedTrainer, setSelectedTrainer] = useState("");
  const [removeTarget, setRemoveTarget] = useState<Enrollment | null>(null);
  const [certResults, setCertResults] = useState<CertResult[] | null>(null);
  const [qrFrom, setQrFrom] = useState("");
  const [qrTo, setQrTo] = useState("");
  const [manualTarget, setManualTarget] = useState<Enrollment | null>(null);

  // ── Replace Trainee state ──
  const [replaceTarget, setReplaceTarget] = useState<Enrollment | null>(null);
  const [replaceTraineeId, setReplaceTraineeId] = useState("");
  const [replaceReason, setReplaceReason] = useState("");

  // ── Move Trainee state ──
  const [moveTarget, setMoveTarget] = useState<Enrollment | null>(null);
  const [selectedEnrollmentIds, setSelectedEnrollmentIds] = useState<Set<string>>(new Set());
  const [targetSessionId, setTargetSessionId] = useState("");
  const [availableSessions, setAvailableSessions] = useState<{ id: string; refNumber: string; title: string; startDate: string; courseId: string; courseTitle: string | null }[]>([]);

  // ── Retest state ──
  const [retestTarget, setRetestTarget] = useState<Enrollment | null>(null);
  const [retestSessions, setRetestSessions] = useState<{ id: string; refNumber: string; title: string }[]>([]);
  const [retestForm, setRetestForm] = useState({
    retestSessionId: "",
    retestTrainerId: "",
    retestDate: "",
    retestShift: "MORNING",
    retestLocation: "",
    retestVenue: "",
    reason: "",
    moveTrainee: false,
  });

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
    if (trainers.length === 0) {
      api.getList<TrainerOption>("/trainers", { pageSize: 100 })
        .then((r) => setTrainers(r.rows.map((x) => ({ id: x.id, nameEn: x.nameEn, nameAr: x.nameAr }))))
        .catch(() => {});
    }
  }, [trainers.length]);

  // Prefill the QR window once the session is known: from "now" (so the QR can
  // be activated at any moment, even mid-session) to the session end (or now+1h).
  useEffect(() => {
    if (!session) return;
    if (qrFrom !== "" || qrTo !== "") return;
    const now = new Date();
    const toRaw = session.endDate ? new Date(session.endDate) : new Date(now.getTime() + 60 * 60 * 1000);
    if (toRaw <= now) toRaw.setTime(now.getTime() + 60 * 60 * 1000);
    setQrFrom(toLocalInput(now));
    setQrTo(toLocalInput(toRaw));
  }, [session, qrFrom, qrTo]);

  // Load available sessions (same course) when the Move OR Retest dialog opens.
  useEffect(() => {
    if (!moveTarget && selectedEnrollmentIds.size === 0 && !retestTarget) return;
    if (availableSessions.length > 0) return;
    api.getList<{ id: string; refNumber: string; title: string; startDate: string; courseId: string; courseTitle: string | null }>("/sessions", { pageSize: 100 })
      .then((r) => setAvailableSessions(
        r.rows
          .filter((s) => s.id !== sessionId)
          .map((s) => ({ id: s.id, refNumber: s.refNumber, title: s.title, startDate: s.startDate, courseId: s.courseId, courseTitle: s.courseTitle }))
      ))
      .catch(() => {});
  }, [moveTarget, selectedEnrollmentIds, retestTarget, availableSessions.length, sessionId]);

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

  // ── Trainer Immediate Opportunity: gives the trainee ONE immediate
  // additional chance in the SAME session. No scheduling, no notification,
  // no official retest. Just marks the enrollment's trainerOpportunityUsed
  // field + records pass/fail.
  //
  // Business rules:
  //   - Only the ASSIGNED trainer (or coordinator/admin) can use this.
  //   - Only before session status = COMPLETED.
  //   - Only once per enrollment.
  //   - Does NOT create a RetestRequest record.
  //   - Does NOT notify the contractor.
  const giveTrainerOpportunity = (row: Enrollment) =>
    run("opportunity", async () => {
      // Ask the trainer whether the trainee passed or failed the opportunity.
      // We use a simple confirm() for now — a proper dialog could be added later.
      const passed = window.confirm(
        t("session.trainerOpportunityConfirm") ||
        "Did the trainee PASS the immediate opportunity? Click OK for PASS, Cancel for FAIL."
      );
      await api.post(`/api/sessions/${sessionId}/enrollments/${row.id}/trainer-opportunity`, {
        passed,
      });
      toast({
        title: t("misc.success"),
        description: passed
          ? (t("session.trainerOpportunityPassed") || "Trainee passed the opportunity — certificate workflow continues.")
          : (t("session.trainerOpportunityFailed") || "Trainee failed the opportunity — awaiting official retest."),
      });
      await load();
    });

  // ── Retest: create + schedule a retest for a failed trainee.
  // This is a two-step process:
  //   1. POST /api/retests — creates the retest request (status=PENDING_RETEST)
  //   2. POST /api/retests/[id] with action=schedule — schedules it
  // Both steps happen in a single UI action for the user's convenience.
  const scheduleRetest = () =>
    run("retest", async () => {
      if (!retestTarget) return;
      // Step 1: create the retest request
      const created = await api.post<{ id: string; refNumber: string }>("/api/retests", {
        enrollmentId: retestTarget.id,
        sessionId,
        reason: retestForm.reason || undefined,
      });
      // Step 2: schedule it
      await api.post(`/api/retests/${created.id}`, {
        action: "schedule",
        retestSessionId: retestForm.retestSessionId || undefined,
        retestTrainerId: retestForm.retestTrainerId || undefined,
        retestDate: retestForm.retestDate || undefined,
        retestShift: retestForm.retestShift || undefined,
        retestLocation: retestForm.retestLocation || undefined,
        retestVenue: retestForm.retestVenue || undefined,
        reason: retestForm.reason || undefined,
        moveTrainee: retestForm.moveTrainee,
      });
      toast({
        title: t("misc.success"),
        description: t("session.retestScheduled") || `Retest ${created.refNumber} scheduled`,
      });
      setRetestTarget(null);
      setRetestForm({
        retestSessionId: "", retestTrainerId: "", retestDate: "",
        retestShift: "MORNING", retestLocation: "", retestVenue: "",
        reason: "", moveTrainee: false,
      });
      await load();
    });

  const doActivateQr = (from?: string, to?: string) =>
    run("qr", async () => {
      if (!session?.qrCodeToken) {
        const qrRes = await api.post<{ qrCodeToken: string }>(`/sessions/${sessionId}/qr`, {});
        setSession((prev) => prev ? { ...prev, qrCodeToken: qrRes.qrCodeToken } : prev);
      }
      await api.post(`/sessions/${sessionId}/qr-activate`, {
        qrActiveFrom: from ? new Date(from).toISOString() : undefined,
        qrActiveTo: to ? new Date(to).toISOString() : undefined,
      });
      toast({ title: t("misc.success"), description: t("session.qrActivated") });
      await load();
    });

  const activateQr = () => doActivateQr(qrFrom || undefined, qrTo || undefined);

  // Activate immediately: window = now → session end (or now+1h fallback).
  const activateQrNow = () => {
    const from = toLocalInput(new Date());
    let to = qrTo || "";
    if (to <= from) {
      const fallback = new Date();
      fallback.setTime(fallback.getTime() + 60 * 60 * 1000);
      to = toLocalInput(fallback);
    }
    setQrFrom(from);
    setQrTo(to);
    void doActivateQr(from, to);
  };

  const regenerateQr = (tokenType: string) =>
    run(`qr-${tokenType}`, async () => {
      const res = await api.post<{ qrCodeToken?: string; preTestQrToken?: string; finalTestQrToken?: string; evaluationQrToken?: string }>(
        `/sessions/${sessionId}/qr`, { tokenType },
      );
      setSession((prev) => {
        if (!prev) return prev;
        const patch: Record<string, string | null> = {};
        if (res.qrCodeToken) patch.qrCodeToken = res.qrCodeToken;
        if (res.preTestQrToken) patch.preTestQrToken = res.preTestQrToken;
        if (res.finalTestQrToken) patch.finalTestQrToken = res.finalTestQrToken;
        if (res.evaluationQrToken) patch.evaluationQrToken = res.evaluationQrToken;
        return { ...prev, ...patch };
      });
      toast({ title: t("misc.success"), description: `QR token regenerated` });
      await load();
    });

  const markManualAttendance = () =>
    run("manual", async () => {
      if (!manualTarget) return;
      await api.post(`/sessions/${sessionId}/manual-attendance`, { traineeId: manualTarget.traineeId });
      toast({
        title: t("misc.success"),
        description: t("session.manualAttendanceSuccess") || "Trainee marked as present",
      });
      setManualTarget(null);
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

  // Delivery-only lifecycle events the coordinator cannot trigger. Mirrors the
  // role guard in src/app/api/sessions/[id]/lifecycle/route.ts.
  const coordinatorBlockedEvents =
    user?.role === "COORDINATOR"
      ? new Set(Object.keys(EVENT_ICONS) as LifecycleEvent[])
      : new Set<LifecycleEvent>();

  const enrollmentColumns: Column<Enrollment>[] = [
    {
      key: "trainee",
      header: t("evaluation.trainee"),
      cell: (r) => (
        <div>
          <div className="text-sm font-medium">{r.trainee?.fullName ?? "—"}</div>
          <div className="text-[10px] font-mono text-muted-foreground">{r.trainee?.refNumber}</div>
          {r.trainee?.nationalId && (
            <div className="text-[10px] font-mono text-muted-foreground flex items-center gap-1">
              <Fingerprint className="h-3 w-3 shrink-0" />
              {r.trainee.nationalId}
            </div>
          )}
          {r.trainee?.nationality && (
            <div className="text-[10px] text-muted-foreground">
              {t("trainees.nationality")}: {r.trainee.nationality}
            </div>
          )}
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
    { key: "mobile", header: t("trainees.mobile") || "Mobile", cell: (r) => (
      <div className="text-xs text-muted-foreground">{r.trainee?.mobile ?? "—"}</div>
    ) },
    { key: "email", header: t("trainees.email") || "Email", cell: (r) => (
      <div className="text-xs text-muted-foreground">{r.trainee?.email ?? "—"}</div>
    ) },
    { key: "documents", header: t("trainees.documents") || "Documents", cell: (r) => {
      const docs = r.trainee?.documents;
      if (!docs || docs.length === 0) return <div className="text-xs text-muted-foreground">—</div>;
      return (
        <div className="flex gap-1 flex-wrap">
          {docs.map((doc, i) => (
            <a
              key={i}
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-primary underline hover:no-underline"
              title={doc.filename}
            >
              {doc.type}
            </a>
          ))}
        </div>
      );
    } },
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
            {user?.role === "TRAINER" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-emerald-600"
                onClick={() => setManualTarget(row)}
                title={t("session.manualAttendance") || "Manual Check-in"}
                disabled={row.attendanceStatus === "PRESENT" || busy === "manual"}
              >
                {busy === "manual" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserCheck className="h-3.5 w-3.5" />}
              </Button>
            )}
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
              className="h-8 w-8"
              onClick={() => void giveTrainerOpportunity(row)}
              title={t("session.trainerOpportunity") || "Trainer Immediate Opportunity"}
              disabled={row.certificateStatus === "ISSUED" || row.finalTestStatus !== "FAILED" || busy === "opportunity"}
            >
              {busy === "opportunity" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => {
                setRetestTarget(row);
                setRetestForm({
                  retestSessionId: "", retestTrainerId: "", retestDate: "",
                  retestShift: "MORNING", retestLocation: "", retestVenue: "",
                  reason: "", moveTrainee: false,
                });
              }}
              title={t("session.retest") || "Schedule Official Retest"}
              disabled={row.certificateStatus === "ISSUED" || row.finalTestStatus !== "FAILED"}
            >
              <ClipboardCheck className="h-3.5 w-3.5" />
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
            {user?.role === "TRAINER" && (
              <TabsTrigger value="contact-directory">{t("session.contactDirectory")}</TabsTrigger>
            )}
            <TabsTrigger value="lifecycle">{t("session.lifecycle")}</TabsTrigger>
            <TabsTrigger value="trainer">{t("nav.trainers")}</TabsTrigger>
            {canViewQr && <TabsTrigger value="qr">{t("nav.qrCode")}</TabsTrigger>}
            {canViewExams && <TabsTrigger value="exams">{t("session.examsTab")}</TabsTrigger>}
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

          {user?.role === "TRAINER" && (
            <TabsContent value="contact-directory" className="mt-4">
              {session && <SessionContactDirectory sessionId={session.id} />}
            </TabsContent>
          )}

          <TabsContent value="lifecycle" className="mt-4">
            <Card className="p-6 space-y-5">
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">{t("session.lifecycleStatus")}</span>
                <StatusBadge status={lifecycleStatus} />
              </div>

              <div className="flex flex-wrap gap-2">
                {(Object.keys(EVENT_ICONS) as LifecycleEvent[])
                  .filter((ev) => !coordinatorBlockedEvents.has(ev))
                  .map((ev) => {
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
                    {trainers.map((x) => <SelectItem key={x.id} value={x.id}>{trainerName(x, locale)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Button disabled={!canEdit || !selectedTrainer || busy === "trainer"} onClick={() => void assignTrainer()}>
                {busy === "trainer" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <GraduationCap className="h-4 w-4 me-1.5" />}
                {t("session.assignTrainer")}
              </Button>
            </Card>
          </TabsContent>

          {canViewQr && (
            <TabsContent value="qr" className="mt-4 space-y-4">
              {/* ── Attendance QR ── */}
              <Card className="p-6 space-y-4 max-w-xl">
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold">{t("qr.title") || "Attendance QR"}</p>
                  <p className="text-xs text-muted-foreground">Trainees scan this to check in to the session</p>
                </div>
                <div className="text-center">
                {session?.qrCodeToken ? (
                  <>
                    <QrImage
                      value={buildCheckInUrl(typeof window === "undefined" ? "" : window.location.origin, session.qrCodeToken)}
                      size={168}
                      className="mx-auto border"
                      label={t("qr.title")}
                    />
                    <Input
                      readOnly
                      value={buildCheckInUrl(typeof window === "undefined" ? "" : window.location.origin, session.qrCodeToken)}
                      onFocus={(e) => e.target.select()}
                      className="font-mono text-xs mt-3"
                    />
                  </>
                ) : (
                  <div className="flex h-36 w-36 mx-auto items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/20">
                    <QrCode className="h-10 w-10 text-muted-foreground/40" />
                  </div>
                )}
                </div>

                <div className="grid grid-cols-2 gap-3 text-start">
                  <Field label={t("qr.validFrom") || "Active from"}>
                    <Input
                      type="datetime-local"
                      value={qrFrom}
                      onChange={(e) => setQrFrom(e.target.value)}
                      disabled={!canEdit || busy === "qr"}
                    />
                  </Field>
                  <Field label={t("qr.validTo") || "Active until"}>
                    <Input
                      type="datetime-local"
                      value={qrTo}
                      onChange={(e) => setQrTo(e.target.value)}
                      disabled={!canEdit || busy === "qr"}
                    />
                  </Field>
                </div>

                <p className="text-xs text-muted-foreground text-center">
                  {t("qr.anytimeHint") || "The QR is only scannable within this window."}
                </p>

                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button disabled={!canEdit || busy === "qr"} onClick={() => void activateQrNow()}>
                    {busy === "qr" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <Play className="h-4 w-4 me-1.5" />}
                    {t("qr.activateNow")}
                  </Button>
                  <Button variant="outline" disabled={!canEdit || busy === "qr"} onClick={() => void activateQr()}>
                    <QrCode className="h-4 w-4 me-1.5" />
                    {t("session.activateQr")}
                  </Button>
                </div>
              </Card>

              {/* ── Pre-Test QR ── */}
              <Card className="p-6 space-y-4 max-w-xl">
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold">{t("preTest.title") || "Pre-Test QR"}</p>
                  <p className="text-xs text-muted-foreground">Trainees scan this to access the pre-test exam</p>
                </div>
                <div className="text-center">
                {session?.preTestQrToken ? (
                  <>
                    <QrImage
                      value={buildPreTestUrl(typeof window === "undefined" ? "" : window.location.origin, session.preTestQrToken)}
                      size={168}
                      className="mx-auto border"
                      label={t("preTest.title") || "Pre-Test"}
                    />
                    <Input
                      readOnly
                      value={buildPreTestUrl(typeof window === "undefined" ? "" : window.location.origin, session.preTestQrToken)}
                      onFocus={(e) => e.target.select()}
                      className="font-mono text-xs mt-3"
                    />
                  </>
                ) : (
                  <div className="flex h-36 w-36 mx-auto items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/20">
                    <QrCode className="h-10 w-10 text-muted-foreground/40" />
                  </div>
                )}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="outline" disabled={!canEdit || busy === "qr-preTest"} onClick={() => void regenerateQr("preTest")}>
                    {busy === "qr-preTest" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 me-1.5" />}
                    {t("qr.regenerate") || "Regenerate"}
                  </Button>
                </div>
              </Card>

              {/* ── Final-Test QR ── */}
              <Card className="p-6 space-y-4 max-w-xl">
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold">{t("finalTest.title") || "Final-Test QR"}</p>
                  <p className="text-xs text-muted-foreground">Trainees scan this to access the final test exam</p>
                </div>
                <div className="text-center">
                {session?.finalTestQrToken ? (
                  <>
                    <QrImage
                      value={buildFinalTestUrl(typeof window === "undefined" ? "" : window.location.origin, session.finalTestQrToken)}
                      size={168}
                      className="mx-auto border"
                      label={t("finalTest.title") || "Final-Test"}
                    />
                    <Input
                      readOnly
                      value={buildFinalTestUrl(typeof window === "undefined" ? "" : window.location.origin, session.finalTestQrToken)}
                      onFocus={(e) => e.target.select()}
                      className="font-mono text-xs mt-3"
                    />
                  </>
                ) : (
                  <div className="flex h-36 w-36 mx-auto items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/20">
                    <QrCode className="h-10 w-10 text-muted-foreground/40" />
                  </div>
                )}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="outline" disabled={!canEdit || busy === "qr-finalTest"} onClick={() => void regenerateQr("finalTest")}>
                    {busy === "qr-finalTest" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 me-1.5" />}
                    {t("qr.regenerate") || "Regenerate"}
                  </Button>
                </div>
              </Card>

              {/* ── Evaluation QR ── */}
              <Card className="p-6 space-y-4 max-w-xl">
                <div className="text-center space-y-1">
                  <p className="text-sm font-semibold">{t("nav.evaluation") || "Evaluation QR"}</p>
                  <p className="text-xs text-muted-foreground">Trainees scan this to submit a course evaluation</p>
                </div>
                <div className="text-center">
                {session?.evaluationQrToken ? (
                  <>
                    <QrImage
                      value={buildEvaluationUrl(typeof window === "undefined" ? "" : window.location.origin, session.evaluationQrToken)}
                      size={168}
                      className="mx-auto border"
                      label={t("nav.evaluation") || "Evaluation"}
                    />
                    <Input
                      readOnly
                      value={buildEvaluationUrl(typeof window === "undefined" ? "" : window.location.origin, session.evaluationQrToken)}
                      onFocus={(e) => e.target.select()}
                      className="font-mono text-xs mt-3"
                    />
                  </>
                ) : (
                  <div className="flex h-36 w-36 mx-auto items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/20">
                    <QrCode className="h-10 w-10 text-muted-foreground/40" />
                  </div>
                )}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button variant="outline" disabled={!canEdit || busy === "qr-evaluation"} onClick={() => void regenerateQr("evaluation")}>
                    {busy === "qr-evaluation" ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <RefreshCw className="h-4 w-4 me-1.5" />}
                    {t("qr.regenerate") || "Regenerate"}
                  </Button>
                </div>
              </Card>
            </TabsContent>
          )}

          {canViewExams && (
            <TabsContent value="exams" className="mt-4">
              {session ? <SessionExamSets sessionId={session.id} canManage={canManageExams} /> : null}
            </TabsContent>
          )}

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

      <EnrollTraineeDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        sessionId={sessionId}
        onEnrolled={() => void load()}
        enrolledTraineeIds={enrollments.map((e) => e.traineeId)}
      />

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        description={removeTarget?.trainee?.fullName}
        destructive
        loading={busy === "remove"}
        onConfirm={() => void removeEnrollment()}
      />

      <ConfirmDialog
        open={manualTarget !== null}
        onOpenChange={(o) => !o && setManualTarget(null)}
        title={t("session.manualAttendance") || "Manual Check-in"}
        description={`${t("session.manualAttendanceConfirm") || "Mark as present (manual check-in)?"} — ${manualTarget?.trainee?.fullName ?? ""}`}
        confirmLabel={t("session.manualAttendance") || "Manual Check-in"}
        loading={busy === "manual"}
        onConfirm={() => void markManualAttendance()}
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
          <CompanyTraineePicker
            key={replaceTarget?.id ?? "none"}
            value={replaceTraineeId}
            onChange={setReplaceTraineeId}
            excludeTraineeId={replaceTarget?.traineeId}
          />
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
            <div>{t("session.moveHint") || "Trainees can only be moved to sessions of the same course. Capacity will be checked."}</div>
            {session?.courseTitle && (
              <div className="mt-1 flex items-center gap-1.5 font-medium">
                <GraduationCap className="h-3.5 w-3.5" />
                {t("sessions.course") || "Course"}: {session.courseTitle}
              </div>
            )}
          </div>

          {/* Companies of the trainee(s) being moved */}
          {(() => {
            const moving = moveTarget
              ? [moveTarget]
              : enrollments.filter((e) => selectedEnrollmentIds.has(e.id));
            return (
              <div className="rounded-md border bg-muted/30 p-3 space-y-2">
                <div className="text-[11px] font-medium text-muted-foreground">
                  {t("trainees.company") || "Company"}
                </div>
                {moving.map((e) => (
                  <div key={e.id} className="rounded-md border bg-background/60 p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-medium truncate">{e.trainee?.fullName ?? "—"}</span>
                      <span className="flex items-center gap-1 text-muted-foreground shrink-0">
                        <Building2 className="h-3 w-3" />
                        {e.company?.name ?? "—"}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                      {e.trainee?.nationalId && (
                        <span className="truncate">
                          {t("trainees.nationalId")}: <span className="font-mono">{e.trainee.nationalId}</span>
                        </span>
                      )}
                      {e.trainee?.nationality && (
                        <span className="truncate">{t("trainees.nationality")}: {e.trainee.nationality}</span>
                      )}
                      {e.trainee?.jobTitle && (
                        <span className="truncate">{t("trainees.jobTitle")}: {e.trainee.jobTitle}</span>
                      )}
                      {e.trainee?.mobile && (
                        <span className="truncate" dir="ltr">{t("trainees.mobile")}: {e.trainee.mobile}</span>
                      )}
                      {e.trainee?.email && (
                        <span className="truncate" dir="ltr">{t("trainees.email")}: {e.trainee.email}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          <Field label={t("session.targetSession") || "Target Session"} required>
            <Select value={targetSessionId} onValueChange={setTargetSessionId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {(() => {
                  const sameCourse = (s: { courseId: string }) =>
                    !session?.courseId || s.courseId === session.courseId;
                  const laterOrSameDate = (s: { startDate: string }) =>
                    !session?.startDate || new Date(s.startDate) >= new Date(session.startDate);
                  const opts = availableSessions.filter((s) => sameCourse(s) && laterOrSameDate(s));
                  return (
                    <>
                      {opts.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.refNumber} — {s.title} · {s.courseTitle ?? ""} · {new Date(s.startDate).toLocaleDateString()}
                        </SelectItem>
                      ))}
                      {opts.length === 0 && (
                        <div className="px-2 py-4 text-xs text-muted-foreground">
                          {t("session.moveNoFutureSessions") || "No later sessions available for this course."}
                        </div>
                      )}
                    </>
                  );
                })()}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </FormDialog>

      {/* ── Retest Dialog ── */}
      <FormDialog
        open={retestTarget !== null}
        onOpenChange={(o) => { if (!o) { setRetestTarget(null); setRetestForm({ retestSessionId: "", retestTrainerId: "", retestDate: "", retestShift: "MORNING", retestLocation: "", retestVenue: "", reason: "", moveTrainee: false }); } }}
        title={t("session.retest") || "Schedule Retest"}
        description={`${t("session.retestFor") || "Retest for"}: ${retestTarget?.trainee?.fullName ?? "—"}`}
        icon={ClipboardCheck}
        size="lg"
        onSubmit={scheduleRetest}
        isSubmitting={busy === "retest"}
      >
        <div className="space-y-4">
          <div className="rounded-md border bg-amber-50 dark:bg-amber-950/20 p-3 text-xs text-amber-700 dark:text-amber-400">
            {t("session.retestHint") || "This trainee failed the final assessment. Schedule a retest — you can keep them in this session, move them to another session, change the trainer, date, time, or room."}
          </div>
          <FormGrid>
            <Field label={t("session.retestSession") || "Retest Session (leave empty = same session)"}>
              <Select
                value={retestForm.retestSessionId}
                onValueChange={(v) => setRetestForm((f) => ({ ...f, retestSessionId: v }))}
              >
                <SelectTrigger><SelectValue placeholder={t("session.sameSession") || "Same session"} /></SelectTrigger>
                <SelectContent>
                  {availableSessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.refNumber} — {s.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("sessions.trainer") || "Trainer"}>
              <Select
                value={retestForm.retestTrainerId}
                onValueChange={(v) => setRetestForm((f) => ({ ...f, retestTrainerId: v }))}
                disabled={user?.role === "TRAINER"}
              >
                <SelectTrigger><SelectValue placeholder={t("session.sameTrainer") || "Same trainer"} /></SelectTrigger>
                <SelectContent>
                  {trainers.map((tr) => <SelectItem key={tr.id} value={tr.id}>{trainerName(tr, locale)}</SelectItem>)}
                </SelectContent>
              </Select>
              {user?.role === "TRAINER" && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  {t("session.trainerChangeCoordinatorOnly") || "Only coordinators can change the trainer."}
                </p>
              )}
            </Field>
            <Field label={t("session.retestDate") || "Retest Date"}>
              <Input
                type="datetime-local"
                value={retestForm.retestDate}
                onChange={(e) => setRetestForm((f) => ({ ...f, retestDate: e.target.value }))}
              />
            </Field>
            <Field label={t("sessions.shift") || "Shift"}>
              <Select
                value={retestForm.retestShift}
                onValueChange={(v) => setRetestForm((f) => ({ ...f, retestShift: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MORNING">{t("sessions.shift.MORNING") || "Morning"}</SelectItem>
                  <SelectItem value="EVENING">{t("sessions.shift.EVENING") || "Evening"}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("sessions.location") || "Location"}>
              <Input
                value={retestForm.retestLocation}
                onChange={(e) => setRetestForm((f) => ({ ...f, retestLocation: e.target.value }))}
                placeholder={t("sessions.location") || "Location"}
              />
            </Field>
            <Field label={t("sessions.venue") || "Venue / Room"}>
              <Input
                value={retestForm.retestVenue}
                onChange={(e) => setRetestForm((f) => ({ ...f, retestVenue: e.target.value }))}
                placeholder={t("sessions.venue") || "Hall A"}
              />
            </Field>
          </FormGrid>
          <Field label={t("session.reason") || "Reason (optional)"}>
            <Input
              value={retestForm.reason}
              onChange={(e) => setRetestForm((f) => ({ ...f, reason: e.target.value }))}
              placeholder={t("session.retestReasonPlaceholder") || "e.g. Trainee requested retest"}
            />
          </Field>
          {retestForm.retestSessionId && (
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={retestForm.moveTrainee}
                onChange={(e) => setRetestForm((f) => ({ ...f, moveTrainee: e.target.checked }))}
                className="rounded"
              />
              {t("session.moveTraineeToRetestSession") || "Move trainee to the retest session"}
            </label>
          )}
        </div>
      </FormDialog>
    </div>
  );
}
