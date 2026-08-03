"use client";

import { useState, useEffect, useRef, useState as useReactState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { GenerateSessionsDialog } from "@/components/common/generate-sessions-dialog";
import { TraineeEntrySection, type TraineeEntry } from "@/components/common/trainee-entry-section";
import {
  AdditionalDocumentsSection,
  type AdditionalDocument,
} from "@/components/common/additional-documents-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, PriorityBadge } from "@/components/common/status-badge";
import { ClipboardList, Plus, Building2, BookOpen, Users, Calendar, AlertCircle, Check, X, RotateCcw, ArrowRight, FileText, Download, Upload, Eye, Pencil } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";

interface RequestImportResult {
  requestsCreated: number;
  traineesLinked: number;
  errors: { row: number; message: string }[];
}

interface CompanyOption { id: string; name: string; refNumber: string; }
interface CourseOption { id: string; title: string; code: string; refNumber: string; }
interface Request {
  id: string;
  refNumber: string;
  companyId: string;
  courseId?: string | null;
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

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

// Transitions a requester may perform on their own request without `requests.edit`.
// Mirrors SELF_SERVICE_TRANSITIONS in /api/requests/[id]/transition.
const SELF_SERVICE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["CANCELLED"],
  REJECTED: ["SUBMITTED"],
  REQUIRES_MODIFICATION: ["SUBMITTED", "CANCELLED"],
};

// Workflow transition matrix (mirror of backend)
const NEXT_ACTIONS: Record<string, { status: string; labelKey: string; variant: "default" | "outline" | "ghost"; tone?: "success" | "destructive" | "info" | "warning" }[]> = {
  DRAFT: [
    { status: "SUBMITTED", labelKey: "workflow.submit", variant: "default", tone: "info" },
    { status: "CANCELLED", labelKey: "workflow.cancel", variant: "ghost", tone: "destructive" },
  ],
  SUBMITTED: [
    { status: "UNDER_REVIEW", labelKey: "workflow.review", variant: "default", tone: "info" },
    { status: "CANCELLED", labelKey: "workflow.cancel", variant: "ghost", tone: "destructive" },
  ],
  UNDER_REVIEW: [
    { status: "APPROVED", labelKey: "workflow.approve", variant: "default", tone: "success" },
    { status: "REQUIRES_MODIFICATION", labelKey: "workflow.returnRevision", variant: "outline", tone: "warning" },
    { status: "REJECTED", labelKey: "workflow.reject", variant: "ghost", tone: "destructive" },
    { status: "CANCELLED", labelKey: "workflow.cancel", variant: "ghost", tone: "destructive" },
  ],
  REQUIRES_MODIFICATION: [
    { status: "SUBMITTED", labelKey: "workflow.resubmit", variant: "default", tone: "info" },
    { status: "CANCELLED", labelKey: "workflow.cancel", variant: "ghost", tone: "destructive" },
  ],
  APPROVED: [
    { status: "SCHEDULED", labelKey: "workflow.schedule", variant: "default", tone: "info" },
    { status: "CANCELLED", labelKey: "workflow.cancel", variant: "ghost", tone: "destructive" },
  ],
  SCHEDULED: [
    { status: "IN_PROGRESS", labelKey: "workflow.start", variant: "default", tone: "info" },
    { status: "CANCELLED", labelKey: "workflow.cancel", variant: "ghost", tone: "destructive" },
  ],
  IN_PROGRESS: [
    { status: "COMPLETED", labelKey: "workflow.complete", variant: "default", tone: "success" },
    { status: "CANCELLED", labelKey: "workflow.cancel", variant: "ghost", tone: "destructive" },
  ],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: [
    { status: "SUBMITTED", labelKey: "workflow.resubmit", variant: "default", tone: "info" },
  ],
};

export function TrainingRequestsRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [rejectDialogOpen, setRejectDialogOpen] = useState(false);
  const [rejectTarget, setRejectTarget] = useState<Request | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [revisionTarget, setRevisionTarget] = useState<Request | null>(null);
  const [revisionDialogOpen, setRevisionDialogOpen] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const [detailsTarget, setDetailsTarget] = useState<Request | null>(null);
  const [previewTarget, setPreviewTarget] = useState<Request | null>(null);
  const [editTarget, setEditTarget] = useState<Request | null>(null);
  const [generateTarget, setGenerateTarget] = useState<Request | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>({
    priority: "NORMAL",
    traineeCount: 1,
    preferredLanguage: "en",
    status: "DRAFT",
  });
  // ── New: trainee list (Manual/Copy-Paste/Excel import) ──
  // Replaces the old fixed `traineeCount` integer — the count is now derived
  // from the array length at submission time.
  const [trainees, setTrainees] = useState<TraineeEntry[]>([]);
  // ── New: request-level additional documents ──
  // (medical, vaccination, work permit, company letter, etc.) — files are
  // POSTed to /api/requests/upload-doc, the resulting metadata is collected
  // here and submitted alongside the request.
  const [additionalDocs, setAdditionalDocs] = useState<AdditionalDocument[]>([]);
  const [companies, setCompanies] = useReactState<CompanyOption[]>([]);
  const [courses, setCourses] = useReactState<CourseOption[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Request>("/requests");

  const canCreate = user ? canPerformAction(user.permissions, "requests", "create") : false;
  const canEdit = user ? canPerformAction(user.permissions, "requests", "edit") : false;

  useEffect(() => {
    if (dialogOpen) {
      if (companies.length === 0) {
        api.getList<CompanyOption>("/companies", { pageSize: 100 }).then((r) => {
          setCompanies(r.rows.map((c) => ({ id: c.id, name: c.name, refNumber: c.refNumber })));
        }).catch(() => {});
      }
      if (courses.length === 0) {
        api.getList<CourseOption>("/courses", { pageSize: 100 }).then((r) => {
          setCourses(r.rows.map((c) => ({ id: c.id, title: c.title, code: c.code, refNumber: c.refNumber })));
        }).catch(() => {});
      }
    }
  }, [dialogOpen, companies.length, courses.length]);

  const handleTransition = async (req: Request, newStatus: string) => {
    if (newStatus === "REJECTED") {
      setRejectTarget(req);
      setRejectDialogOpen(true);
      return;
    }
    // "Return for Revision" requires a reason — open the revision dialog.
    if (newStatus === "REQUIRES_MODIFICATION") {
      setRevisionTarget(req);
      setRevisionDialogOpen(true);
      return;
    }
    // Turning an APPROVED request into sessions is a real scheduling decision, not a
    // status flip — collect the dates and shifts first.
    if (newStatus === "SCHEDULED" && req.status === "APPROVED") {
      setGenerateTarget(req);
      return;
    }
    try {
      // The dedicated transition endpoint accepts the requester's own workflow moves
      // (submit / cancel / resubmit) without requiring requests.edit, which contractors
      // do not have. Reviewers keep using PUT, which carries the richer edit payload.
      await api.post(`/requests/${req.id}/transition`, { status: newStatus });
      toast({ title: t("misc.success"), description: t("misc.updateSuccess") });
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectTarget) return;
    try {
      await api.put(`/requests/${rejectTarget.id}`, { status: "REJECTED", rejectionReason: rejectReason || "Rejected" });
      toast({ title: t("misc.success"), description: t("workflow.reject") });
      setRejectDialogOpen(false);
      setRejectTarget(null);
      setRejectReason("");
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };

  // ── Return for Revision: coordinator returns the request to the contractor
  // for modification. Requires a reason. Notifies the contractor.
  const handleRevisionSubmit = async () => {
    if (!revisionTarget) return;
    if (!revisionReason.trim()) {
      toast({ title: t("misc.error"), description: t("requests.revisionReasonRequired") || "A reason is required", variant: "destructive" });
      return;
    }
    try {
      await api.post(`/requests/${revisionTarget.id}/transition`, {
        status: "REQUIRES_MODIFICATION",
        revisionReason,
      });
      toast({ title: t("misc.success"), description: t("workflow.returnRevision") || "Returned for revision" });
      setRevisionDialogOpen(false);
      setRevisionTarget(null);
      setRevisionReason("");
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.postFile<RequestImportResult>("/requests/import", file);
      toast({
        title: t("misc.success"),
        description: t("requests.import.success", {
          requests: result.requestsCreated,
          trainees: result.traineesLinked,
        }),
        variant: result.errors.length > 0 ? "destructive" : "default",
      });
      refetch();
    } catch (err) {
      toast({ title: t("misc.error"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const columns: Column<Request>[] = [
    {
      key: "id",
      header: t("requests.requestNumber"),
      cell: (r) => (
        <div className="font-mono text-xs font-semibold text-primary">{r.refNumber}</div>
      ),
    },
    {
      key: "company",
      header: t("requests.company"),
      cell: (r) => (
        <div className="flex items-center gap-2 text-sm">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          <div>
            <div>{r.companyName || "—"}</div>
            {r.companyRef && <div className="text-[10px] text-muted-foreground font-mono">{r.companyRef}</div>}
          </div>
        </div>
      ),
    },
    {
      key: "course",
      header: t("requests.course"),
      cell: (r) => (
        <div className="flex items-center gap-2 text-sm">
          <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />
          <div>
            <div>{r.courseTitle || "—"}</div>
            {r.courseCode && <div className="text-[10px] text-muted-foreground font-mono">{r.courseCode}</div>}
          </div>
        </div>
      ),
    },
    {
      key: "trainees",
      header: t("requests.traineeCount"),
      cell: (r) => (
        <div className="text-sm flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-muted-foreground" />{r.traineeCount}</div>
      ),
    },
    {
      key: "date",
      header: t("requests.preferredDateFrom"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Calendar className="h-3 w-3" />{r.preferredDateFrom ? new Date(r.preferredDateFrom).toLocaleDateString() : "—"}</div>
      ),
    },
    {
      key: "priority",
      header: t("requests.priority"),
      cell: (r) => <PriorityBadge priority={r.priority} />,
    },
    {
      key: "status",
      header: t("requests.status"),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: (r) => {
        const actions = NEXT_ACTIONS[r.status] ?? [];
        const canEditRequest = r.status === "DRAFT" || r.status === "REQUIRES_MODIFICATION";
        return (
          <div className="flex justify-end items-center gap-1 flex-wrap">
            {/* Preview button — available for ALL requests */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPreviewTarget(r)}
              title={t("action.preview") || "Preview"}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>
            {/* Edit button — only for DRAFT + SUBMITTED */}
            {canEditRequest && canCreate && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => handleEditRequest(r)}
                title={t("action.edit") || "Edit"}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {actions.length === 0 && !canEditRequest && (
              <Button variant="ghost" size="sm" className="h-8" onClick={() => setDetailsTarget(r)}>
                {t("action.details")}
              </Button>
            )}
            {actions.map((a) => (
              <Button
                key={a.status}
                variant={a.variant}
                size="sm"
                className={`h-8 ${
                  a.variant === "default"
                    ? "text-white"
                    : a.tone === "success"
                      ? "text-success"
                      : a.tone === "destructive"
                        ? "text-destructive"
                        : a.tone === "info"
                          ? "text-info"
                          : ""
                }`}
                onClick={() => handleTransition(r, a.status)}
                disabled={!canEdit && !(SELF_SERVICE_TRANSITIONS[r.status] ?? []).includes(a.status)}
              >
                {a.status === "SUBMITTED" && r.status === "REJECTED" && <RotateCcw className="h-3.5 w-3.5 me-1" />}
                {a.status === "APPROVED" && <Check className="h-3.5 w-3.5 me-1" />}
                {a.status === "REJECTED" && <X className="h-3.5 w-3.5 me-1" />}
                {t(a.labelKey as never)}
              </Button>
            ))}
          </div>
        );
      },
    },
  ];

  const handleSubmit = async () => {
    if (!formData.courseId) {
      toast({ title: t("misc.error"), description: t("requests.course") + " — " + t("misc.required"), variant: "destructive" });
      return;
    }
    // Allow saving a DRAFT with no trainees (the user can come back later to
    // add them). But block SUBMITTED requests with zero trainees — that's a
    // coordinator-facing request that must have real trainees attached.
    const isSubmitted = (formData.status as string) === "SUBMITTED";
    if (isSubmitted && trainees.filter((t) => t.fullName && t.nationalId).length === 0) {
      toast({
        title: t("misc.error"),
        description: t("requests.errors.noTraineesOnSubmit") || "Add at least one trainee before submitting.",
        variant: "destructive",
      });
      return;
    }
    setSubmitting(true);
    try {
      // Strip client-only fields from each trainee before sending — the API
      // doesn't need valid/errors/id; it computes its own validation.
      const payloadTrainees = trainees
        .filter((tr) => tr.fullName && tr.nationalId)
        .map((tr) => ({
          fullName: tr.fullName,
          nationalId: tr.nationalId,
          nationality: tr.nationality || null,
          jobTitle: tr.jobTitle || null,
          // Carry any documents already attached at the client (e.g. uploaded
          // via the row's RowDocUpload). The API merges them into Trainee.documents.
          documents: Array.isArray(tr.documents) ? tr.documents : [],
        }));
      await api.post("/requests", {
        ...formData,
        trainees: payloadTrainees,
        additionalDocuments: additionalDocs,
      });
      toast({ title: t("misc.success"), description: t("misc.createSuccess") });
      setDialogOpen(false);
      // Reset all form state — trainees + additionalDocs + formData.
      setFormData({ priority: "NORMAL", traineeCount: 1, preferredLanguage: "en", status: "DRAFT" });
      setTrainees([]);
      setAdditionalDocs([]);
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const setField = (k: string, v: unknown) => setFormData((p) => ({ ...p, [k]: v }));

  // ── Edit existing request: loads the request data into the form + opens
  // the same dialog as "New Request" but in edit mode. The form is pre-filled
  // with the request's current values. On save, it PUTs to /api/requests/[id].
  const handleEditRequest = (req: Request) => {
    setEditTarget(req);
    setFormData({
      priority: req.priority ?? "NORMAL",
      traineeCount: req.traineeCount ?? 1,
      preferredLanguage: req.preferredLanguage ?? "en",
      status: req.status,
      companyId: req.companyId,
      courseId: req.courseId,
      preferredDateFrom: req.preferredDateFrom ? new Date(req.preferredDateFrom).toISOString().slice(0, 10) : "",
      preferredDateTo: req.preferredDateTo ? new Date(req.preferredDateTo).toISOString().slice(0, 10) : "",
      preferredLocation: req.preferredLocation ?? "",
      notes: req.notes ?? "",
    });
    setTrainees([]);
    setAdditionalDocs([]);
    setDialogOpen(true);
  };

  const handleEditSave = async () => {
    if (!editTarget || !formData.courseId) {
      toast({ title: t("misc.error"), description: t("requests.course") + " — " + t("misc.required"), variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const payloadTrainees = trainees
        .filter((tr) => tr.fullName && tr.nationalId)
        .map((tr) => ({
          fullName: tr.fullName,
          nationalId: tr.nationalId,
          nationality: tr.nationality || null,
          jobTitle: tr.jobTitle || null,
          documents: Array.isArray(tr.documents) ? tr.documents : [],
        }));
      await api.put(`/requests/${editTarget.id}`, {
        ...formData,
        trainees: payloadTrainees,
        additionalDocuments: additionalDocs,
      });
      toast({ title: t("misc.success"), description: t("misc.updateSuccess") });
      setDialogOpen(false);
      setEditTarget(null);
      setFormData({ priority: "NORMAL", traineeCount: 1, preferredLanguage: "en", status: "DRAFT" });
      setTrainees([]);
      setAdditionalDocs([]);
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("requests.title")}
        subtitle={t("requests.subtitle")}
        icon={ClipboardList}
        actions={
          <>
            <Button variant="outline" onClick={() => window.open("/api/requests/export", "_blank")}>
              <Download className="h-4 w-4 me-1.5" />{t("requests.export")}
            </Button>
            {canCreate && (
              <>
                <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => void handleImportFile(e)} />
                <Button variant="outline" onClick={handleImportClick} disabled={importing}>
                  <Upload className="h-4 w-4 me-1.5" />{t("requests.import")}
                </Button>
              </>
            )}
            {canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("requests.new")}</Button>}
          </>
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
        emptyTitle={t("requests.empty.title")}
        emptySubtitle={t("requests.empty.subtitle")}
        emptyAction={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("requests.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) {
            // Reset all form state when the dialog closes — avoids stale
            // trainees/docs leaking into the next "New" click.
            setFormData({ priority: "NORMAL", traineeCount: 1, preferredLanguage: "en", status: "DRAFT" });
            setTrainees([]);
            setAdditionalDocs([]);
          }
        }}
        title={editTarget ? t("requests.edit") || "Edit Request" : t("requests.new")}
        description={t("requests.subtitle")}
        icon={ClipboardList}
        size="3xl"
        onSubmit={editTarget ? handleEditSave : handleSubmit}
        isSubmitting={submitting}
        allowFullscreen
        footerExtra={
          <div className="text-xs text-muted-foreground">
            {trainees.length > 0 ? (
              <span className="inline-flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                {trainees.filter((tr) => tr.fullName && tr.nationalId).length} / {trainees.length}{" "}
                {t("requests.traineeCount")}
              </span>
            ) : null}
          </div>
        }
      >
        <div className="space-y-5">
          {/* Status selector: Draft or Submit immediately */}
          <Field label={t("requests.status")}>
            <Select value={(formData.status as string) ?? "DRAFT"} onValueChange={(v) => setField("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="DRAFT">{t("status.DRAFT")}</SelectItem>
                <SelectItem value="SUBMITTED">{t("status.SUBMITTED")}</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <FormGrid>
            {user?.role !== "CONTRACTOR" && (
              <Field label={t("requests.company")} required>
                <Select onValueChange={(v) => setField("companyId", v)}>
                  <SelectTrigger><SelectValue placeholder={t("requests.company")} /></SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.refNumber})</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label={t("requests.course")} required>
              <Select onValueChange={(v) => setField("courseId", v)}>
                <SelectTrigger><SelectValue placeholder={t("requests.course")} /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.title} ({c.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("requests.priority")}>
              <Select value={formData.priority as string} onValueChange={(v) => setField("priority", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{t(`priority.${p}` as never)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("requests.preferredDateFrom")}>
              <Input type="date" value={(formData.preferredDateFrom as string) ?? ""} onChange={(e) => setField("preferredDateFrom", e.target.value)} />
            </Field>
            <Field label={t("requests.preferredDateTo")}>
              <Input type="date" value={(formData.preferredDateTo as string) ?? ""} onChange={(e) => setField("preferredDateTo", e.target.value)} />
            </Field>
            <Field label={t("requests.preferredLocation")}>
              <Input placeholder={t("requests.preferredLocation")} value={(formData.preferredLocation as string) ?? ""} onChange={(e) => setField("preferredLocation", e.target.value)} />
            </Field>
            <Field label={t("requests.preferredLanguage")}>
              <Select value={formData.preferredLanguage as string} onValueChange={(v) => setField("preferredLanguage", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                  <SelectItem value="bilingual">Bilingual</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FormGrid>

          <Field label={t("requests.notes")}>
            <Textarea rows={2} placeholder={t("requests.notes")} value={(formData.notes as string) ?? ""} onChange={(e) => setField("notes", e.target.value)} />
          </Field>

          {/* ── Trainee Entry (3 methods: Manual / Copy-Paste / Excel) ── */}
          {/* The TraineeEntrySection is self-contained: it owns its own tabs,
              validation, full-screen mode, virtualization, etc. We only need
              to pass the trainees array + onChange callback. */}
          <div className="pt-2 border-t">
            <TraineeEntrySection
              trainees={trainees}
              onChange={setTrainees}
            />
          </div>

          {/* ── Additional Documents (request-level, any files) ── */}
          <div className="pt-2 border-t">
            <AdditionalDocumentsSection
              value={additionalDocs}
              onChange={setAdditionalDocs}
              hint={
                t("requests.additionalDocs.hint") ||
                "Upload any supporting documents: medical certificate, vaccination, work permit, company letter, qualification, driving license, experience certificate, any PDF or image."
              }
            />
          </div>
        </div>
      </FormDialog>

      <GenerateSessionsDialog
        requestId={generateTarget?.id ?? null}
        open={generateTarget !== null}
        onOpenChange={(open) => { if (!open) setGenerateTarget(null); }}
        onGenerated={() => { setGenerateTarget(null); refetch(); }}
      />

      {/* Reject dialog */}
      <FormDialog
        open={rejectDialogOpen}
        onOpenChange={setRejectDialogOpen}
        title={t("workflow.reject")}
        icon={FileText}
        size="sm"
        onSubmit={handleRejectSubmit}
        isSubmitting={submitting}
      >
        <Field label={t("requests.rejectionReason")} required>
          <Textarea
            rows={4}
            placeholder={t("requests.rejectionReason")}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
          />
        </Field>
        {rejectTarget && (
          <div className="mt-3 text-xs text-muted-foreground">
            <span>{t("requests.requestNumber")}: </span>
            <span className="font-mono font-semibold text-primary">{rejectTarget.refNumber}</span>
          </div>
        )}
      </FormDialog>

      {/* Revision dialog — coordinator returns request for modification */}
      <FormDialog
        open={revisionDialogOpen}
        onOpenChange={(o) => { setRevisionDialogOpen(o); if (!o) { setRevisionTarget(null); setRevisionReason(""); } }}
        title={t("workflow.returnRevision") || "Return for Revision"}
        icon={RotateCcw}
        size="sm"
        onSubmit={handleRevisionSubmit}
        isSubmitting={submitting}
      >
        <Field label={t("requests.revisionReason") || "Reason for revision"} required>
          <Textarea
            rows={4}
            placeholder={t("requests.revisionReasonPlaceholder") || "Explain what the contractor needs to modify..."}
            value={revisionReason}
            onChange={(e) => setRevisionReason(e.target.value)}
          />
        </Field>
        {revisionTarget && (
          <div className="mt-3 text-xs text-muted-foreground">
            <span>{t("requests.requestNumber")}: </span>
            <span className="font-mono font-semibold text-primary">{revisionTarget.refNumber}</span>
          </div>
        )}
      </FormDialog>

      {/* Read-only details dialog — reached from rows with no remaining workflow actions */}
      <FormDialog
        open={detailsTarget !== null}
        onOpenChange={(open) => { if (!open) setDetailsTarget(null); }}
        title={t("requests.details")}
        description={t("requests.detailsSubtitle")}
        icon={ClipboardList}
        size="lg"
      >
        {detailsTarget && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="font-mono text-sm font-semibold text-primary">{detailsTarget.refNumber}</div>
              <div className="flex items-center gap-2">
                <PriorityBadge priority={detailsTarget.priority} />
                <StatusBadge status={detailsTarget.status} />
              </div>
            </div>

            <FormGrid>
              <DetailRow label={t("requests.company")} value={detailsTarget.companyName} />
              <DetailRow label={t("requests.course")} value={detailsTarget.courseTitle} />
              <DetailRow label={t("requests.traineeCount")} value={detailsTarget.traineeCount} />
              <DetailRow label={t("requests.preferredLocation")} value={detailsTarget.preferredLocation} />
              <DetailRow label={t("requests.preferredDateFrom")} value={fmtDate(detailsTarget.preferredDateFrom)} />
              <DetailRow label={t("requests.preferredDateTo")} value={fmtDate(detailsTarget.preferredDateTo)} />
              <DetailRow label={t("requests.preferredLanguage")} value={detailsTarget.preferredLanguage} />
            </FormGrid>

            {detailsTarget.notes && <DetailRow label={t("requests.notes")} value={detailsTarget.notes} />}

            {detailsTarget.rejectionReason && (
              <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                <div className="text-xs font-medium text-destructive flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" /> {t("requests.rejectionReason")}
                </div>
                <div className="text-xs mt-1">{detailsTarget.rejectionReason}</div>
              </div>
            )}

            <div>
              <div className="text-xs font-semibold mb-2">{t("requests.timeline")}</div>
              <div className="rounded-md border px-3">
                {([
                  ["requests.createdAt", detailsTarget.createdAt],
                  ["requests.submittedAt", detailsTarget.submittedAt],
                  ["requests.reviewedAt", detailsTarget.reviewedAt],
                  ["requests.approvedAt", detailsTarget.approvedAt],
                  ["requests.scheduledAt", detailsTarget.scheduledAt],
                  ["requests.startedAt", detailsTarget.startedAt],
                  ["requests.completedAt", detailsTarget.completedAt],
                  ["requests.rejectedAt", detailsTarget.rejectedAt],
                ] as const)
                  .filter(([, at]) => Boolean(at))
                  .map(([labelKey, at]) => (
                    <div key={labelKey} className="flex items-center justify-between gap-3 py-2 border-b last:border-b-0">
                      <span className="text-xs text-muted-foreground">{t(labelKey)}</span>
                      <span className="text-xs font-medium">{new Date(at as string).toLocaleString()}</span>
                    </div>
                  ))}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">{t("requests.noFurtherActions")}</p>
          </div>
        )}
      </FormDialog>

      {/* ── Preview Dialog (read-only) — shows all request details ── */}
      <FormDialog
        open={previewTarget !== null}
        onOpenChange={(open) => { if (!open) setPreviewTarget(null); }}
        title={t("action.preview") || "Preview"}
        description={previewTarget?.refNumber}
        icon={Eye}
        size="xl"
      >
        {previewTarget && (
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="font-mono text-sm font-semibold text-primary">{previewTarget.refNumber}</div>
              <div className="flex items-center gap-2">
                <PriorityBadge priority={previewTarget.priority} />
                <StatusBadge status={previewTarget.status} />
              </div>
            </div>

            <FormGrid>
              <DetailRow label={t("requests.company")} value={previewTarget.companyName} />
              <DetailRow label={t("requests.course")} value={previewTarget.courseTitle} />
              <DetailRow label={t("requests.traineeCount")} value={String(previewTarget.traineeCount)} />
              <DetailRow label={t("requests.priority")} value={previewTarget.priority} />
              <DetailRow label={t("requests.preferredLocation")} value={previewTarget.preferredLocation} />
              <DetailRow label={t("requests.preferredDateFrom")} value={fmtDate(previewTarget.preferredDateFrom)} />
              <DetailRow label={t("requests.preferredDateTo")} value={fmtDate(previewTarget.preferredDateTo)} />
              <DetailRow label={t("requests.preferredLanguage")} value={previewTarget.preferredLanguage} />
            </FormGrid>

            {previewTarget.notes && <DetailRow label={t("requests.notes")} value={previewTarget.notes} />}

            {previewTarget.rejectionReason && (
              <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                <div className="text-xs font-medium text-destructive flex items-center gap-1.5">
                  <AlertCircle className="h-3.5 w-3.5" /> {t("requests.rejectionReason")}
                </div>
                <div className="text-xs mt-1">{previewTarget.rejectionReason}</div>
              </div>
            )}

            <div>
              <div className="text-xs font-semibold mb-2">{t("requests.timeline")}</div>
              <div className="rounded-md border px-3">
                {([
                  ["requests.createdAt", previewTarget.createdAt],
                  ["requests.submittedAt", previewTarget.submittedAt],
                  ["requests.reviewedAt", previewTarget.reviewedAt],
                  ["requests.approvedAt", previewTarget.approvedAt],
                  ["requests.scheduledAt", previewTarget.scheduledAt],
                  ["requests.startedAt", previewTarget.startedAt],
                  ["requests.completedAt", previewTarget.completedAt],
                  ["requests.rejectedAt", previewTarget.rejectedAt],
                ] as const).filter(([, v]) => v).map(([label, value]) => (
                  <div key={label} className="flex justify-between items-center py-1.5 border-b last:border-b-0 text-xs">
                    <span className="text-muted-foreground">{t(label as never)}</span>
                    <span className="font-mono">{fmtDateTime(value)}</span>
                  </div>
                ))}
              </div>
            </div>

            {previewTarget.status === "DRAFT" || previewTarget.status === "SUBMITTED" ? (
              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button variant="outline" onClick={() => setPreviewTarget(null)}>
                  {t("action.cancel")}
                </Button>
                {canCreate && (
                  <Button onClick={() => { const r = previewTarget; setPreviewTarget(null); handleEditRequest(r); }}>
                    <Pencil className="h-4 w-4 me-1.5" />{t("action.edit") || "Edit"}
                  </Button>
                )}
              </div>
            ) : null}
          </div>
        )}
      </FormDialog>
    </div>
  );
}

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : null;
}

function fmtDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : null;
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm break-words">{value === null || value === undefined || value === "" ? "—" : value}</div>
    </div>
  );
}
