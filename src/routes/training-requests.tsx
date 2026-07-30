"use client";

import { useState, useEffect, useRef, useState as useReactState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { GenerateSessionsDialog } from "@/components/common/generate-sessions-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, PriorityBadge } from "@/components/common/status-badge";
import { ClipboardList, Plus, Building2, BookOpen, Users, Calendar, AlertCircle, Check, X, RotateCcw, ArrowRight, FileText, Download, Upload, FileSpreadsheet, AlertTriangle, UserCheck, Copy } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";
import { TraineeEntrySection, type TraineeEntry } from "@/components/common/trainee-entry-section";

interface RequestImportResult {
  requestsCreated: number;
  traineesLinked: number;
  errors: { row: number; message: string }[];
}

interface ImportPreviewRow {
  rowNumber: number;
  name: string;
  nationalId: string;
  nationality: string | null;
  jobTitle: string | null;
  companyName: string;
  courseTitle: string;
  phone: string | null;
  email: string | null;
  valid: boolean;
  errors: string[];
}

interface ImportPreview {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateNationalIds: { nationalId: string; rows: number[] }[];
  rows: ImportPreviewRow[];
  missingRequiredColumns: { field: string; canonicalAlias: string }[];
  matchedColumns: { field: string; header: string }[];
  unmatchedHeaders: string[];
  traineeCount: number;
}

interface CompanyOption { id: string; name: string; refNumber: string; }
interface CourseOption { id: string; title: string; code: string; refNumber: string; }
interface Request {
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

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

// Transitions a requester may perform on their own request without `requests.edit`.
// Mirrors SELF_SERVICE_TRANSITIONS in /api/requests/[id]/transition.
const SELF_SERVICE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["CANCELLED"],
  REJECTED: ["SUBMITTED"],
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
    { status: "REJECTED", labelKey: "workflow.reject", variant: "ghost", tone: "destructive" },
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
  const [detailsTarget, setDetailsTarget] = useState<Request | null>(null);
  const [generateTarget, setGenerateTarget] = useState<Request | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>({
    priority: "NORMAL",
    traineeCount: 1,
    preferredLanguage: "en",
    status: "DRAFT",
  });
  const [companies, setCompanies] = useReactState<CompanyOption[]>([]);
  const [courses, setCourses] = useReactState<CourseOption[]>([]);
  const [importing, setImporting] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<ImportPreview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [trainees, setTrainees] = useState<TraineeEntry[]>([]);
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

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    // V2: Call preview endpoint first to validate + show preview before saving
    setPendingFile(file);
    setPreviewLoading(true);
    try {
      const result = await api.postFile<ImportPreview>("/requests/import/preview", file);
      setPreviewData(result);
      setPreviewOpen(true);
    } catch (err) {
      toast({ title: t("misc.error"), description: (err as Error).message, variant: "destructive" });
      setPendingFile(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmImport = async () => {
    if (!pendingFile) return;
    setImporting(true);
    try {
      const result = await api.postFile<RequestImportResult>("/requests/import", pendingFile);
      toast({
        title: t("misc.success"),
        description: t("requests.import.success", {
          requests: result.requestsCreated,
          trainees: result.traineesLinked,
        }),
        variant: result.errors.length > 0 ? "destructive" : "default",
      });
      setPreviewOpen(false);
      setPreviewData(null);
      setPendingFile(null);
      refetch();
    } catch (err) {
      toast({ title: t("misc.error"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const handleCancelPreview = () => {
    setPreviewOpen(false);
    setPreviewData(null);
    setPendingFile(null);
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
        if (actions.length === 0) {
          return (
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setDetailsTarget(r)}>
              {t("action.details")}
            </Button>
          );
        }
        return (
          <div className="flex justify-end gap-1 flex-wrap">
            {actions.map((a) => (
              <Button
                key={a.status}
                variant={a.variant}
                size="sm"
                className={`h-8 ${a.tone === "success" ? "text-success" : a.tone === "destructive" ? "text-destructive" : a.tone === "info" ? "text-info" : ""}`}
                onClick={() => handleTransition(r, a.status)}
                // Offer only transitions the caller can actually complete: everything
                // if they hold requests.edit, otherwise just their own submit/cancel.
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
      toast({ title: t("misc.error"), description: "Course is required", variant: "destructive" });
      return;
    }
    // Validate trainees — require at least 1 valid trainee
    const validTrainees = trainees.filter((t) => t.valid);
    if (validTrainees.length === 0) {
      toast({ title: t("misc.error"), description: "At least 1 valid trainee is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // Auto-calculate traineeCount from valid trainees
      const payload = {
        ...formData,
        traineeCount: validTrainees.length,
        trainees: validTrainees.map((t) => ({
          fullName: t.fullName,
          nationalId: t.nationalId,
          nationality: t.nationality || null,
          jobTitle: t.jobTitle || null,
          idAttachmentUrl: t.idAttachmentUrl,
        })),
      };
      await api.post("/requests", payload);
      toast({ title: t("misc.success"), description: t("misc.createSuccess") });
      setDialogOpen(false);
      setFormData({ priority: "NORMAL", traineeCount: 1, preferredLanguage: "en", status: "DRAFT" });
      setTrainees([]);
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const setField = (k: string, v: unknown) => setFormData((p) => ({ ...p, [k]: v }));

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
                <Button variant="outline" onClick={handleImportClick} disabled={importing || previewLoading}>
                  {previewLoading ? <FileSpreadsheet className="h-4 w-4 me-1.5 animate-pulse" /> : <Upload className="h-4 w-4 me-1.5" />}
                  {previewLoading ? (t("requests.import.previewing") || "Previewing...") : t("requests.import")}
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
        onOpenChange={setDialogOpen}
        title={t("requests.new")}
        description={t("requests.subtitle")}
        icon={ClipboardList}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
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
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.refNumber})</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
            <Field label={t("requests.course")} required>
              <Select onValueChange={(v) => setField("courseId", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.title} ({c.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            {/* Trainee count is now auto-calculated from the TraineeEntrySection below */}
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
              <Input placeholder="Riyadh / On-site / Virtual" value={(formData.preferredLocation as string) ?? ""} onChange={(e) => setField("preferredLocation", e.target.value)} />
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

          {/* Trainee Entry Section — 3 methods: Excel Import / Manual Entry / Copy & Paste */}
          <div className="border-t pt-4">
            <div className="text-sm font-medium mb-3">
              {t("requests.trainees") || "Trainees"}
              <span className="ms-2 text-xs text-muted-foreground">
                ({trainees.filter((tr) => tr.valid).length} valid / {trainees.length} total)
              </span>
            </div>
            <TraineeEntrySection
              trainees={trainees}
              onChange={setTrainees}
              companyId={formData.companyId as string | undefined}
            />
          </div>

          <Field label={t("requests.notes")}>
            <Textarea rows={3} placeholder={t("requests.notes")} value={(formData.notes as string) ?? ""} onChange={(e) => setField("notes", e.target.value)} />
          </Field>
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

      {/* V2: Import Preview Dialog — shows validation results before saving */}
      {previewOpen && previewData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-background border rounded-lg shadow-lg max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
            {/* Header */}
            <div className="border-b p-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold">
                  {t("requests.import.preview") || "Import Preview"}
                </h2>
              </div>
              <Button variant="ghost" size="sm" onClick={handleCancelPreview}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Summary stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="border rounded-md p-3">
                  <div className="text-xs text-muted-foreground">{t("requests.import.totalRows") || "Total Rows"}</div>
                  <div className="text-2xl font-bold">{previewData.totalRows}</div>
                </div>
                <div className="border rounded-md p-3 border-green-500/30 bg-green-500/5">
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><UserCheck className="h-3 w-3" /> {t("requests.import.validRows") || "Valid"}</div>
                  <div className="text-2xl font-bold text-green-600">{previewData.validRows}</div>
                </div>
                <div className="border rounded-md p-3 border-red-500/30 bg-red-500/5">
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3" /> {t("requests.import.invalidRows") || "Invalid"}</div>
                  <div className="text-2xl font-bold text-red-600">{previewData.invalidRows}</div>
                </div>
                <div className="border rounded-md p-3 border-blue-500/30 bg-blue-500/5">
                  <div className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> {t("requests.import.traineeCount") || "Trainees"}</div>
                  <div className="text-2xl font-bold text-blue-600">{previewData.traineeCount}</div>
                </div>
              </div>

              {/* Missing required columns */}
              {previewData.missingRequiredColumns.length > 0 && (
                <div className="border border-red-500/30 bg-red-500/5 rounded-md p-3">
                  <div className="flex items-center gap-2 text-red-700 font-medium text-sm mb-2">
                    <AlertCircle className="h-4 w-4" />
                    {t("requests.import.missingColumns") || "Missing required columns"}
                  </div>
                  <ul className="text-xs space-y-1">
                    {previewData.missingRequiredColumns.map((m, i) => (
                      <li key={i} className="text-red-700">
                        • <strong>{m.field}</strong> — {t("requests.import.acceptedAlias") || "accepted header"}: <code className="bg-red-500/10 px-1 rounded">{m.canonicalAlias}</code>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Duplicate national IDs */}
              {previewData.duplicateNationalIds.length > 0 && (
                <div className="border border-orange-500/30 bg-orange-500/5 rounded-md p-3">
                  <div className="flex items-center gap-2 text-orange-700 font-medium text-sm mb-2">
                    <Copy className="h-4 w-4" />
                    {t("requests.import.duplicateIds") || "Duplicate National IDs"}
                  </div>
                  <ul className="text-xs space-y-1 max-h-32 overflow-y-auto">
                    {previewData.duplicateNationalIds.map((d, i) => (
                      <li key={i} className="text-orange-700">
                        • <code className="bg-orange-500/10 px-1 rounded">{d.nationalId}</code> — {t("requests.import.rows") || "rows"}: {d.rows.join(", ")}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Matched columns */}
              {previewData.matchedColumns.length > 0 && (
                <div className="border rounded-md p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2">{t("requests.import.matchedColumns") || "Matched columns"}</div>
                  <div className="flex flex-wrap gap-2">
                    {previewData.matchedColumns.map((c, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-xs bg-green-500/10 text-green-700 border border-green-500/20 rounded px-2 py-0.5">
                        <Check className="h-3 w-3" />
                        {c.field}: <code className="bg-green-500/10 px-1 rounded">{c.header}</code>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Unmatched headers */}
              {previewData.unmatchedHeaders.length > 0 && (
                <div className="border rounded-md p-3">
                  <div className="text-xs font-medium text-muted-foreground mb-2">{t("requests.import.unmatchedHeaders") || "Unmatched headers (ignored)"}</div>
                  <div className="flex flex-wrap gap-2">
                    {previewData.unmatchedHeaders.map((h, i) => (
                      <span key={i} className="inline-flex items-center gap-1 text-xs bg-muted text-muted-foreground border rounded px-2 py-0.5">
                        {h}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Row preview table */}
              {previewData.rows.length > 0 && (
                <div className="border rounded-md overflow-hidden">
                  <div className="bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
                    {t("requests.import.rowPreview") || "Row preview (first 20 rows)"}
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/30 sticky top-0">
                        <tr>
                          <th className="text-start p-2 font-medium">Row</th>
                          <th className="text-start p-2 font-medium">{t("requests.traineeName") || "Name"}</th>
                          <th className="text-start p-2 font-medium">{t("requests.nationalId") || "National ID"}</th>
                          <th className="text-start p-2 font-medium">{t("requests.company") || "Company"}</th>
                          <th className="text-start p-2 font-medium">{t("requests.course") || "Course"}</th>
                          <th className="text-start p-2 font-medium">{t("requests.import.status") || "Status"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {previewData.rows.slice(0, 20).map((r) => (
                          <tr key={r.rowNumber} className="border-t">
                            <td className="p-2 text-muted-foreground">{r.rowNumber}</td>
                            <td className="p-2">{r.name || <span className="text-red-500">—</span>}</td>
                            <td className="p-2 font-mono">{r.nationalId || <span className="text-red-500">—</span>}</td>
                            <td className="p-2">{r.companyName || <span className="text-red-500">—</span>}</td>
                            <td className="p-2">{r.courseTitle || <span className="text-red-500">—</span>}</td>
                            <td className="p-2">
                              {r.valid ? (
                                <span className="inline-flex items-center gap-1 text-green-600"><Check className="h-3 w-3" /> OK</span>
                              ) : (
                                <span className="text-red-600" title={r.errors.join("; ")}>{r.errors[0]}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {previewData.rows.length > 20 && (
                    <div className="px-3 py-1 text-xs text-muted-foreground border-t">
                      + {previewData.rows.length - 20} more rows...
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t p-4 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                {pendingFile && <span className="font-mono">{pendingFile.name}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" onClick={handleCancelPreview} disabled={importing}>
                  {t("misc.cancel") || "Cancel"}
                </Button>
                <Button
                  onClick={handleConfirmImport}
                  disabled={importing || previewData.validRows === 0 || previewData.missingRequiredColumns.length > 0}
                >
                  {importing ? (
                    <><FileSpreadsheet className="h-4 w-4 me-1.5 animate-pulse" /> {t("requests.import.importing") || "Importing..."}</>
                  ) : (
                    <><Upload className="h-4 w-4 me-1.5" /> {t("requests.import.confirm") || "Confirm Import"} ({previewData.validRows} {t("requests.import.trainees") || "trainees"})</>
                  )}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : null;
}

function DetailRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm break-words">{value === null || value === undefined || value === "" ? "—" : value}</div>
    </div>
  );
}
