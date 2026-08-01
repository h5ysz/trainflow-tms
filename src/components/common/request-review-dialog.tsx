"use client";

// ─────────────────────────────────────────────────────────────────────────────
// Coordinator Request Review — fullscreen modal that lets a coordinator work
// through the full request lifecycle without leaving the screen.
//
// Sections (tabs):
//   1. General   — request number, contractor, company, course, trainee count,
//                  preferred dates, preferred location, priority, status, dates.
//   2. Trainees  — full trainee list with per-row ID/Iqama attachment preview.
//   3. Import    — Excel import summary (when available).
//   4. Attachments — every uploaded file, preview + download.
//   5. Actions   — Save / Return / Reject / Approve / Create Session.
//
// Workflow rules (single source of truth — `CoordinatorAction` below):
//   DRAFT       → Submit, Cancel
//   SUBMITTED   → Start Review (→ UNDER_REVIEW), Cancel
//   UNDER_REVIEW → Return (REJECTED + reason), Reject (REJECTED + reason),
//                  Approve (→ APPROVED), Cancel
//   APPROVED    → Create Training Session (opens GenerateSessionsDialog)
//   SCHEDULED / IN_PROGRESS / COMPLETED / CANCELLED / REJECTED → read-only
//
// The footer action buttons reflect the SAME rules, so the coordinator never
// sees an invalid option.
// ─────────────────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, PriorityBadge } from "@/components/common/status-badge";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { GenerateSessionsDialog } from "@/components/common/generate-sessions-dialog";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError } from "@/lib/api/client";
import {
  ClipboardList, FileText, Users, FileSpreadsheet, Paperclip,
  Settings2, Check, X, RotateCcw, Save, CalendarRange, ArrowRight,
  AlertCircle, Download, Eye, Loader2, Building2, CalendarDays,
  MapPin, Globe, UserCircle, Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RequestListRow {
  id: string;
  refNumber: string;
  companyName?: string | null;
  companyRef?: string | null;
  courseTitle?: string | null;
  courseCode?: string | null;
  courseRef?: string | null;
  traineeCount: number;
  preferredDateFrom?: string | null;
  preferredDateTo?: string | null;
  preferredLocation?: string | null;
  preferredLanguage?: string | null;
  notes?: string | null;
  status: string;
  priority: string;
  submittedAt?: string | null;
  reviewedAt?: string | null;
  approvedAt?: string | null;
  scheduledAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  rejectedAt?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
}

interface ReviewTrainee {
  id: string;
  refNumber?: string | null;
  fullName: string;
  nationalId: string;
  nationality?: string | null;
  jobTitle?: string | null;
  mobile?: string | null;
  email?: string | null;
  idAttachmentUrl?: string | null;
  company?: { id: string; name: string } | null;
}

interface ReviewRequestCourse {
  id: string;
  courseId: string;
  traineeCount: number;
  minTrainees?: number | null;
  maxTrainees?: number | null;
  notes?: string | null;
  course: { id: string; title: string | null; code: string | null; refNumber: string | null };
  trainees: { id: string; trainee: ReviewTrainee }[];
  _count?: { sessions?: number };
}

interface ReviewSession {
  id: string;
  refNumber: string;
  title: string | null;
  startDate: string;
  endDate: string;
  shift: string | null;
  status: string;
}

interface RequestDetail extends RequestListRow {
  companyId?: string;
  courseId?: string | null;
  company?: { id: string; name: string; refNumber?: string | null; city?: string | null } | null;
  course?: { id: string; title: string; code: string; refNumber: string } | null;
  requestCourses: ReviewRequestCourse[];
  sessions: ReviewSession[];
  approvedBy?: string | null;
}

type CoordinatorAction =
  | "submit" | "startReview" | "approve" | "return" | "reject"
  | "createSession" | "cancel" | "resubmit";

// Action visibility per status — single source of truth.
// Mirrors the workflow rules in the requirements.
const ACTIONS_BY_STATUS: Record<string, CoordinatorAction[]> = {
  DRAFT: ["submit", "cancel"],
  SUBMITTED: ["startReview", "cancel"],
  UNDER_REVIEW: ["return", "reject", "approve", "cancel"],
  APPROVED: ["createSession"],
  SCHEDULED: [],
  IN_PROGRESS: [],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: ["resubmit"],
};

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

// ─── Helper: format date safely ───────────────────────────────────────────────

function fmtDate(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

function fmtDateTime(value?: string | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString();
}

function toDateInput(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

// ─── Attachment preview helpers ───────────────────────────────────────────────

function isImageUrl(url: string): boolean {
  return /\.(png|jpe?g|webp|gif)(\?|$)/i.test(url);
}

function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url);
}

function fileNameFromUrl(url: string): string {
  const parts = url.split("/");
  return parts[parts.length - 1] || url;
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface RequestReviewDialogProps {
  /** The list-row summary. Used as a placeholder until the detail loads. */
  request: RequestListRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after any state-changing action (save / approve / reject / etc.). */
  onChanged: () => void;
  /** Whether the current user can edit the request (requests.edit). */
  canEdit: boolean;
  /** Whether the current user can create sessions (sessions.create). */
  canCreateSession: boolean;
}

export function RequestReviewDialog({
  request, open, onOpenChange, onChanged, canEdit, canCreateSession,
}: RequestReviewDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();

  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // `loadedFor` doubles as the loading flag: when `open && request && loadedFor !== request.id`,
  // we are still fetching. This avoids calling setState synchronously in the effect
  // (React 19's set-state-in-effect lint rule) — `loadedFor` is updated only inside
  // the promise resolution / rejection callbacks.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = open && Boolean(request) && loadedFor !== (request?.id ?? null);

  // Editable form state (mirrors fields the coordinator can save without
  // changing status: priority, dates, location, language, notes).
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);

  // Sub-dialogs
  const [reasonDialog, setReasonDialog] = useState<
    null | { kind: "return" | "reject"; title: string; description: string }
  >(null);
  const [reasonText, setReasonText] = useState("");
  const [reasonSubmitting, setReasonSubmitting] = useState(false);
  const [generateOpen, setGenerateOpen] = useState(false);

  // Attachment preview dialog
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLabel, setPreviewLabel] = useState<string>("");

  // Active tab — default to General
  const [tab, setTab] = useState("general");

  // ─── Load full detail when opened ──────────────────────────────────────────
  useEffect(() => {
    if (!open || !request) return;
    if (loadedFor === request.id) return;
    let cancelled = false;
    // Loading and error are reset by the resolution below rather than synchronously
    // here; `loadedFor` is what distinguishes "still fetching" from "fetched".
    api
      .get<RequestDetail>(`/requests/${request.id}`)
      .then((d) => {
        if (cancelled) return;
        setLoadError(null);
        setDetail(d);
        setLoadedFor(d.id);
        setFormData({
          priority: d.priority ?? "NORMAL",
          preferredDateFrom: toDateInput(d.preferredDateFrom),
          preferredDateTo: toDateInput(d.preferredDateTo),
          preferredLocation: d.preferredLocation ?? "",
          preferredLanguage: d.preferredLanguage ?? "en",
          notes: d.notes ?? "",
        });
      })
      .catch((e) => {
        if (cancelled) return;
        setLoadError((e as Error).message);
        setLoadedFor(request.id);
      });
    return () => { cancelled = true; };
  }, [open, request, loadedFor]);

  // Reset cached detail when the dialog closes so reopening a different
  // request does not briefly show stale data. We avoid synchronous setState
  // by deferring the reset to a microtask — by then `open` has already
  // flipped to false, so the dialog body is unmounted and the reset is
  // purely an internal state cleanup for the next open.
  useEffect(() => {
    if (open) return;
    // Only reset if there is anything to reset, otherwise this fires on first mount.
    if (loadedFor === null && detail === null && reasonDialog === null && previewUrl === null) return;
    const handle = setTimeout(() => {
      setDetail(null);
      setLoadedFor(null);
      setFormData({});
      setReasonDialog(null);
      setReasonText("");
      setGenerateOpen(false);
      setPreviewUrl(null);
      setPreviewLabel("");
      setTab("general");
    }, 0);
    return () => clearTimeout(handle);
  }, [open]);

  const setField = useCallback((k: string, v: unknown) => {
    setFormData((p) => ({ ...p, [k]: v }));
  }, []);

  // ─── Derive display values ─────────────────────────────────────────────────
  const currentStatus = detail?.status ?? request?.status ?? "";
  const actions = ACTIONS_BY_STATUS[currentStatus] ?? [];
  const refNumber = detail?.refNumber ?? request?.refNumber ?? "";
  const priority = (formData.priority as string) ?? detail?.priority ?? request?.priority ?? "NORMAL";

  // Aggregate all trainees across all courses-in-request for the Attachments
  // tab and the flat Trainees tab when there's only one course.
  const allTrainees = useMemo<{ course: string; trainee: ReviewTrainee }[]>(() => {
    if (!detail) return [];
    return detail.requestCourses.flatMap((rc) =>
      rc.trainees.map((tr) => ({ course: rc.course.title ?? rc.course.code ?? "—", trainee: tr.trainee }))
    );
  }, [detail]);

  const attachmentsWithOwner = useMemo<{
    ownerName: string; ownerNationalId: string; course: string; url: string;
  }[]>(() => {
    return allTrainees
      .filter(({ trainee }) => Boolean(trainee.idAttachmentUrl))
      .map(({ trainee, course }) => ({
        ownerName: trainee.fullName,
        ownerNationalId: trainee.nationalId,
        course,
        url: trainee.idAttachmentUrl as string,
      }));
  }, [allTrainees]);

  // ─── Action handlers ───────────────────────────────────────────────────────

  // Fire a status change via PUT. `rejectionReason` is required for return/reject.
  const transition = useCallback(async (
    newStatus: string,
    opts: { reason?: string; successKey: string } = { successKey: "misc.updateSuccess" },
  ) => {
    if (!detail) return;
    const body: Record<string, unknown> = { status: newStatus };
    if (opts.reason !== undefined) body.rejectionReason = opts.reason;
    try {
      await api.put(`/requests/${detail.id}`, body);
      toast({ title: t("misc.success"), description: t(opts.successKey as never) });
      // Refresh detail so the UI reflects the new status immediately.
      const fresh = await api.get<RequestDetail>(`/requests/${detail.id}`);
      setDetail(fresh);
      setFormData({
        priority: fresh.priority ?? "NORMAL",
        preferredDateFrom: toDateInput(fresh.preferredDateFrom),
        preferredDateTo: toDateInput(fresh.preferredDateTo),
        preferredLocation: fresh.preferredLocation ?? "",
        preferredLanguage: fresh.preferredLanguage ?? "en",
        notes: fresh.notes ?? "",
      });
      onChanged();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  }, [detail, toast, t, onChanged]);

  // Self-service transitions (submit / cancel / resubmit) for callers without
  // requests.edit — they go through the dedicated /transition endpoint.
  const selfServiceTransition = useCallback(async (
    newStatus: string, successKey: string,
  ) => {
    if (!detail) return;
    try {
      await api.post(`/requests/${detail.id}/transition`, { status: newStatus });
      toast({ title: t("misc.success"), description: t(successKey as never) });
      const fresh = await api.get<RequestDetail>(`/requests/${detail.id}`);
      setDetail(fresh);
      onChanged();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  }, [detail, toast, t, onChanged]);

  const handleSave = async () => {
    if (!detail) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        priority: formData.priority,
        preferredLocation: formData.preferredLocation,
        preferredLanguage: formData.preferredLanguage,
        notes: formData.notes,
      };
      // Only send dates if the user typed something — backend stores null when empty.
      if (formData.preferredDateFrom) body.preferredDateFrom = formData.preferredDateFrom;
      else body.preferredDateFrom = null;
      if (formData.preferredDateTo) body.preferredDateTo = formData.preferredDateTo;
      else body.preferredDateTo = null;
      await api.put(`/requests/${detail.id}`, body);
      toast({ title: t("misc.success"), description: t("requests.review.saved") });
      const fresh = await api.get<RequestDetail>(`/requests/${detail.id}`);
      setDetail(fresh);
      onChanged();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async () => {
    await transition("APPROVED", { successKey: "requests.review.approved" });
  };

  const handleStartReview = async () => {
    await transition("UNDER_REVIEW", { successKey: "requests.review.reviewStarted" });
  };

  const handleSubmit = async () => {
    await selfServiceTransition("SUBMITTED", "requests.review.submitted");
  };

  const handleResubmit = async () => {
    await selfServiceTransition("SUBMITTED", "requests.review.resubmitted");
  };

  const handleCancelRequest = async () => {
    // Use /transition so contractors without requests.edit can also cancel.
    await selfServiceTransition("CANCELLED", "requests.review.cancelled");
  };

  const openReturnDialog = () => {
    setReasonText(detail?.rejectionReason ?? "");
    setReasonDialog({
      kind: "return",
      title: t("requests.review.confirmReturnTitle"),
      description: t("requests.review.confirmReturnDescription"),
    });
  };

  const openRejectDialog = () => {
    setReasonText("");
    setReasonDialog({
      kind: "reject",
      title: t("requests.review.confirmRejectTitle"),
      description: t("requests.review.confirmRejectDescription"),
    });
  };

  const handleReasonSubmit = async () => {
    if (!reasonDialog || !detail) return;
    const reason = reasonText.trim();
    if (!reason) {
      toast({ title: t("misc.error"), description: t("requests.review.reasonRequired"), variant: "destructive" });
      return;
    }
    setReasonSubmitting(true);
    try {
      // Both "return" and "reject" map to status=REJECTED on the backend —
      // the distinction is purely UX. Return lets the contractor resubmit
      // (REJECTED → SUBMITTED is a valid transition), reject is "permanent"
      // in the sense that the coordinator expects a new request instead.
      await api.put(`/requests/${detail.id}`, {
        status: "REJECTED",
        rejectionReason: reason,
      });
      toast({
        title: t("misc.success"),
        description: reasonDialog.kind === "return"
          ? t("requests.review.returned")
          : t("requests.review.rejected"),
      });
      setReasonDialog(null);
      setReasonText("");
      const fresh = await api.get<RequestDetail>(`/requests/${detail.id}`);
      setDetail(fresh);
      onChanged();
    } catch (e) {
      // Surface the specific approval-validation failure code if present
      const err = e as ApiError;
      toast({ title: t("misc.error"), description: err.message, variant: "destructive" });
    } finally {
      setReasonSubmitting(false);
    }
  };

  const handleCreateSession = () => {
    setGenerateOpen(true);
  };

  const handleGenerated = () => {
    setGenerateOpen(false);
    // Reload detail so the SCHEDULED status + new sessions show up.
    if (detail) {
      api.get<RequestDetail>(`/requests/${detail.id}`).then(setDetail).catch(() => {});
      onChanged();
    }
  };

  // ─── Action button factory ─────────────────────────────────────────────────
  const renderActionButton = (action: CoordinatorAction) => {
    switch (action) {
      case "submit":
        return (
          <Button key={action} onClick={() => void handleSubmit()} disabled={!canEdit}>
            <ArrowRight className="h-4 w-4 me-1.5" /> {t("requests.review.actionSubmit")}
          </Button>
        );
      case "startReview":
        return (
          <Button key={action} onClick={() => void handleStartReview()} disabled={!canEdit}>
            <Eye className="h-4 w-4 me-1.5" /> {t("requests.review.actionStartReview")}
          </Button>
        );
      case "approve":
        return (
          <Button key={action} onClick={() => void handleApprove()} disabled={!canEdit}
            className="bg-success text-success-foreground hover:bg-success/90">
            <Check className="h-4 w-4 me-1.5" /> {t("requests.review.actionApprove")}
          </Button>
        );
      case "return":
        return (
          <Button key={action} variant="outline" onClick={openReturnDialog} disabled={!canEdit}>
            <RotateCcw className="h-4 w-4 me-1.5" /> {t("requests.review.actionReturn")}
          </Button>
        );
      case "reject":
        return (
          <Button key={action} variant="outline" onClick={openRejectDialog} disabled={!canEdit}
            className="text-destructive border-destructive/30 hover:bg-destructive/5">
            <X className="h-4 w-4 me-1.5" /> {t("requests.review.actionReject")}
          </Button>
        );
      case "createSession":
        return (
          <Button key={action} onClick={handleCreateSession} disabled={!canCreateSession}>
            <CalendarRange className="h-4 w-4 me-1.5" /> {t("requests.review.actionCreateSession")}
          </Button>
        );
      case "cancel":
        return (
          <Button key={action} variant="ghost" onClick={() => void handleCancelRequest()}
            className="text-destructive">
            <X className="h-4 w-4 me-1.5" /> {t("requests.review.actionCancel")}
          </Button>
        );
      case "resubmit":
        return (
          <Button key={action} onClick={() => void handleResubmit()} disabled={!canEdit}>
            <RotateCcw className="h-4 w-4 me-1.5" /> {t("requests.review.actionResubmit")}
          </Button>
        );
      default:
        return null;
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="!max-w-[95vw] !w-[95vw] !max-h-[95vh] !h-[95vh] p-0 gap-0 flex flex-col overflow-hidden"
        >
          {/* Header */}
          <DialogHeader className="p-5 border-b shrink-0 space-y-1">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <DialogTitle className="flex items-center gap-2 text-base">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ClipboardList className="h-4.5 w-4.5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-semibold text-primary">{refNumber}</span>
                    {detail && <PriorityBadge priority={priority} />}
                    {detail && <StatusBadge status={currentStatus} />}
                  </div>
                  <DialogDescription className="text-xs mt-0.5">
                    {t("requests.review.subtitle")}
                  </DialogDescription>
                </div>
              </DialogTitle>
            </div>
          </DialogHeader>

          {/* Body */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : loadError ? (
              <div className="flex items-center justify-center h-full p-6">
                <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive max-w-md">
                  <AlertCircle className="h-5 w-5 shrink-0" />
                  <div>{loadError}</div>
                </div>
              </div>
            ) : detail ? (
              <Tabs value={tab} onValueChange={setTab} className="h-full flex flex-col">
                <div className="border-b shrink-0 px-5">
                  <TabsList className="bg-transparent h-auto p-0 gap-1">
                    <ReviewTabTrigger value="general" icon={ClipboardList} label={t("requests.review.tabGeneral")} />
                    <ReviewTabTrigger value="trainees" icon={Users} label={t("requests.review.tabTrainees")}
                      badge={allTrainees.length} />
                    <ReviewTabTrigger value="import" icon={FileSpreadsheet} label={t("requests.review.tabImport")} />
                    <ReviewTabTrigger value="attachments" icon={Paperclip} label={t("requests.review.tabAttachments")}
                      badge={attachmentsWithOwner.length} />
                    <ReviewTabTrigger value="actions" icon={Settings2} label={t("requests.review.tabActions")} />
                  </TabsList>
                </div>

                <div className="flex-1 min-h-0 overflow-y-auto">
                  <TabsContent value="general" className="m-0 p-5">
                    <GeneralSection detail={detail} formData={formData} setField={setField} canEdit={canEdit} />
                  </TabsContent>
                  <TabsContent value="trainees" className="m-0 p-5">
                    <TraineesSection detail={detail} onPreview={(url, label) => { setPreviewUrl(url); setPreviewLabel(label); }} />
                  </TabsContent>
                  <TabsContent value="import" className="m-0 p-5">
                    <ImportSection detail={detail} />
                  </TabsContent>
                  <TabsContent value="attachments" className="m-0 p-5">
                    <AttachmentsSection items={attachmentsWithOwner}
                      onPreview={(url, label) => { setPreviewUrl(url); setPreviewLabel(label); }} />
                  </TabsContent>
                  <TabsContent value="actions" className="m-0 p-5">
                    <ActionsSection
                      detail={detail}
                      formData={formData}
                      setField={setField}
                      canEdit={canEdit}
                      canCreateSession={canCreateSession}
                      actions={actions}
                      saving={saving}
                      onSave={() => void handleSave()}
                      onAction={(a) => {
                        switch (a) {
                          case "submit": void handleSubmit(); break;
                          case "startReview": void handleStartReview(); break;
                          case "approve": void handleApprove(); break;
                          case "return": openReturnDialog(); break;
                          case "reject": openRejectDialog(); break;
                          case "createSession": handleCreateSession(); break;
                          case "cancel": void handleCancelRequest(); break;
                          case "resubmit": void handleResubmit(); break;
                        }
                      }}
                    />
                  </TabsContent>
                </div>
              </Tabs>
            ) : null}
          </div>

          {/* Footer — always-visible action bar */}
          {detail && actions.length > 0 && (
            <div className="border-t bg-muted/30 p-3 shrink-0">
              <div className="flex items-center justify-end gap-2 flex-wrap">
                {actions.map(renderActionButton)}
              </div>
            </div>
          )}
          {detail && actions.length === 0 && (
            <div className="border-t bg-muted/30 p-3 shrink-0">
              <div className="flex items-center justify-center">
                <p className="text-xs text-muted-foreground">{t("requests.noFurtherActions")}</p>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Return / Reject reason dialog */}
      <Dialog open={reasonDialog !== null} onOpenChange={(o) => !o && setReasonDialog(null)}>
        <DialogContent className="max-w-lg p-0 gap-0 flex flex-col overflow-hidden">
          <DialogHeader className="p-5 border-b shrink-0">
            <DialogTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary" />
              {reasonDialog?.title}
            </DialogTitle>
            <DialogDescription className="text-xs">{reasonDialog?.description}</DialogDescription>
          </DialogHeader>
          <div className="p-5 space-y-3">
            <Textarea
              rows={5}
              autoFocus
              placeholder={t("requests.review.reasonPlaceholder")}
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t("requests.review.reasonRequired")}</p>
          </div>
          <div className="border-t p-3 flex items-center justify-end gap-2 shrink-0 bg-muted/30">
            <Button variant="outline" onClick={() => setReasonDialog(null)} disabled={reasonSubmitting}>
              {t("action.cancel")}
            </Button>
            <Button
              onClick={() => void handleReasonSubmit()}
              disabled={reasonSubmitting || !reasonText.trim()}
              className={reasonDialog?.kind === "reject" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {reasonSubmitting ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : null}
              {reasonDialog?.kind === "return" ? t("requests.review.actionReturn") : t("requests.review.actionReject")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Generate Sessions dialog */}
      <GenerateSessionsDialog
        requestId={detail?.id ?? null}
        open={generateOpen}
        onOpenChange={(o) => setGenerateOpen(o)}
        onGenerated={handleGenerated}
      />

      {/* Attachment preview dialog */}
      <AttachmentPreviewDialog
        url={previewUrl}
        label={previewLabel}
        open={previewUrl !== null}
        onOpenChange={(o) => { if (!o) { setPreviewUrl(null); setPreviewLabel(""); } }}
      />
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ReviewTabTrigger({ value, icon: Icon, label, badge }: {
  value: string; icon: React.ComponentType<{ className?: string }>; label: string; badge?: number;
}) {
  return (
    <TabsTrigger value={value} className="rounded-md px-3 py-1.5 text-xs data-[state=active]:bg-primary/10 data-[state=active]:text-primary gap-1.5">
      <Icon className="h-3.5 w-3.5" />
      {label}
      {badge !== undefined && badge > 0 && (
        <span className="ms-1 rounded-full bg-primary/15 text-primary px-1.5 text-[10px] font-semibold leading-4">
          {badge}
        </span>
      )}
    </TabsTrigger>
  );
}

function DetailField({ label, value, icon: Icon }: {
  label: string; value?: string | number | null; icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-md border bg-card p-3 space-y-1">
      <div className="text-xs text-muted-foreground flex items-center gap-1.5">
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </div>
      <div className="text-sm font-medium break-words">
        {value === null || value === undefined || value === "" ? "—" : value}
      </div>
    </div>
  );
}

function GeneralSection({ detail, formData, setField, canEdit }: {
  detail: RequestDetail;
  formData: Record<string, unknown>;
  setField: (k: string, v: unknown) => void;
  canEdit: boolean;
}) {
  const { t } = useI18n();

  const editable = canEdit && ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "REJECTED"].includes(detail.status);

  return (
    <div className="space-y-5 max-w-5xl">
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-primary" />
          {t("requests.review.general")}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <DetailField label={t("requests.requestNumber")} value={detail.refNumber} icon={Hash} />
          <DetailField label={t("requests.review.contractor")}
            value={detail.company?.name ?? detail.companyName} icon={Building2} />
          <DetailField label={t("requests.company")}
            value={detail.company?.name ?? detail.companyName} icon={Building2} />
          <DetailField label={t("requests.course")}
            value={detail.course?.title ?? detail.courseTitle ?? "—"} icon={FileText} />
          <DetailField label={t("requests.traineeCount")} value={detail.traineeCount} icon={Users} />
          <DetailField label={t("requests.priority")} value={detail.priority} icon={AlertCircle} />
          <DetailField label={t("requests.preferredLocation")}
            value={detail.preferredLocation} icon={MapPin} />
          <DetailField label={t("requests.preferredLanguage")}
            value={detail.preferredLanguage} icon={Globe} />
          <DetailField label={t("requests.status")} value={detail.status} />
          <DetailField label={t("requests.review.submissionDate")}
            value={fmtDate(detail.submittedAt)} icon={CalendarDays} />
          <DetailField label={t("requests.createdAt")}
            value={fmtDate(detail.createdAt)} icon={CalendarDays} />
          <DetailField label={t("requests.approvedAt")}
            value={fmtDate(detail.approvedAt)} icon={Check} />
        </div>
      </div>

      {/* Preferred dates block */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-primary" />
          {t("requests.review.dateFrom")} / {t("requests.review.dateTo")}
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DetailField label={t("requests.review.dateFrom")}
            value={fmtDate(detail.preferredDateFrom)} icon={CalendarDays} />
          <DetailField label={t("requests.review.dateTo")}
            value={fmtDate(detail.preferredDateTo)} icon={CalendarDays} />
        </div>
      </div>

      {/* Notes / rejection reason */}
      {detail.notes && (
        <div>
          <h3 className="text-sm font-semibold mb-2">{t("requests.notes")}</h3>
          <div className="rounded-md border p-3 bg-muted/30 text-sm whitespace-pre-wrap">
            {detail.notes}
          </div>
        </div>
      )}
      {detail.rejectionReason && (
        <div>
          <h3 className="text-sm font-semibold mb-2 text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {t("requests.rejectionReason")}
          </h3>
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            {detail.rejectionReason}
          </div>
        </div>
      )}

      {/* Editable block (when allowed) */}
      {editable && (
        <div className="border-t pt-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            {t("requests.review.editFields")}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{t("requests.review.priority")}</label>
              <Select value={(formData.priority as string) ?? "NORMAL"} onValueChange={(v) => setField("priority", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{t(`priority.${p}` as never)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{t("requests.review.dateFrom")}</label>
              <Input type="date" value={(formData.preferredDateFrom as string) ?? ""}
                onChange={(e) => setField("preferredDateFrom", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{t("requests.review.dateTo")}</label>
              <Input type="date" value={(formData.preferredDateTo as string) ?? ""}
                onChange={(e) => setField("preferredDateTo", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{t("requests.review.location")}</label>
              <Input value={(formData.preferredLocation as string) ?? ""}
                onChange={(e) => setField("preferredLocation", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{t("requests.review.language")}</label>
              <Select value={(formData.preferredLanguage as string) ?? "en"} onValueChange={(v) => setField("preferredLanguage", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                  <SelectItem value="bilingual">Bilingual</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-3">
              <label className="text-xs font-medium">{t("requests.review.notes")}</label>
              <Textarea rows={3} placeholder={t("requests.review.notesPlaceholder")}
                value={(formData.notes as string) ?? ""}
                onChange={(e) => setField("notes", e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{t("requests.review.saveHint")}</p>
        </div>
      )}

      {/* Timeline */}
      <div>
        <h3 className="text-sm font-semibold mb-2">{t("requests.timeline")}</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {([
            ["requests.createdAt", detail.createdAt],
            ["requests.submittedAt", detail.submittedAt],
            ["requests.reviewedAt", detail.reviewedAt],
            ["requests.approvedAt", detail.approvedAt],
            ["requests.scheduledAt", detail.scheduledAt],
            ["requests.startedAt", detail.startedAt],
            ["requests.completedAt", detail.completedAt],
            ["requests.rejectedAt", detail.rejectedAt],
          ] as const)
            .filter(([, at]) => Boolean(at))
            .map(([labelKey, at]) => (
              <div key={labelKey} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <span className="text-xs text-muted-foreground">{t(labelKey)}</span>
                <span className="text-xs font-medium">{fmtDateTime(at as string) ?? "—"}</span>
              </div>
            ))}
        </div>
      </div>

      {/* Existing sessions */}
      {detail.sessions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-2">{t("requests.review.existingSessions")}</h3>
          <div className="space-y-2">
            {detail.sessions.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-primary">{s.refNumber}</span>
                  <span className="text-sm">{s.title ?? "—"}</span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{fmtDate(s.startDate)} → {fmtDate(s.endDate)}</span>
                  {s.shift && <span>· {s.shift}</span>}
                  <StatusBadge status={s.status} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function TraineesSection({ detail, onPreview }: {
  detail: RequestDetail;
  onPreview: (url: string, label: string) => void;
}) {
  const { t } = useI18n();

  if (detail.requestCourses.length === 0) {
    return <EmptyHint text={t("requests.review.noTrainees")} />;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      {detail.requestCourses.map((rc) => (
        <div key={rc.id}>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            {rc.course.title ?? rc.course.code ?? "—"}
            <span className="text-xs font-normal text-muted-foreground">
              · {t("requests.review.traineesInCourse", { count: rc.trainees.length, course: rc.course.title ?? rc.course.code ?? "—" })}
            </span>
          </h3>
          <div className="rounded-md border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-muted/50">
                  <tr>
                    <Th>{t("requests.review.traineeName")}</Th>
                    <Th>{t("requests.review.traineeNationality")}</Th>
                    <Th>{t("requests.review.traineeJobTitle")}</Th>
                    <Th>{t("requests.review.traineeIdNumber")}</Th>
                    <Th className="text-end">{t("requests.review.traineeAttachment")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {rc.trainees.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-6 text-center text-muted-foreground">
                        {t("requests.review.noTrainees")}
                      </td>
                    </tr>
                  ) : rc.trainees.map(({ trainee }) => (
                    <tr key={trainee.id} className="border-t hover:bg-muted/30">
                      <Td>
                        <div className="flex items-center gap-2">
                          <UserCircle className="h-3.5 w-3.5 text-muted-foreground" />
                          <div>
                            <div className="font-medium">{trainee.fullName}</div>
                            {trainee.refNumber && (
                              <div className="text-[10px] font-mono text-muted-foreground">{trainee.refNumber}</div>
                            )}
                          </div>
                        </div>
                      </Td>
                      <Td>{trainee.nationality ?? "—"}</Td>
                      <Td>{trainee.jobTitle ?? "—"}</Td>
                      <Td><span className="font-mono">{trainee.nationalId}</span></Td>
                      <Td className="text-end">
                        {trainee.idAttachmentUrl ? (
                          <div className="inline-flex items-center gap-1">
                            <Button variant="ghost" size="sm" className="h-7 px-2"
                              onClick={() => onPreview(trainee.idAttachmentUrl as string, trainee.fullName)}>
                              <Eye className="h-3.5 w-3.5 me-1" />
                              {t("requests.review.preview")}
                            </Button>
                            <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                              <a href={trainee.idAttachmentUrl as string} target="_blank" rel="noreferrer" download>
                                <Download className="h-3.5 w-3.5" />
                              </a>
                            </Button>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">{t("requests.review.noAttachment")}</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ImportSection({ detail }: { detail: RequestDetail }) {
  const { t } = useI18n();

  // The current schema does not store the original Excel summary on the
  // request row. We reconstruct what we CAN from the data: total/valid trainee
  // counts per course. When the request was created from a real Excel import
  // the row count matches the trainee list length; invalid rows are unknown.
  const totalRows = detail.requestCourses.reduce((sum, rc) => sum + rc.trainees.length, 0);
  const hasImportData = totalRows > 0;

  return (
    <div className="space-y-4 max-w-3xl">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <FileSpreadsheet className="h-4 w-4 text-primary" />
        {t("requests.review.importSummary")}
      </h3>
      {!hasImportData ? (
        <EmptyHint text={t("requests.review.noImportData")} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <DetailField label={t("requests.review.importMethod")}
              value={t("requests.review.importMethodExcel")} icon={FileSpreadsheet} />
            <DetailField label={t("requests.review.totalRows")} value={totalRows} icon={Hash} />
            <DetailField label={t("requests.review.validRows")} value={totalRows} icon={Check} />
            <DetailField label={t("requests.review.invalidRows")} value={"—"} icon={AlertCircle} />
          </div>
          <div>
            <h4 className="text-xs font-semibold mb-2 text-muted-foreground">
              {t("requests.review.validationSummary")}
            </h4>
            <div className="space-y-2">
              {detail.requestCourses.map((rc) => {
                const count = rc.trainees.length;
                const tooFew = count < (rc.minTrainees ?? 10);
                const tooMany = count > (rc.maxTrainees ?? 20);
                const ok = !tooFew && !tooMany;
                return (
                  <div key={rc.id} className={cn(
                    "flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-xs",
                    ok ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5",
                  )}>
                    <div className="flex items-center gap-2">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-medium">{rc.course.title ?? rc.course.code}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-muted-foreground">
                        {t("requests.review.traineesInCourse", {
                          count,
                          course: rc.course.title ?? rc.course.code ?? "—",
                        })}
                      </span>
                      {ok ? (
                        <span className="text-success flex items-center gap-1">
                          <Check className="h-3.5 w-3.5" /> 10–20
                        </span>
                      ) : (
                        <span className="text-warning flex items-center gap-1">
                          <AlertCircle className="h-3.5 w-3.5" />
                          {tooFew ? `min ${rc.minTrainees ?? 10}` : `max ${rc.maxTrainees ?? 20}`}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AttachmentsSection({ items, onPreview }: {
  items: { ownerName: string; ownerNationalId: string; course: string; url: string }[];
  onPreview: (url: string, label: string) => void;
}) {
  const { t } = useI18n();

  if (items.length === 0) {
    return <EmptyHint text={t("requests.review.noAttachments")} />;
  }

  return (
    <div className="space-y-3 max-w-5xl">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Paperclip className="h-4 w-4 text-primary" />
        {t("requests.review.attachments")}
        <span className="text-xs font-normal text-muted-foreground">({items.length})</span>
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {items.map((item, idx) => {
          const isImg = isImageUrl(item.url);
          const isPdf = isPdfUrl(item.url);
          return (
            <div key={`${item.url}-${idx}`} className="rounded-md border overflow-hidden bg-card">
              <div className="aspect-video bg-muted/30 flex items-center justify-center overflow-hidden">
                {isImg ? (
                  <img src={item.url} alt={item.ownerName} className="w-full h-full object-cover cursor-pointer"
                    onClick={() => onPreview(item.url, item.ownerName)} />
                ) : isPdf ? (
                  <button type="button" onClick={() => onPreview(item.url, item.ownerName)}
                    className="flex flex-col items-center gap-2 text-muted-foreground hover:text-foreground p-6">
                    <FileText className="h-10 w-10" />
                    <span className="text-xs">PDF</span>
                  </button>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground p-6">
                    <FileText className="h-10 w-10" />
                    <span className="text-xs">{fileNameFromUrl(item.url)}</span>
                  </div>
                )}
              </div>
              <div className="p-3 space-y-1">
                <div className="text-sm font-medium truncate">{item.ownerName}</div>
                <div className="text-xs text-muted-foreground font-mono truncate">{item.ownerNationalId}</div>
                <div className="text-[10px] text-muted-foreground truncate">{item.course}</div>
                <div className="flex items-center gap-1 pt-1">
                  <Button variant="outline" size="sm" className="h-7 flex-1"
                    onClick={() => onPreview(item.url, item.ownerName)}>
                    <Eye className="h-3.5 w-3.5 me-1" />
                    {t("requests.review.preview")}
                  </Button>
                  <Button asChild variant="ghost" size="sm" className="h-7 px-2">
                    <a href={item.url} target="_blank" rel="noreferrer" download>
                      <Download className="h-3.5 w-3.5" />
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ActionsSection({ detail, formData, setField, canEdit, canCreateSession, actions, saving, onSave, onAction }: {
  detail: RequestDetail;
  formData: Record<string, unknown>;
  setField: (k: string, v: unknown) => void;
  canEdit: boolean;
  canCreateSession: boolean;
  actions: CoordinatorAction[];
  saving: boolean;
  onSave: () => void;
  onAction: (a: CoordinatorAction) => void;
}) {
  const { t } = useI18n();

  // Per the redesigned workflow, trainee count NEVER blocks approval —
  // capacity mismatches are advisory warnings, and the auto-splitter at
  // scheduling time will offer to spread trainees across multiple sessions.
  // The only hard block is "request has zero courses" (approving it would
  // create a session with no trainees and no course context).
  const hasNoCourses = detail.requestCourses.length === 0;
  const overCapacityCourses = detail.requestCourses.filter((rc) => {
    const count = rc.trainees.length;
    return count > (rc.maxTrainees ?? 20);
  });
  const underMinimumCourses = detail.requestCourses.filter((rc) => {
    const count = rc.trainees.length;
    return count < (rc.minTrainees ?? 10);
  });
  // Hard block: only the zero-courses case. The Approve button is disabled
  // when this is true.
  const approvalHardBlocked = hasNoCourses;
  // Advisory: capacity warnings are shown but Approve stays enabled.
  const hasCapacityWarning = overCapacityCourses.length > 0 || underMinimumCourses.length > 0;

  return (
    <div className="space-y-5 max-w-3xl">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Settings2 className="h-4 w-4 text-primary" />
        {t("requests.review.coordinatorActions")}
      </h3>

      {/* Hard-block warning: request has no courses. Approval is refused. */}
      {approvalHardBlocked && actions.includes("approve") && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-medium text-destructive">{t("requests.review.approvalNoCourses")}</div>
            </div>
          </div>
        </div>
      )}

      {/* Advisory warning: capacity mismatch. Approval is still allowed —
          auto-split will be offered at scheduling time. */}
      {hasCapacityWarning && !approvalHardBlocked && actions.includes("approve") && (
        <div className="rounded-md border border-info/40 bg-info/10 p-3 text-xs">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-info shrink-0 mt-0.5" />
            <div className="space-y-1">
              <div className="font-medium text-info">{t("requests.review.approvalCapacityAdvisory")}</div>
              <ul className="list-disc list-inside space-y-0.5">
                {overCapacityCourses.map((rc) => {
                  const count = rc.trainees.length;
                  const cap = rc.maxTrainees ?? 20;
                  const sessions = Math.ceil(count / cap);
                  return (
                    <li key={rc.id}>
                      {t("requests.review.approvalOverCapacity", {
                        course: rc.course.title ?? rc.course.code ?? "—",
                        count,
                        capacity: cap,
                        sessions,
                      })}
                    </li>
                  );
                })}
                {underMinimumCourses.map((rc) => (
                  <li key={rc.id}>
                    {t("requests.review.approvalUnderMinimum", {
                      course: rc.course.title ?? rc.course.code ?? "—",
                      count: rc.trainees.length,
                      min: rc.minTrainees ?? 10,
                    })}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      {/* Editable fields + save */}
      {canEdit && ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "REJECTED"].includes(detail.status) && (
        <div className="rounded-md border p-4 space-y-3 bg-card">
          <div className="text-xs font-semibold">{t("requests.review.editFields")}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{t("requests.review.priority")}</label>
              <Select value={(formData.priority as string) ?? "NORMAL"} onValueChange={(v) => setField("priority", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{t(`priority.${p}` as never)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{t("requests.review.location")}</label>
              <Input value={(formData.preferredLocation as string) ?? ""}
                onChange={(e) => setField("preferredLocation", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{t("requests.review.dateFrom")}</label>
              <Input type="date" value={(formData.preferredDateFrom as string) ?? ""}
                onChange={(e) => setField("preferredDateFrom", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{t("requests.review.dateTo")}</label>
              <Input type="date" value={(formData.preferredDateTo as string) ?? ""}
                onChange={(e) => setField("preferredDateTo", e.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label className="text-xs font-medium">{t("requests.review.notes")}</label>
              <Textarea rows={3} placeholder={t("requests.review.notesPlaceholder")}
                value={(formData.notes as string) ?? ""}
                onChange={(e) => setField("notes", e.target.value)} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-xs text-muted-foreground flex-1">{t("requests.review.saveHint")}</p>
            <Button onClick={onSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <Save className="h-4 w-4 me-1.5" />}
              {t("requests.review.actionSave")}
            </Button>
          </div>
        </div>
      )}

      {/* Workflow action cards */}
      <div className="space-y-2">
        {actions.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
            {t("requests.noFurtherActions")}
          </div>
        ) : (
          actions.map((a) => <ActionCard key={a} action={a} canEdit={canEdit} canCreateSession={canCreateSession}
            approvalBlocked={approvalHardBlocked} onClick={() => onAction(a)} />)
        )}
      </div>
    </div>
  );
}

function ActionCard({ action, canEdit, canCreateSession, approvalBlocked, onClick }: {
  action: CoordinatorAction;
  canEdit: boolean;
  canCreateSession: boolean;
  approvalBlocked: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();

  const config: Record<CoordinatorAction, {
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    hint: string;
    variant: "default" | "outline" | "ghost";
    destructive?: boolean;
    success?: boolean;
    disabled?: boolean;
  }> = {
    submit: { icon: ArrowRight, label: t("requests.review.actionSubmit"), hint: t("requests.review.saveHint"), variant: "default", disabled: !canEdit },
    startReview: { icon: Eye, label: t("requests.review.actionStartReview"), hint: t("requests.review.saveHint"), variant: "default", disabled: !canEdit },
    approve: { icon: Check, label: t("requests.review.actionApprove"), hint: t("requests.review.approveHint"), variant: "default", success: true, disabled: !canEdit || approvalBlocked },
    return: { icon: RotateCcw, label: t("requests.review.actionReturn"), hint: t("requests.review.returnHint"), variant: "outline", disabled: !canEdit },
    reject: { icon: X, label: t("requests.review.actionReject"), hint: t("requests.review.rejectHint"), variant: "outline", destructive: true, disabled: !canEdit },
    createSession: { icon: CalendarRange, label: t("requests.review.actionCreateSession"), hint: t("requests.review.createSessionHint"), variant: "default", disabled: !canCreateSession },
    cancel: { icon: X, label: t("requests.review.actionCancel"), hint: t("requests.review.rejectHint"), variant: "ghost", destructive: true },
    resubmit: { icon: RotateCcw, label: t("requests.review.actionResubmit"), hint: t("requests.review.saveHint"), variant: "default", disabled: !canEdit },
  };
  const c = config[action];

  return (
    <div className={cn(
      "rounded-md border p-3 flex items-center justify-between gap-3",
      c.destructive ? "border-destructive/30 bg-destructive/5" : c.success ? "border-success/30 bg-success/5" : "bg-card",
    )}>
      <div className="flex items-center gap-3 min-w-0">
        <div className={cn(
          "flex h-9 w-9 items-center justify-center rounded-lg shrink-0",
          c.destructive ? "bg-destructive/10 text-destructive" : c.success ? "bg-success/10 text-success" : "bg-primary/10 text-primary",
        )}>
          <c.icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-medium">{c.label}</div>
          <div className="text-xs text-muted-foreground line-clamp-2">{c.hint}</div>
        </div>
      </div>
      <Button variant={c.variant} onClick={onClick} disabled={c.disabled}
        className={cn(
          "shrink-0",
          c.success && "bg-success text-success-foreground hover:bg-success/90",
          c.destructive && c.variant === "outline" && "text-destructive border-destructive/30 hover:bg-destructive/5",
          c.destructive && c.variant === "ghost" && "text-destructive",
        )}>
        {c.label}
      </Button>
    </div>
  );
}

// ─── Attachment preview dialog ────────────────────────────────────────────────

function AttachmentPreviewDialog({ url, label, open, onOpenChange }: {
  url: string | null;
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  if (!url) return null;
  const isImg = isImageUrl(url);
  const isPdf = isPdfUrl(url);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="!max-w-4xl !w-[90vw] !max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
        <DialogHeader className="p-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Paperclip className="h-4 w-4 text-primary" />
            <span className="truncate">{label}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-auto bg-muted/30 flex items-center justify-center">
          {isImg ? (
            <img src={url} alt={label} className="max-w-full max-h-full object-contain" />
          ) : isPdf ? (
            <iframe src={url} title={label} className="w-full h-full min-h-[60vh]" />
          ) : (
            <div className="p-10 text-center text-muted-foreground text-sm">
              {fileNameFromUrl(url)} — preview not available.
              <div className="mt-3">
                <Button asChild>
                  <a href={url} target="_blank" rel="noreferrer" download>
                    <Download className="h-4 w-4 me-1.5" />
                    Download
                  </a>
                </Button>
              </div>
            </div>
          )}
        </div>
        <div className="border-t p-3 flex items-center justify-end gap-2 shrink-0 bg-muted/30">
          <Button asChild variant="outline">
            <a href={url} target="_blank" rel="noreferrer" download>
              <Download className="h-4 w-4 me-1.5" />
              Download
            </a>
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t("action.cancel")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Small presentational helpers ─────────────────────────────────────────────

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("text-start font-medium text-muted-foreground px-3 py-2", className)}>{children}</th>;
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-3 py-2 align-middle", className)}>{children}</td>;
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
