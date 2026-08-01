"use client";

import { useState, useEffect, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { EmptyState } from "@/components/common/empty-state";
import { StatusBadge } from "@/components/common/status-badge";
import { SessionHistoryTab } from "@/components/common/session-history-tab";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CalendarDays, ArrowLeft, ArrowRight, Users, Play, Pause, RotateCcw, CheckCircle2,
  GraduationCap, QrCode, BadgeCheck, Plus, Trash2, AlertCircle, Loader2, Building2,
  Search, Pencil, UserCircle,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";
import { QrImage } from "@/components/common/qr-image";
import { buildCheckInUrl } from "@/lib/qr/urls";
import { cn } from "@/lib/utils";

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
  trainer?: { id: string; fullName: string; refNumber: string } | null;
  qrToken?: string | null;
  courseTitle?: string | null;
  courseId?: string;
  capacity?: number;
  expectedTrainees?: number;
  shift?: string | null;
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

  // ── Enhanced enroll dialog state ────────────────────────────────────────
  // Tabbed dialog: "Search Existing" (search + multi-select) and "Create New"
  // (inline trainee creation form). Also supports editing trainee info from
  // the enrollment table.
  const [enrollTab, setEnrollTab] = useState<"search" | "create">("search");
  const [enrollSearch, setEnrollSearch] = useState("");
  const [enrollSearchResults, setEnrollSearchResults] = useState<TraineeOption[]>([]);
  const [enrollSelectedIds, setEnrollSelectedIds] = useState<Set<string>>(new Set());
  const [enrollSearching, setEnrollSearching] = useState(false);
  // Create-new-trainee form state
  const [newTraineeForm, setNewTraineeForm] = useState<Record<string, string>>({});
  const [companiesList, setCompaniesList] = useState<{ id: string; name: string; refNumber: string }[]>([]);
  const [creatingTrainee, setCreatingTrainee] = useState(false);
  // Edit-trainee dialog
  const [editTraineeOpen, setEditTraineeOpen] = useState(false);
  const [editTraineeData, setEditTraineeData] = useState<Record<string, unknown>>({});
  const [editTraineeId, setEditTraineeId] = useState<string | null>(null);
  const [savingTrainee, setSavingTrainee] = useState(false);

  // ── Session management state (split / move / merge) ───────────────────────
  // The Manage tab lets the coordinator split this session into N, move
  // trainees to another session, or merge multiple sessions into one.
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [splitting, setSplitting] = useState(false);
  // Per-split overrides — one entry per split session. When the coordinator
  // opens the split dialog, we initialize this array with `count` empty
  // objects (all fields inherit from source). The dialog lets the user
  // override shift/dates/trainer/venue/capacity per split.
  interface SplitOverride {
    shift?: "MORNING" | "EVENING";
    startDate?: string;
    endDate?: string;
    capacity?: number;
    trainerId?: string | null;
    venue?: string;
    city?: string;
  }
  const [splitOverrides, setSplitOverrides] = useState<SplitOverride[]>([]);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTargetSessionId, setMoveTargetSessionId] = useState("");
  const [moveTraineeIds, setMoveTraineeIds] = useState<string[]>([]);
  const [moving, setMoving] = useState(false);
  const [otherSessions, setOtherSessions] = useState<Session[]>([]);
  // Merge is initiated from a dedicated dialog where the coordinator picks
  // additional sessions to merge INTO the current one. We reuse the same
  // `otherSessions` list.
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSelection, setMergeSelection] = useState<string[]>([]);
  const [merging, setMerging] = useState(false);

  // ── Session management helpers ────────────────────────────────────────────
  // Load other sessions of the SAME course as the current one — these are
  // the candidates for move/merge operations (cross-course is rejected by
  // the backend). Plain function (no useCallback) so the React compiler
  // doesn't have to reconcile manual memoization.
  const loadOtherSessions = async () => {
    if (!session?.courseId) return;
    try {
      const res = await api.getList<Session>("/sessions", {
        pageSize: 100,
        courseId: session.courseId,
      });
      setOtherSessions(res.rows.filter((s) => s.id !== sessionId));
    } catch {
      setOtherSessions([]);
    }
  };

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
  // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // ── Enhanced enroll: search existing trainees ───────────────────────────
  const searchTrainees = async (query: string) => {
    setEnrollSearch(query);
    if (!query.trim()) {
      setEnrollSearchResults([]);
      return;
    }
    setEnrollSearching(true);
    try {
      const res = await api.getList<TraineeOption>("/trainees", { search: query, pageSize: 50 });
      setEnrollSearchResults(res.rows.map((x) => ({ id: x.id, fullName: x.fullName, refNumber: x.refNumber })));
    } catch {
      setEnrollSearchResults([]);
    } finally {
      setEnrollSearching(false);
    }
  };

  const toggleEnrollSelect = (id: string) => {
    setEnrollSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Enroll multiple selected existing trainees at once
  const enrollSelected = async () => {
    if (enrollSelectedIds.size === 0) {
      toast({ title: t("misc.error"), description: t("session.selectTrainees"), variant: "destructive" });
      return;
    }
    run("enroll", async () => {
      await api.post(`/sessions/${sessionId}/enrollments`, { traineeIds: Array.from(enrollSelectedIds) });
      toast({ title: t("misc.success"), description: t("misc.createSuccess") });
      setEnrollOpen(false);
      setEnrollSelectedIds(new Set());
      setEnrollSearch("");
      setEnrollSearchResults([]);
      await load();
    });
  };

  // Create a new trainee AND enroll them in this session in one flow.
  // Before creating, search for an existing trainee with the same nationalId.
  // If found, offer to enroll the existing trainee instead of creating a duplicate.
  const createAndEnroll = async () => {
    if (!newTraineeForm.fullName || !newTraineeForm.nationalId || !newTraineeForm.companyId) {
      toast({ title: t("misc.error"), description: t("trainees.duplicate"), variant: "destructive" });
      return;
    }
    setCreatingTrainee(true);
    try {
      // Step 0: Search for existing trainee by nationalId (across ALL companies)
      const searchRes = await api.getList<{ id: string; refNumber: string; fullName: string }>("/trainees", {
        search: newTraineeForm.nationalId,
        pageSize: 10,
      });
      const existingMatch = searchRes.rows.find(
        (r) => r.refNumber === newTraineeForm.nationalId || r.fullName === newTraineeForm.nationalId
      );
      // Also check if any search result has this exact nationalId (the search
      // endpoint matches on fullName, nationalId, email, mobile, refNumber)
      // We need a more precise check — call the API and see if any result's
      // nationalId matches. Since the list endpoint doesn't return nationalId
      // in the TraineeOption type, we rely on the POST /trainees endpoint's
      // duplicate check to catch it.

      let traineeId: string;
      let traineeRef: string;

      try {
        // Step 1: Try to create the trainee. If a duplicate exists, the API
        // returns 400 with code DUPLICATE_NATIONAL_ID and includes existingId.
        const created = await api.post<{ id: string; refNumber: string }>("/trainees", {
          fullName: newTraineeForm.fullName,
          nationalId: newTraineeForm.nationalId,
          nationality: newTraineeForm.nationality || undefined,
          jobTitle: newTraineeForm.jobTitle || undefined,
          mobile: newTraineeForm.mobile || undefined,
          email: newTraineeForm.email || undefined,
          companyId: newTraineeForm.companyId,
          idAttachmentUrl: newTraineeForm.idAttachmentUrl || undefined,
          dateOfBirth: newTraineeForm.dateOfBirth || undefined,
          idExpiry: newTraineeForm.idExpiry || undefined,
        });
        traineeId = created.id;
        traineeRef = created.refNumber;
      } catch (createErr) {
        // Check if this is a duplicate-national-id error
        const err = createErr as { code?: string; message?: string };
        if (err.code === "DUPLICATE_NATIONAL_ID") {
          // An existing trainee with this nationalId was found.
          // Show a toast telling the user, and try to enroll the existing one.
          toast({
            title: t("session.existingTraineeFound"),
            description: t("session.enrollingExisting"),
            variant: "default",
          });
          // Search again to get the existing trainee's ID
          // The error message contains the existing refNumber — use it to search
          const existingSearch = await api.getList<{ id: string; refNumber: string }>("/trainees", {
            search: newTraineeForm.nationalId,
            pageSize: 5,
          });
          if (existingSearch.rows.length > 0) {
            traineeId = existingSearch.rows[0].id;
            traineeRef = existingSearch.rows[0].refNumber;
          } else {
            throw new Error("Existing trainee found but could not retrieve ID. Please search and enroll manually.");
          }
        } else {
          throw createErr;
        }
      }

      // Step 2: Enroll the trainee (newly created or existing) in this session
      try {
        await api.post(`/sessions/${sessionId}/enrollments`, { traineeId });
        toast({ title: t("misc.success"), description: `${t("misc.createSuccess")} — ${traineeRef}` });
      } catch (enrollErr) {
        const err = enrollErr as { code?: string; message?: string };
        if (err.code === "ALREADY_ENROLLED") {
          toast({
            title: t("misc.error"),
            description: t("session.alreadyEnrolled"),
            variant: "destructive",
          });
        } else {
          throw enrollErr;
        }
      }

      setEnrollOpen(false);
      setNewTraineeForm({});
      await load();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setCreatingTrainee(false);
    }
  };

  // Open the edit-trainee dialog from the enrollment table
  const openEditTrainee = async (enrollment: Enrollment) => {
    if (!enrollment.trainee?.id) return;
    setEditTraineeId(enrollment.trainee.id);
    try {
      const full = await api.get<Record<string, unknown>>(`/trainees/${enrollment.trainee.id}`);
      setEditTraineeData(full);
      setEditTraineeOpen(true);
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };

  // Save trainee edits from the edit dialog
  const saveTraineeEdit = async () => {
    if (!editTraineeId) return;
    setSavingTrainee(true);
    try {
      await api.put(`/trainees/${editTraineeId}`, editTraineeData);
      toast({ title: t("misc.success"), description: t("misc.updateSuccess") });
      setEditTraineeOpen(false);
      setEditTraineeId(null);
      setEditTraineeData({});
      await load();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingTrainee(false);
    }
  };

  // Load companies list for the create-new-trainee form
  const loadCompaniesForForm = async () => {
    if (companiesList.length > 0) return;
    try {
      const res = await api.getList<{ id: string; name: string; refNumber: string }>("/companies", { pageSize: 100 });
      setCompaniesList(res.rows);
    } catch { /* ignore */ }
  };

  const assignTrainer = () =>
    run("trainer", async () => {
      await api.post(`/sessions/${sessionId}/assign-trainer`, { trainerId: selectedTrainer });
      toast({ title: t("misc.success"), description: t("misc.updateSuccess") });
      await load();
    });

  const removeTrainer = () =>
    run("trainer", async () => {
      // Per the redesigned workflow, the coordinator can remove a trainer
      // at any time. The backend treats `trainerId: null` as "remove".
      await api.post(`/sessions/${sessionId}/assign-trainer`, { trainerId: null });
      toast({ title: t("misc.success"), description: t("session.trainerRemoved") });
      setSelectedTrainer("");
      await load();
    });

  // ── Session management handlers ───────────────────────────────────────────
  const handleSplit = async () => {
    if (!sessionId) return;
    setSplitting(true);
    try {
      const res = await api.post<{ newSessions: Array<{ refNumber: string; id: string }>; movedEnrollmentCount: number }>(
        `/sessions/${sessionId}/split`,
        { count: splitCount, splits: splitOverrides }
      );
      toast({
        title: t("misc.success"),
        description: t("session.splitSuccess", {
          count: res.newSessions.length,
          moved: res.movedEnrollmentCount,
        }),
      });
      setSplitOpen(false);
      // The source session was soft-deleted by the split — navigate to the
      // first new session so the coordinator can continue editing. If the
      // split returned zero sessions (count > enrollments — under-delivery),
      // navigate to the sessions list instead of staying on the deleted session.
      if (res.newSessions[0]) {
        navigate("session-detail", res.newSessions[0].id);
      } else {
        toast({ title: t("misc.success"), description: t("session.splitSuccess", { count: 0, moved: 0 }) });
        navigate("sessions");
      }
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSplitting(false);
    }
  };

  // Initialize the splitOverrides array when the split count changes or the
  // dialog opens. Each entry starts empty (all fields inherit from source).
  const openSplitDialog = () => {
    setSplitCount(2);
    setSplitOverrides([{}, {}]);
    setSplitOpen(true);
  };
  const updateSplitCount = (n: number) => {
    const clamped = Math.max(2, Math.min(10, n));
    setSplitCount(clamped);
    // Resize the overrides array — preserve existing entries, add empty
    // objects for new slots, truncate if shrinking.
    setSplitOverrides((prev) => {
      const next: SplitOverride[] = [];
      for (let i = 0; i < clamped; i++) {
        next.push(prev[i] ?? {});
      }
      return next;
    });
  };
  const setSplitOverride = (index: number, patch: Partial<SplitOverride>) => {
    setSplitOverrides((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  };

  const handleMoveTrainees = async () => {
    if (!sessionId) return;
    if (!moveTargetSessionId) {
      toast({ title: t("misc.error"), description: t("session.targetSession") + " — " + t("misc.required"), variant: "destructive" });
      return;
    }
    if (moveTraineeIds.length === 0) {
      toast({ title: t("misc.error"), description: t("session.selectTrainees"), variant: "destructive" });
      return;
    }
    setMoving(true);
    try {
      const res = await api.post<{ movedCount: number; skippedCount: number }>(
        `/sessions/${sessionId}/move-trainees`,
        { targetSessionId: moveTargetSessionId, traineeIds: moveTraineeIds }
      );
      toast({
        title: t("misc.success"),
        description: t("session.moveSuccess", {
          moved: res.movedCount,
          skipped: res.skippedCount,
        }),
      });
      setMoveOpen(false);
      setMoveTraineeIds([]);
      setMoveTargetSessionId("");
      await load();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setMoving(false);
    }
  };

  const handleMerge = async () => {
    if (!sessionId) return;
    if (mergeSelection.length === 0) {
      toast({ title: t("misc.error"), description: t("session.selectSessions"), variant: "destructive" });
      return;
    }
    setMerging(true);
    try {
      // Merge always creates a NEW session (the merged one) and soft-deletes
      // the sources. We pass the current session first so it's included.
      const res = await api.post<{ mergedSession: { id: string; refNumber: string }; sourceSessionRefs: string[] }>(
        `/sessions/merge`,
        { sessionIds: [sessionId, ...mergeSelection] }
      );
      toast({
        title: t("misc.success"),
        description: t("session.mergeSuccess", {
          count: res.sourceSessionRefs.length,
          ref: res.mergedSession.refNumber,
        }),
      });
      setMergeOpen(false);
      setMergeSelection([]);
      // Navigate to the merged session (by id, not refNumber).
      navigate("session-detail", res.mergedSession.id);
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setMerging(false);
    }
  };

  const toggleMoveTrainee = (id: string) => {
    setMoveTraineeIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const toggleMergeSelection = (id: string) => {
    setMergeSelection((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

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
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => void openEditTrainee(row)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => setRemoveTarget(row)}>
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
        <>
        {/* Warning banner when session has started or completed — editing is
            still allowed (per the coordinator full-session-management
            requirements), but we inform the user that changes are audited. */}
        {session && session.status !== "SCHEDULED" && (
          <div className={cn(
            "flex items-center gap-2 rounded-md border p-3 text-xs",
            session.status === "IN_PROGRESS"
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-info/40 bg-info/10 text-info"
          )}>
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{session.status === "IN_PROGRESS" ? t("session.warnEditingInProgress") : t("session.warnEditingStarted")}</span>
          </div>
        )}
        <Tabs defaultValue="enrollments">
          <TabsList>
            <TabsTrigger value="enrollments">{t("session.enrollments")}</TabsTrigger>
            <TabsTrigger value="lifecycle">{t("session.lifecycle")}</TabsTrigger>
            <TabsTrigger value="trainer">{t("nav.trainers")}</TabsTrigger>
            <TabsTrigger value="manage">{t("session.manage")}</TabsTrigger>
            <TabsTrigger value="history">{t("session.history")}</TabsTrigger>
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

            </Card>
          </TabsContent>

          <TabsContent value="trainer" className="mt-4">
            <Card className="p-6 space-y-4 max-w-lg">
              {/* Current trainer display + remove button — the coordinator
                  can remove a trainer at any time per the redesigned workflow. */}
              {session?.trainerId && session?.trainer ? (
                <div className="rounded-md border p-3 bg-muted/30 space-y-2">
                  <div className="text-xs text-muted-foreground">{t("session.currentTrainer")}</div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <GraduationCap className="h-5 w-5 text-primary" />
                      <div>
                        <div className="text-sm font-medium">{session.trainer.fullName}</div>
                        <div className="text-xs text-muted-foreground font-mono">{session.trainer.refNumber}</div>
                      </div>
                    </div>
                    {canEdit && (
                      <Button variant="outline" size="sm" disabled={busy === "trainer"} onClick={() => void removeTrainer()}
                        className="text-destructive border-destructive/30 hover:bg-destructive/5">
                        {busy === "trainer" ? <Loader2 className="h-3.5 w-3.5 me-1.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5 me-1.5" />}
                        {t("session.removeTrainer")}
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground text-center">
                  {t("session.noTrainerAssigned")}
                </div>
              )}

              {/* Assign / replace trainer */}
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
                {session?.trainerId ? t("session.replaceTrainer") : t("session.assignTrainer")}
              </Button>
            </Card>
          </TabsContent>

          <TabsContent value="manage" className="mt-4 space-y-4">
            <Card className="p-6 space-y-4 max-w-3xl">
              <div>
                <h3 className="text-sm font-semibold mb-2">{t("session.manageTitle")}</h3>
                <p className="text-xs text-muted-foreground">{t("session.manageHint")}</p>
              </div>

              {/* Split session */}
              <div className="rounded-md border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-primary" />
                  <div className="text-sm font-medium">{t("session.splitTitle")}</div>
                </div>
                <p className="text-xs text-muted-foreground">{t("session.splitHint")}</p>
                <Button disabled={!canEdit} onClick={openSplitDialog}>
                  <Users className="h-4 w-4 me-1.5" />
                  {t("session.split")}
                </Button>
              </div>

              {/* Move trainees */}
              <div className="rounded-md border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <ArrowRight className="h-4 w-4 text-primary" />
                  <div className="text-sm font-medium">{t("session.moveTitle")}</div>
                </div>
                <p className="text-xs text-muted-foreground">{t("session.moveHint")}</p>
                <Button variant="outline" disabled={!canEdit || enrollments.length === 0}
                  onClick={() => { setMoveOpen(true); void loadOtherSessions(); setMoveTraineeIds([]); setMoveTargetSessionId(""); }}>
                  {t("session.moveTrainees")}
                </Button>
              </div>

              {/* Merge sessions */}
              <div className="rounded-md border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-primary" />
                  <div className="text-sm font-medium">{t("session.mergeTitle")}</div>
                </div>
                <p className="text-xs text-muted-foreground">{t("session.mergeHint")}</p>
                <Button variant="outline" disabled={!canEdit}
                  onClick={() => { setMergeOpen(true); void loadOtherSessions(); setMergeSelection([]); }}>
                  {t("session.mergeSessions")}
                </Button>
              </div>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="mt-4">
            {sessionId && <SessionHistoryTab sessionId={sessionId} />}
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
        </Tabs>
        </>
      )}

      {/* ── Enhanced Enroll Dialog ─────────────────────────────────────────
          Tabbed dialog with two options:
          1. "Search Existing" — search all trainees globally, multi-select,
             enroll them all at once. Supports re-exam (auto-detected by backend).
          2. "Create New" — inline trainee creation form with all fields.
             Creates the trainee AND enrolls them in this session in one flow.
      */}
      <FormDialog
        open={enrollOpen}
        onOpenChange={(o) => {
          setEnrollOpen(o);
          if (!o) {
            setEnrollTab("search");
            setEnrollSearch("");
            setEnrollSearchResults([]);
            setEnrollSelectedIds(new Set());
            setNewTraineeForm({});
          }
        }}
        title={t("session.enroll")}
        icon={Users}
        size="lg"
        isSubmitting={busy === "enroll" || creatingTrainee}
        onSubmit={() => {
          if (enrollTab === "search") {
            void enrollSelected();
          } else {
            void createAndEnroll();
          }
        }}
      >
        <Tabs value={enrollTab} onValueChange={(v) => setEnrollTab(v as "search" | "create")}>
          <TabsList className="mb-4">
            <TabsTrigger value="search">{t("session.searchExisting")}</TabsTrigger>
            <TabsTrigger value="create">{t("session.createNew")}</TabsTrigger>
          </TabsList>

          {/* ── Tab 1: Search Existing ── */}
          <TabsContent value="search" className="space-y-3">
            <div className="relative">
              <Search className="absolute start-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={enrollSearch}
                onChange={(e) => void searchTrainees(e.target.value)}
                placeholder={t("session.manualAddSearch")}
                className="ps-8"
                autoFocus
              />
            </div>

            {enrollSearching ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : enrollSearchResults.length > 0 ? (
              <div className="rounded-md border max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <tbody>
                    {enrollSearchResults.map((tr) => (
                      <tr
                        key={tr.id}
                        className="border-b last:border-0 hover:bg-muted/30 cursor-pointer"
                        onClick={() => toggleEnrollSelect(tr.id)}
                      >
                        <td className="px-2 py-1.5 w-8">
                          <input
                            type="checkbox"
                            checked={enrollSelectedIds.has(tr.id)}
                            readOnly
                            className="h-3.5 w-3.5"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="font-medium">{tr.fullName}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{tr.refNumber}</div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : enrollSearch.trim() ? (
              <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                {t("session.manualAddNoResults")}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                {t("session.searchToEnroll")}
              </div>
            )}

            {enrollSelectedIds.size > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("session.manualAddSelected", { count: enrollSelectedIds.size })}
              </p>
            )}
          </TabsContent>

          {/* ── Tab 2: Create New Trainee ── */}
          <TabsContent value="create" className="space-y-3">
            <FormGrid>
              <Field label={t("trainees.fullName")} required>
                <Input
                  value={newTraineeForm.fullName ?? ""}
                  onChange={(e) => setNewTraineeForm({ ...newTraineeForm, fullName: e.target.value })}
                  placeholder="Ahmed Al-Rashid"
                />
              </Field>
              <Field label={t("trainees.nationalId")} required>
                <Input
                  value={newTraineeForm.nationalId ?? ""}
                  onChange={(e) => setNewTraineeForm({ ...newTraineeForm, nationalId: e.target.value })}
                  placeholder="1234567890"
                />
              </Field>
              <Field label={t("trainees.nationality")}>
                <Input
                  value={newTraineeForm.nationality ?? ""}
                  onChange={(e) => setNewTraineeForm({ ...newTraineeForm, nationality: e.target.value })}
                  placeholder="Saudi"
                />
              </Field>
              <Field label={t("trainees.company")} required>
                <Select
                  value={newTraineeForm.companyId ?? "__none__"}
                  onValueChange={(v) => {
                    if (v === "__none__") return;
                    setNewTraineeForm({ ...newTraineeForm, companyId: v });
                  }}
                  onOpenChange={(o) => { if (o) void loadCompaniesForForm(); }}
                >
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {companiesList.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name} ({c.refNumber})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("trainees.jobTitle")}>
                <Input
                  value={newTraineeForm.jobTitle ?? ""}
                  onChange={(e) => setNewTraineeForm({ ...newTraineeForm, jobTitle: e.target.value })}
                  placeholder="Safety Officer"
                />
              </Field>
              <Field label={t("trainees.mobile")}>
                <Input
                  value={newTraineeForm.mobile ?? ""}
                  onChange={(e) => setNewTraineeForm({ ...newTraineeForm, mobile: e.target.value })}
                  placeholder="+966 5x xxx xxxx"
                />
              </Field>
              <Field label={t("trainees.email")}>
                <Input
                  value={newTraineeForm.email ?? ""}
                  onChange={(e) => setNewTraineeForm({ ...newTraineeForm, email: e.target.value })}
                  placeholder="trainee@example.com"
                />
              </Field>
              <Field label={t("trainee.dateOfBirth")}>
                <Input
                  type="date"
                  value={newTraineeForm.dateOfBirth ?? ""}
                  onChange={(e) => setNewTraineeForm({ ...newTraineeForm, dateOfBirth: e.target.value })}
                />
              </Field>
              <Field label={t("trainee.idExpiry")}>
                <Input
                  type="date"
                  value={newTraineeForm.idExpiry ?? ""}
                  onChange={(e) => setNewTraineeForm({ ...newTraineeForm, idExpiry: e.target.value })}
                />
              </Field>
            </FormGrid>
          </TabsContent>
        </Tabs>
      </FormDialog>

      {/* ── Edit Trainee Dialog ─────────────────────────────────────────────
          Opens from the enrollment table's edit button. Lets the coordinator
          edit any trainee's info (name, company, nationality, job title, etc.)
          without leaving the session detail page. Company changes cascade to
          SessionCompany automatically (handled by the PUT /api/trainees/[id]
          endpoint). */}
      <FormDialog
        open={editTraineeOpen}
        onOpenChange={(o) => { if (!o) { setEditTraineeOpen(false); setEditTraineeId(null); setEditTraineeData({}); } }}
        title={t("session.editTrainee")}
        icon={UserCircle}
        size="lg"
        isSubmitting={savingTrainee}
        onSubmit={() => void saveTraineeEdit()}
      >
        <FormGrid>
          <Field label={t("trainees.fullName")} required>
            <Input
              value={(editTraineeData.fullName as string) ?? ""}
              onChange={(e) => setEditTraineeData({ ...editTraineeData, fullName: e.target.value })}
            />
          </Field>
          <Field label={t("trainees.nationalId")} required>
            <Input
              value={(editTraineeData.nationalId as string) ?? ""}
              onChange={(e) => setEditTraineeData({ ...editTraineeData, nationalId: e.target.value })}
            />
          </Field>
          <Field label={t("trainees.nationality")}>
            <Input
              value={(editTraineeData.nationality as string) ?? ""}
              onChange={(e) => setEditTraineeData({ ...editTraineeData, nationality: e.target.value })}
            />
          </Field>
          <Field label={t("trainees.jobTitle")}>
            <Input
              value={(editTraineeData.jobTitle as string) ?? ""}
              onChange={(e) => setEditTraineeData({ ...editTraineeData, jobTitle: e.target.value })}
            />
          </Field>
          <Field label={t("trainees.mobile")}>
            <Input
              value={(editTraineeData.mobile as string) ?? ""}
              onChange={(e) => setEditTraineeData({ ...editTraineeData, mobile: e.target.value })}
            />
          </Field>
          <Field label={t("trainees.email")}>
            <Input
              value={(editTraineeData.email as string) ?? ""}
              onChange={(e) => setEditTraineeData({ ...editTraineeData, email: e.target.value })}
            />
          </Field>
          <Field label={t("trainees.company")} hint={t("session.editTraineeCompanyHint")}>
            <Select
              value={(editTraineeData.companyId as string) ?? "__none__"}
              onValueChange={(v) => { if (v !== "__none__") setEditTraineeData({ ...editTraineeData, companyId: v }); }}
              onOpenChange={(o) => { if (o) void loadCompaniesForForm(); }}
            >
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {companiesList.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} ({c.refNumber})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("trainee.dateOfBirth")}>
            <Input
              type="date"
              value={editTraineeData.dateOfBirth ? new Date(editTraineeData.dateOfBirth as string).toISOString().slice(0, 10) : ""}
              onChange={(e) => setEditTraineeData({ ...editTraineeData, dateOfBirth: e.target.value })}
            />
          </Field>
          <Field label={t("trainee.idExpiry")}>
            <Input
              type="date"
              value={editTraineeData.idExpiry ? new Date(editTraineeData.idExpiry as string).toISOString().slice(0, 10) : ""}
              onChange={(e) => setEditTraineeData({ ...editTraineeData, idExpiry: e.target.value })}
            />
          </Field>
        </FormGrid>
      </FormDialog>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(o) => !o && setRemoveTarget(null)}
        description={removeTarget?.trainee?.fullName}
        destructive
        loading={busy === "remove"}
        onConfirm={() => void removeEnrollment()}
      />

      {/* Split dialog — per-split overrides for shift/dates/trainer/venue/capacity.
          Each split session can be configured independently. Fields left blank
          inherit from the source session. */}
      <FormDialog
        open={splitOpen}
        onOpenChange={(o) => !o && setSplitOpen(false)}
        title={t("session.splitTitle")}
        icon={Users}
        size="2xl"
        isSubmitting={splitting}
        onSubmit={() => void handleSplit()}
      >
        <div className="space-y-4">
          <div className="flex items-end gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{t("session.splitCount")}</label>
              <Input type="number" min={2} max={10} value={splitCount}
                onChange={(e) => updateSplitCount(parseInt(e.target.value, 10) || 2)}
                className="w-24" />
            </div>
            <p className="text-xs text-muted-foreground pb-2">{t("session.splitPerSplitHint")}</p>
          </div>

          {/* Per-split configuration cards */}
          <div className="space-y-3">
            {splitOverrides.map((ov, i) => (
              <div key={i} className="rounded-md border p-3 space-y-3">
                <div className="text-xs font-semibold text-muted-foreground">
                  {t("session.splitSessionN", { n: i + 1, total: splitCount })}
                </div>
                <FormGrid cols={3}>
                  <Field label={t("session.splitShift")}>
                    <Select
                      value={ov.shift ?? ""}
                      onValueChange={(v) => setSplitOverride(i, { shift: v as "MORNING" | "EVENING" })}
                    >
                      <SelectTrigger><SelectValue placeholder={t("session.splitInherit")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="MORNING">{t("sessions.shift.MORNING")}</SelectItem>
                        <SelectItem value="EVENING">{t("sessions.shift.EVENING")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={t("session.splitStartDate")}>
                    <Input
                      type="datetime-local"
                      value={ov.startDate ?? ""}
                      onChange={(e) => setSplitOverride(i, { startDate: e.target.value })}
                    />
                  </Field>
                  <Field label={t("session.splitEndDate")}>
                    <Input
                      type="datetime-local"
                      value={ov.endDate ?? ""}
                      onChange={(e) => setSplitOverride(i, { endDate: e.target.value })}
                    />
                  </Field>
                  <Field label={t("session.splitCapacity")}>
                    <Input
                      type="number"
                      min={1}
                      value={ov.capacity ?? ""}
                      onChange={(e) => setSplitOverride(i, { capacity: parseInt(e.target.value, 10) || undefined })}
                      placeholder={t("session.splitInherit")}
                    />
                  </Field>
                  <Field label={t("session.splitVenue")}>
                    <Input
                      value={ov.venue ?? ""}
                      onChange={(e) => setSplitOverride(i, { venue: e.target.value })}
                      placeholder={t("session.splitInherit")}
                    />
                  </Field>
                  <Field label={t("session.splitCity")}>
                    <Input
                      value={ov.city ?? ""}
                      onChange={(e) => setSplitOverride(i, { city: e.target.value })}
                      placeholder={t("session.splitInherit")}
                    />
                  </Field>
                  <Field label={t("session.splitTrainer")}>
                    <Select
                      value={ov.trainerId ?? "__inherit__"}
                      onValueChange={(v) => setSplitOverride(i, { trainerId: v === "__inherit__" ? undefined : v === "__none__" ? null : v })}
                    >
                      <SelectTrigger><SelectValue placeholder={t("session.splitInherit")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__inherit__">{t("session.splitInherit")}</SelectItem>
                        <SelectItem value="__none__">{t("session.splitNoTrainer")}</SelectItem>
                        {trainers.map((tr) => (
                          <SelectItem key={tr.id} value={tr.id}>{tr.fullName}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </FormGrid>
              </div>
            ))}
          </div>
        </div>
      </FormDialog>

      {/* Move trainees dialog — pick a target session (same course) and
          check the trainees to move. The backend soft-deletes the source
          enrollments and creates new ones on the target, preserving
          progress fields. */}
      <FormDialog
        open={moveOpen}
        onOpenChange={(o) => !o && setMoveOpen(false)}
        title={t("session.moveTrainees")}
        icon={ArrowRight}
        size="md"
        isSubmitting={moving}
        onSubmit={() => void handleMoveTrainees()}
      >
        <div className="space-y-4">
          <Field label={t("session.targetSession")} required>
            <Select value={moveTargetSessionId} onValueChange={setMoveTargetSessionId}>
              <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                {otherSessions.length === 0 ? (
                  <SelectItem value="_none" disabled>{t("session.noOtherSessions")}</SelectItem>
                ) : (
                  otherSessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.refNumber} — {s.title}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>

          <div className="space-y-2">
            <div className="text-xs font-medium">{t("session.selectTrainees")}</div>
            <div className="rounded-md border max-h-72 overflow-y-auto">
              {enrollments.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">{t("session.noEnrollmentsMove")}</div>
              ) : (
                <table className="w-full text-xs">
                  <tbody>
                    {enrollments.map((e) => (
                      <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-2 py-1.5 w-8">
                          <input
                            type="checkbox"
                            checked={moveTraineeIds.includes(e.traineeId)}
                            onChange={() => toggleMoveTrainee(e.traineeId)}
                            className="h-3.5 w-3.5"
                          />
                        </td>
                        <td className="px-2 py-1.5">{e.trainee?.fullName}</td>
                        <td className="px-2 py-1.5 text-muted-foreground font-mono">{e.trainee?.refNumber}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("session.moveSelectedCount", { count: moveTraineeIds.length })}
            </p>
          </div>
        </div>
      </FormDialog>

      {/* Merge sessions dialog — pick additional sessions (same course) to
          merge INTO a new combined session. The backend creates a fresh
          session with the union of all enrollments and soft-deletes the
          sources. */}
      <FormDialog
        open={mergeOpen}
        onOpenChange={(o) => !o && setMergeOpen(false)}
        title={t("session.mergeSessions")}
        icon={Building2}
        size="md"
        isSubmitting={merging}
        onSubmit={() => void handleMerge()}
      >
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">{t("session.mergeDialogHint")}</p>

          <div className="space-y-2">
            <div className="text-xs font-medium">{t("session.selectSessions")}</div>
            <div className="rounded-md border max-h-72 overflow-y-auto">
              {otherSessions.length === 0 ? (
                <div className="p-4 text-center text-xs text-muted-foreground">{t("session.noOtherSessions")}</div>
              ) : (
                <table className="w-full text-xs">
                  <tbody>
                    {otherSessions.map((s) => (
                      <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                        <td className="px-2 py-1.5 w-8">
                          <input
                            type="checkbox"
                            checked={mergeSelection.includes(s.id)}
                            onChange={() => toggleMergeSelection(s.id)}
                            className="h-3.5 w-3.5"
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="font-mono text-xs font-semibold text-primary">{s.refNumber}</div>
                          <div className="text-muted-foreground">{s.title}</div>
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {new Date(s.startDate).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("session.mergeSelectedCount", { count: mergeSelection.length })}
            </p>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
