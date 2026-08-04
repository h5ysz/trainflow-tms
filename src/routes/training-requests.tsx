"use client";

import { useState, useEffect, useRef, useState as useReactState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { GenerateSessionsDialog } from "@/components/common/generate-sessions-dialog";
import { TraineeEntrySection, type TraineeEntry, normalizeIdAttachmentIntoDocuments } from "@/components/common/trainee-entry-section";
import {
  AdditionalDocumentsSection,
  type AdditionalDocument,
} from "@/components/common/additional-documents-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, PriorityBadge } from "@/components/common/status-badge";
import { ClipboardList, Plus, Building2, BookOpen, Users, Calendar, AlertCircle, Check, X, RotateCcw, ArrowRight, FileText, Download, Upload, Eye, Pencil, Printer, MoreVertical, FileSpreadsheet, FileText as FileTextIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerClose } from "@/components/ui/drawer";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { Loader2 } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";
import { ImportDialog, ExportDialog } from "@/components/common/import-export-dialogs";

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

// ── Detailed request (returned by GET /api/requests/[id]) ──
// Includes the full course object + requestCourses.trainees + sessions.
interface RequestTrainee {
  id: string;
  refNumber?: string;
  fullName: string;
  nationalId: string;
  nationality?: string | null;
  jobTitle?: string | null;
  mobile?: string | null;
  email?: string | null;
  idAttachmentUrl?: string | null;
  documents?: string | null; // JSON-encoded array of { url, filename, type, uploadedAt }
}
interface RequestCourseDetail {
  id: string;
  courseId: string;
  traineeCount: number;
  course: { id: string; title: string; code?: string; refNumber?: string; titleAr?: string | null };
  trainees: Array<{ trainee: RequestTrainee }>;
}
interface RequestDetail extends Request {
  company?: { id: string; name: string; refNumber?: string; nameAr?: string | null };
  course?: { id: string; title: string; code?: string; refNumber?: string; titleAr?: string | null; durationHours?: number };
  requestCourses?: RequestCourseDetail[];
  sessions?: Array<{ id: string; refNumber: string; title: string; startDate: string; endDate: string; status: string }>;
  documents?: string | null; // request-level documents (JSON array)
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

// Workflow transition matrix (mirror of backend).
// Maps each status → the array of action buttons that can transition out of it.
// NOTE: this is the SUPERSET of all transitions across all roles. The per-role
// filter (getActionsForRole) below narrows this list down based on RBAC.
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

// Per-role action filter — narrows NEXT_ACTIONS based on what the user's role
// is allowed to do. This is the single source of truth for "which action
// buttons does this user see on a request in status X?".
//
// CONTRACTOR (self-service only):
//   - DRAFT                  → Submit, Cancel
//   - SUBMITTED              → Cancel
//   - REQUIRES_MODIFICATION  → Resubmit, Cancel
//   - REJECTED               → Resubmit
//   - Under Review / Approved / Scheduled / In Progress / Completed / Cancelled → no actions
//
// COORDINATOR / TRAINER / SUPER_ADMIN / COMPANY_ADMIN (full workflow control):
//   - See ALL transitions from NEXT_ACTIONS (no filtering)
//
// AUDITOR / VIEWER (read-only):
//   - No action buttons at all
// Self-service transitions a contractor (or any role without `requests.edit`)
// may perform on their own request. Mirrors SELF_SERVICE_TRANSITIONS in
// /api/requests/[id]/transition and /api/requests/[id] PUT handler.
//
// Keyed by CURRENT status → array of ALLOWED target statuses.
const SELF_SERVICE_TRANSITIONS_BY_STATUS: Record<string, Set<string>> = {
  DRAFT: new Set(["SUBMITTED", "CANCELLED"]),
  // SUBMITTED: no self-service actions — request is in coordinator's hands
  REJECTED: new Set(["SUBMITTED"]),
  REQUIRES_MODIFICATION: new Set(["SUBMITTED"]),
};

function getActionsForRole(
  status: string,
  role: string | undefined,
  hasEdit: boolean,
): typeof NEXT_ACTIONS[string] {
  const all = NEXT_ACTIONS[status] ?? [];
  // Read-only viewers see no action buttons
  if (!role) return [];
  if (role === "AUDITOR" || role === "VIEWER") return [];
  // Roles with `requests.edit` see the full workflow
  if (hasEdit) return all;
  // Contractors (and any other role without `requests.edit`) see only
  // self-service actions that are valid from the CURRENT status.
  // E.g. a contractor can Cancel from DRAFT/SUBMITTED/REQUIRES_MODIFICATION
  // but NOT from UNDER_REVIEW/APPROVED/SCHEDULED/IN_PROGRESS — those are
  // reviewer-controlled statuses where the contractor's request is locked.
  const allowed = SELF_SERVICE_TRANSITIONS_BY_STATUS[status];
  if (!allowed) return []; // No self-service actions from this status
  return all.filter((a) => allowed.has(a.status));
}

export function TrainingRequestsRoute() {
  const { t, locale } = useI18n();
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
  const [previewDetail, setPreviewDetail] = useState<RequestDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [editTarget, setEditTarget] = useState<Request | null>(null);
  const [generateTarget, setGenerateTarget] = useState<Request | null>(null);

  // ── Coordinator-only: row selection + bulk actions + drawer ──
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [drawerTarget, setDrawerTarget] = useState<Request | null>(null);
  const [drawerDetail, setDrawerDetail] = useState<RequestDetail | null>(null);
  const [drawerLoading, setDrawerLoading] = useState(false);

  // isCoordinator is defined after canEdit/canCreate below
  // (see const isCoordinator = canEdit; after the hook calls)

  function toggleSelect(id: string) {
    // Only ONE request can be selected at a time — clicking a new row
    // replaces the previous selection.
    setSelectedIds((prev) => {
      if (prev.has(id)) return new Set(); // toggle off
      return new Set([id]); // select only this one
    });
  }
  function clearSelection() {
    setSelectedIds(new Set());
  }

  // selectedRequest and directExport are defined after the hooks below
  // (they need access to `data` and `locale`)

  // Open the right-side drawer for coordinator view
  const openDrawer = async (req: Request) => {
    setDrawerTarget(req);
    setDrawerDetail(null);
    setDrawerLoading(true);
    try {
      const detail = await api.get<RequestDetail>(`/requests/${req.id}`);
      setDrawerDetail(detail);
    } catch {
      // Fall back to row data
    } finally {
      setDrawerLoading(false);
    }
  };
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
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Request>("/requests");

  const canCreate = user ? canPerformAction(user.permissions, "requests", "create") : false;
  const canEdit = user ? canPerformAction(user.permissions, "requests", "edit") : false;
  const isCoordinator = canEdit; // roles with requests.edit (coordinator/admin/trainer)

  // Get the currently selected request object (single selection only)
  const selectedRequest = data?.find((r) => selectedIds.has(r.id)) || null;

  // Direct export — no dialog, immediately opens the export URL
  function directExport(fmt: "excel" | "pdf" | "zip") {
    if (!selectedRequest) return;
    const params = new URLSearchParams({
      scope: "specific_request",
      specificId: selectedRequest.id,
      items: "requests,trainees,attendance,results,evaluations,certificates,invoices,attachments",
      format: fmt,
      locale,
    });
    window.open(`/api/export/company-data?${params.toString()}`, "_blank");
  }

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

  const handleImportClick = () => setImportDialogOpen(true);

  const handleImportFile = async (file: File) => {
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
    // ── Coordinator-only: checkbox column ──
    ...(isCoordinator ? [{
      key: "select",
      header: "",
      headerClassName: "w-10",
      className: "w-10",
      cell: (r: Request) => (
        <Checkbox
          checked={selectedIds.has(r.id)}
          onCheckedChange={() => toggleSelect(r.id)}
          aria-label={`Select ${r.refNumber}`}
        />
      ),
    }] : []),
    {
      key: "id",
      header: t("requests.requestNumber"),
      cell: (r) => (
        <button
          className="font-mono text-xs font-semibold text-primary hover:underline"
          onClick={() => isCoordinator ? openDrawer(r) : openPreview(r)}
        >
          {r.refNumber}
        </button>
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
      key: "submittedAt",
      header: t("requests.submittedAt" as never) || "Received",
      cell: (r) => (
        <div className="text-xs flex items-center gap-1.5">
          <Calendar className="h-3 w-3 text-info" />
          {r.submittedAt ? (
            <div>
              <div className="font-medium">{new Date(r.submittedAt).toLocaleDateString()}</div>
              <div className="text-[10px] text-muted-foreground">{new Date(r.submittedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            </div>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
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
        // Per-role RBAC: contractors see only self-service buttons (submit /
        // resubmit / cancel). Coordinators/Trainers/Super Admins see the full
        // workflow. Auditors/Viewers see nothing.
        const actions = getActionsForRole(r.status, user?.role, canEdit);
        // ── Read-Only Tracking View policy ──────────────────────────────────
        // After the contractor submits a request, they enter a READ-ONLY tracking
        // state. They can still see the request + preview details + print/export,
        // but they CANNOT edit anything until the coordinator returns the request
        // for revision (REQUIRES_MODIFICATION).
        //
        // Editable statuses for contractors (with requests.create):
        //   - DRAFT                     → contractor is still preparing the request
        //   - REQUIRES_MODIFICATION     → coordinator returned it for revision
        //
        // Read-only tracking statuses (NO edit button for contractors):
        //   - SUBMITTED, UNDER_REVIEW, APPROVED, SCHEDULED, IN_PROGRESS,
        //     COMPLETED, CANCELLED, REJECTED
        //
        // REJECTED is intentionally read-only: the contractor must raise a NEW
        // request (the rejected one is closed). If the business rule changes to
        // allow resubmission from REJECTED, add REJECTED to this list.
        const contractorEditableStatuses = ["DRAFT", "REQUIRES_MODIFICATION"];
        const canEditRequest = canCreate && (
          // Contractors (and any role without requests.edit): only DRAFT + REQUIRES_MODIFICATION
          !canEdit ? contractorEditableStatuses.includes(r.status)
          // Coordinators/admins (with requests.edit): can edit DRAFT + REQUIRES_MODIFICATION + REJECTED
          : ["DRAFT", "REQUIRES_MODIFICATION", "REJECTED"].includes(r.status)
        );
        return (
          <div className="flex justify-end items-center gap-1 flex-wrap">
            {/* View button — coordinator uses drawer, contractor uses preview dialog */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => isCoordinator ? openDrawer(r) : openPreview(r)}
              title={t("action.preview") || "View"}
            >
              <Eye className="h-3.5 w-3.5" />
            </Button>

            {isCoordinator ? (
              <>
                {/* ── Coordinator simplified actions ── */}
                {/* SUBMITTED: Start Review */}
                {r.status === "SUBMITTED" && (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-8 text-white"
                    onClick={() => handleTransition(r, "UNDER_REVIEW")}
                  >
                    {t("workflow.review" as never) || "Start Review"}
                  </Button>
                )}
                {/* UNDER_REVIEW: Approve + More menu */}
                {r.status === "UNDER_REVIEW" && (
                  <>
                    <Button
                      variant="default"
                      size="sm"
                      className="h-8 text-white"
                      onClick={() => handleTransition(r, "APPROVED")}
                    >
                      <Check className="h-3.5 w-3.5 me-1" />{t("workflow.approve" as never) || "Approve"}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreVertical className="h-3.5 w-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => { setRevisionTarget(r); setRevisionDialogOpen(true); }}>
                          <RotateCcw className="h-3.5 w-3.5 me-2" />
                          {t("workflow.returnRevision" as never) || "Return for Modification"}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setRejectTarget(r); setRejectDialogOpen(true); }}>
                          <X className="h-3.5 w-3.5 me-2" />
                          {t("workflow.reject" as never) || "Reject"}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={() => handleTransition(r, "CANCELLED")}>
                          <X className="h-3.5 w-3.5 me-2" />
                          {t("workflow.cancel" as never) || "Cancel"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </>
                )}
                {/* Other statuses with workflow actions (APPROVED, SCHEDULED, etc.) */}
                {r.status !== "SUBMITTED" && r.status !== "UNDER_REVIEW" && actions.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {actions.map((a) => (
                        <DropdownMenuItem key={a.status} onClick={() => handleTransition(r, a.status)}>
                          {a.status === "APPROVED" && <Check className="h-3.5 w-3.5 me-2" />}
                          {a.status === "REJECTED" && <X className="h-3.5 w-3.5 me-2" />}
                          {t(a.labelKey as never)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            ) : (
              <>
                {/* ── Contractor / other roles: original actions ── */}
                {canEditRequest && (
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
                  >
                    {a.status === "SUBMITTED" && r.status === "REJECTED" && <RotateCcw className="h-3.5 w-3.5 me-1" />}
                    {a.status === "APPROVED" && <Check className="h-3.5 w-3.5 me-1" />}
                    {a.status === "REJECTED" && <X className="h-3.5 w-3.5 me-1" />}
                    {t(a.labelKey as never)}
                  </Button>
                ))}
              </>
            )}
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
      //
      // Phase 1: documents[] is the single source of truth. We do NOT send
      // `idAttachmentUrl` — the server-side handler folds any legacy value
      // into documents[] if needed, but new uploads always arrive in
      // documents[] directly from the client.
      const payloadTrainees = trainees
        .filter((tr) => tr.fullName && tr.nationalId)
        .map((tr) => ({
          fullName: tr.fullName,
          nationalId: tr.nationalId,
          nationality: tr.nationality || null,
          jobTitle: tr.jobTitle || null,
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

  // ── Read-Only Tracking View policy (component-level) ──
  // Used by the Preview dialog's Edit button to decide whether to show Edit.
  // Mirrors the per-row canEditRequest logic in the actions cell.
  const isPreviewEditable = previewTarget ? (
    canCreate && (
      !canEdit
        ? ["DRAFT", "REQUIRES_MODIFICATION"].includes(previewTarget.status)
        : ["DRAFT", "REQUIRES_MODIFICATION", "REJECTED"].includes(previewTarget.status)
    )
  ) : false;

  // ── Open the read-only preview dialog — fetches the FULL request detail
  // (course, trainees, attachments, timeline) from GET /api/requests/[id]
  // so the contractor can see everything they submitted, in read-only format.
  const openPreview = async (req: Request) => {
    setPreviewTarget(req);
    setPreviewDetail(null);
    setPreviewLoading(true);
    try {
      const detail = await api.get<RequestDetail>(`/requests/${req.id}`);
      setPreviewDetail(detail);
    } catch {
      // Fall back to the list-row data (no trainees/attachments shown)
    } finally {
      setPreviewLoading(false);
    }
  };

  // ── Edit existing request: loads the request data into the form + opens
  // the same dialog as "New Request" but in edit mode. The form is pre-filled
  // with the request's current values. On save, it PUTs to /api/requests/[id].
  const handleEditRequest = async (req: Request) => {
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

    // ── Fetch the FULL request detail (trainees, documents, course) from the API ──
    // The list-row data only has basic fields — it does NOT include trainees.
    // Without this fetch, the edit dialog opens with an EMPTY trainee table.
    try {
      const detail = await api.get<RequestDetail>(`/requests/${req.id}`);

      // ── Populate trainees from requestCourses.trainees ──
      if (detail.requestCourses && detail.requestCourses.length > 0) {
        const loadedTrainees: TraineeEntry[] = detail.requestCourses.flatMap((rc) =>
          (rc.trainees ?? []).map((tr) => {
            const tn = tr.trainee;
            // Parse trainee.documents JSON for the TraineeEntry
            let docs: TraineeEntry["documents"] = [];
            try {
              const parsed = tn.documents ? JSON.parse(tn.documents) : [];
              if (Array.isArray(parsed)) docs = parsed;
            } catch { /* ignore */ }
            // Phase 1: fold any legacy `idAttachmentUrl` value into documents[]
            // so the in-memory state is consistent with the new model. This is
            // a no-op once Phase 2 backfill has run.
            docs = normalizeIdAttachmentIntoDocuments(tn.idAttachmentUrl, docs);
            return {
              id: crypto.randomUUID(),
              fullName: tn.fullName || "",
              nationalId: tn.nationalId || "",
              nationality: tn.nationality || "",
              jobTitle: tn.jobTitle || "",
              idAttachmentUrl: null,
              idAttachmentName: null,
              documents: docs,
              valid: true,
              errors: [],
            };
          })
        );
        setTrainees(loadedTrainees);
      }

      // ── Populate additional documents from request.documents ──
      if (detail.documents) {
        try {
          const reqDocs = JSON.parse(detail.documents);
          if (Array.isArray(reqDocs) && reqDocs.length > 0) {
            const loadedDocs: AdditionalDocument[] = reqDocs.map((d: { url?: string; filename?: string; type?: string; uploadedAt?: string; size?: number }) => ({
              url: d.url || "",
              filename: d.filename || "",
              type: d.type || "other",
              size: d.size,
              uploadedAt: d.uploadedAt || new Date().toISOString(),
            }));
            setAdditionalDocs(loadedDocs);
          }
        } catch { /* ignore */ }
      }

      // ── Update formData with any richer data from the detail (course title, etc.) ──
      if (detail.courseId) setFormData((p) => ({ ...p, courseId: detail.courseId }));
    } catch {
      // If the fetch fails, the dialog still opens with the basic row data
      // (trainees will be empty, but at least the form fields are populated)
    }
  };

  const handleEditSave = async () => {
    if (!editTarget || !formData.courseId) {
      toast({ title: t("misc.error"), description: t("requests.course") + " — " + t("misc.required"), variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      // Phase 1: documents[] is the single source of truth. We do NOT send
      // `idAttachmentUrl` — the server-side handler folds any legacy value
      // into documents[] if needed.
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
            <Button variant="outline" onClick={() => setExportDialogOpen(true)}>
              <Download className="h-4 w-4 me-1.5" />{t("requests.export")}
            </Button>
            {canCreate && (
              <>
                <Button variant="outline" onClick={handleImportClick} disabled={importing}>
                  <Upload className="h-4 w-4 me-1.5" />{t("requests.import")}
                </Button>
              </>
            )}
            {canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("requests.new")}</Button>}
          </>
        }
      />

      {/* ─── Enhanced Import / Export Dialogs ─── */}
      <ImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onDeviceImport={handleImportFile}
        onImportFromArchive={async (requestId, archiveItems) => {
          const result = await api.post<{ trainees: TraineeEntry[]; courseInfo?: { courseId: string; courseTitle: string | null } }>(
            "/requests/import-from-archive",
            { sourceRequestId: requestId, items: archiveItems },
          );
          if (result.trainees?.length > 0) {
            const newTrainees = result.trainees.map((t: TraineeEntry) => {
              // Phase 1: normalize legacy idAttachmentUrl into documents[]
              const normalizedDocs = normalizeIdAttachmentIntoDocuments(
                t.idAttachmentUrl as string | null | undefined,
                Array.isArray(t.documents) ? t.documents : [],
              );
              return {
                id: crypto.randomUUID(),
                fullName: String(t.fullName || ""),
                nationalId: String(t.nationalId || ""),
                nationality: String(t.nationality || ""),
                jobTitle: String(t.jobTitle || ""),
                idAttachmentUrl: null,
                idAttachmentName: null,
                documents: normalizedDocs,
                valid: false,
                errors: [],
              };
            });
            setTrainees([...trainees, ...newTrainees]);
          }
          if (result.courseInfo?.courseId) {
            setField("courseId", result.courseInfo.courseId);
          }
          setDialogOpen(true);
        }}
      />
      <ExportDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
      />

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      {/* ── Coordinator-only: Single-selection toolbar with direct export ── */}
      {isCoordinator && selectedIds.size > 0 && selectedRequest && (
        <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 px-4 py-2.5">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium">{selectedRequest.refNumber}</span>
            <span className="text-muted-foreground">— {selectedRequest.courseTitle || "—"}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => directExport("pdf")}>
              <Printer className="h-3.5 w-3.5 me-1.5" />Print PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => directExport("excel")}>
              <FileSpreadsheet className="h-3.5 w-3.5 me-1.5" />Export Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => directExport("zip")}>
              <FileTextIcon className="h-3.5 w-3.5 me-1.5" />Download ZIP
            </Button>
            <Button variant="ghost" size="sm" onClick={clearSelection}>
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
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
            <Select value={(formData.status as string) === "REQUIRES_MODIFICATION" ? "DRAFT" : (formData.status as string) ?? "DRAFT"} onValueChange={(v) => setField("status", v)}>
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
              <Select value={(formData.courseId as string) || undefined} onValueChange={(v) => setField("courseId", v)}>
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
        onOpenChange={(open) => { if (!open) { setPreviewTarget(null); setPreviewDetail(null); } }}
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
              <DetailRow label={t("requests.company")} value={previewDetail?.company?.name ?? previewTarget.companyName} />
              <DetailRow label={t("requests.course")} value={previewDetail?.course?.title ?? previewTarget.courseTitle} />
              <DetailRow label={t("requests.traineeCount")} value={String(previewTarget.traineeCount)} />
              <DetailRow label={t("requests.priority")} value={previewTarget.priority} />
              <DetailRow label={t("requests.preferredLocation")} value={previewTarget.preferredLocation} />
              <DetailRow label={t("requests.preferredDateFrom")} value={fmtDate(previewTarget.preferredDateFrom)} />
              <DetailRow label={t("requests.preferredDateTo")} value={fmtDate(previewTarget.preferredDateTo)} />
              <DetailRow label={t("requests.preferredLanguage")} value={previewTarget.preferredLanguage} />
            </FormGrid>

            {previewTarget.notes && <DetailRow label={t("requests.notes")} value={previewTarget.notes} />}

            {/* ── Trainees (read-only) — fetched from GET /api/requests/[id] ── */}
            <div>
              <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                {t("requests.trainees") || "Trainees"}
                {previewDetail?.requestCourses && (
                  <span className="text-[10px] text-muted-foreground">
                    ({previewDetail.requestCourses.reduce((sum, rc) => sum + (rc.trainees?.length ?? 0), 0)})
                  </span>
                )}
              </div>
              {previewLoading ? (
                <div className="text-xs text-muted-foreground py-3 text-center">Loading trainees…</div>
              ) : previewDetail?.requestCourses && previewDetail.requestCourses.length > 0 ? (
                <div className="rounded-md border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="text-start font-medium p-2">#</th>
                        <th className="text-start font-medium p-2">{t("requests.traineeName") || "Full Name"}</th>
                        <th className="text-start font-medium p-2">{t("requests.nationalId") || "National ID"}</th>
                        <th className="text-start font-medium p-2">{t("requests.nationality") || "Nationality"}</th>
                        <th className="text-start font-medium p-2">{t("requests.jobTitle") || "Job Title"}</th>
                        <th className="text-start font-medium p-2">{t("requests.attachments") || "Attachments"}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewDetail.requestCourses.flatMap((rc, rcIdx) =>
                        (rc.trainees ?? []).map((t, idx) => {
                          const tr = t.trainee;
                          // Parse trainee.documents JSON to count attachments
                          let docCount = 0;
                          try {
                            const docs = tr.documents ? JSON.parse(tr.documents) : [];
                            docCount = Array.isArray(docs) ? docs.length : 0;
                          } catch { /* ignore */ }
                          return (
                            <tr key={`${rcIdx}-${idx}`} className="border-t">
                              <td className="p-2 text-muted-foreground">{idx + 1}</td>
                              <td className="p-2 font-medium">{tr.fullName}</td>
                              <td className="p-2 font-mono">{tr.nationalId}</td>
                              <td className="p-2">{tr.nationality ?? "—"}</td>
                              <td className="p-2">{tr.jobTitle ?? "—"}</td>
                              <td className="p-2">
                                {docCount > 0 ? (
                                  <span className="inline-flex items-center gap-1 text-info">
                                    <FileText className="h-3 w-3" /> {docCount}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground py-3 text-center">
                  {t("requests.noTrainees" as never) || "No trainees attached"}
                </div>
              )}
            </div>

            {/* ── Request-level attachments (read-only) ── */}
            {previewDetail?.documents && (() => {
              let reqDocs: Array<{ url?: string; filename?: string; type?: string }> = [];
              try { reqDocs = JSON.parse(previewDetail.documents); } catch { /* ignore */ }
              if (!Array.isArray(reqDocs) || reqDocs.length === 0) return null;
              return (
                <div>
                  <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5" />
                    {t("requests.attachments") || "Attachments"}
                    <span className="text-[10px] text-muted-foreground">({reqDocs.length})</span>
                  </div>
                  <div className="rounded-md border divide-y">
                    {reqDocs.map((d, i) => (
                      <div key={i} className="flex items-center justify-between p-2 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          <span className="truncate">{d.filename ?? d.url ?? `Attachment ${i + 1}`}</span>
                          {d.type && <span className="text-[10px] text-muted-foreground">({d.type})</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

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

            {/* ── Read-only tracking view: Print + Export always available, Edit only when editable ── */}
            <div className="flex justify-end gap-2 pt-2 border-t">
              <Button variant="outline" onClick={() => setPreviewTarget(null)}>
                {t("action.cancel")}
              </Button>
              {/* Print button — always available for any non-deleted request, regardless of status */}
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="h-4 w-4 me-1.5" />{t("action.print") || "Print"}
              </Button>
              {/* Edit button — only for editable statuses (DRAFT + REQUIRES_MODIFICATION for contractors) */}
              {isPreviewEditable && (
                <Button onClick={() => { const r = previewTarget; setPreviewTarget(null); handleEditRequest(r); }}>
                  <Pencil className="h-4 w-4 me-1.5" />{t("action.edit") || "Edit"}
                </Button>
              )}
            </div>
          </div>
        )}
      </FormDialog>

      {/* ── Coordinator-only: Right-side Drawer for request details ── */}
      <Drawer open={drawerTarget !== null} onOpenChange={(open) => { if (!open) { setDrawerTarget(null); setDrawerDetail(null); } }} direction="right">
        <DrawerContent className="max-w-md h-full">
          <DrawerHeader className="border-b">
            <DrawerTitle className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              <span className="font-mono text-sm font-semibold text-primary">{drawerTarget?.refNumber}</span>
            </DrawerTitle>
            <DrawerDescription className="flex items-center gap-2">
              {drawerTarget && <PriorityBadge priority={drawerTarget.priority} />}
              {drawerTarget && <StatusBadge status={drawerTarget.status} />}
            </DrawerDescription>
          </DrawerHeader>

          {drawerTarget && (
            <div className="overflow-y-auto flex-1 p-4 space-y-4">
              {/* Company + Course */}
              <FormGrid>
                <DetailRow label={t("requests.company")} value={drawerDetail?.company?.name ?? drawerTarget.companyName} />
                <DetailRow label={t("requests.course")} value={drawerDetail?.course?.title ?? drawerTarget.courseTitle} />
                <DetailRow label={t("requests.traineeCount")} value={String(drawerTarget.traineeCount)} />
                <DetailRow label={t("requests.priority")} value={drawerTarget.priority} />
                <DetailRow label={t("requests.preferredLocation")} value={drawerTarget.preferredLocation} />
                <DetailRow label={t("requests.preferredDateFrom")} value={fmtDate(drawerTarget.preferredDateFrom)} />
                <DetailRow label={t("requests.preferredDateTo")} value={fmtDate(drawerTarget.preferredDateTo)} />
                <DetailRow label={t("requests.preferredLanguage")} value={drawerTarget.preferredLanguage} />
              </FormGrid>

              {drawerTarget.notes && <DetailRow label={t("requests.notes")} value={drawerTarget.notes} />}

              {/* Trainees table */}
              <div>
                <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {t("requests.trainees") || "Trainees"}
                  {drawerDetail?.requestCourses && (
                    <span className="text-[10px] text-muted-foreground">
                      ({drawerDetail.requestCourses.reduce((sum, rc) => sum + (rc.trainees?.length ?? 0), 0)})
                    </span>
                  )}
                </div>
                {drawerLoading ? (
                  <div className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
                  </div>
                ) : drawerDetail?.requestCourses && drawerDetail.requestCourses.length > 0 ? (
                  <div className="rounded-md border overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-start font-medium p-2">#</th>
                          <th className="text-start font-medium p-2">{t("requests.traineeName") || "Full Name"}</th>
                          <th className="text-start font-medium p-2">{t("requests.nationalId") || "National ID"}</th>
                          <th className="text-start font-medium p-2">{t("requests.nationality") || "Nationality"}</th>
                          <th className="text-start font-medium p-2">{t("requests.jobTitle") || "Job Title"}</th>
                          <th className="text-start font-medium p-2">{t("requests.attachments") || "Attachments"}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drawerDetail.requestCourses.flatMap((rc, rcIdx) =>
                          (rc.trainees ?? []).map((tr, idx) => {
                            const tn = tr.trainee;
                            let docCount = 0;
                            try {
                              const docs = tn.documents ? JSON.parse(tn.documents) : [];
                              docCount = Array.isArray(docs) ? docs.length : 0;
                            } catch { /* ignore */ }
                            return (
                              <tr key={`${rcIdx}-${idx}`} className="border-t">
                                <td className="p-2 text-muted-foreground">{idx + 1}</td>
                                <td className="p-2 font-medium">{tn.fullName}</td>
                                <td className="p-2 font-mono">{tn.nationalId}</td>
                                <td className="p-2">{tn.nationality ?? "—"}</td>
                                <td className="p-2">{tn.jobTitle ?? "—"}</td>
                                <td className="p-2">
                                  {docCount > 0 ? (
                                    <span className="inline-flex items-center gap-1 text-info">
                                      <FileText className="h-3 w-3" /> {docCount}
                                    </span>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-xs text-muted-foreground py-3 text-center">
                    {t("requests.noTrainees" as never) || "No trainees attached"}
                  </div>
                )}
              </div>

              {/* Request-level attachments */}
              {drawerDetail?.documents && (() => {
                let reqDocs: Array<{ url?: string; filename?: string; type?: string }> = [];
                try { reqDocs = JSON.parse(drawerDetail.documents); } catch { /* ignore */ }
                if (!Array.isArray(reqDocs) || reqDocs.length === 0) return null;
                return (
                  <div>
                    <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                      <FileText className="h-3.5 w-3.5" />
                      {t("requests.attachments") || "Attachments"}
                      <span className="text-[10px] text-muted-foreground">({reqDocs.length})</span>
                    </div>
                    <div className="rounded-md border divide-y">
                      {reqDocs.map((d, i) => (
                        <div key={i} className="flex items-center justify-between p-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate">{d.filename ?? d.url ?? `Attachment ${i + 1}`}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Rejection reason */}
              {drawerTarget.rejectionReason && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                  <div className="text-xs font-medium text-destructive flex items-center gap-1.5">
                    <AlertCircle className="h-3.5 w-3.5" /> {t("requests.rejectionReason")}
                  </div>
                  <div className="text-xs mt-1">{drawerTarget.rejectionReason}</div>
                </div>
              )}

              {/* Timeline */}
              <div>
                <div className="text-xs font-semibold mb-2">{t("requests.timeline")}</div>
                <div className="rounded-md border px-3">
                  {([
                    ["requests.createdAt", drawerTarget.createdAt],
                    ["requests.submittedAt", drawerTarget.submittedAt],
                    ["requests.reviewedAt", drawerTarget.reviewedAt],
                    ["requests.approvedAt", drawerTarget.approvedAt],
                    ["requests.scheduledAt", drawerTarget.scheduledAt],
                    ["requests.startedAt", drawerTarget.startedAt],
                    ["requests.completedAt", drawerTarget.completedAt],
                    ["requests.rejectedAt", drawerTarget.rejectedAt],
                  ] as const).filter(([, v]) => v).map(([label, value]) => (
                    <div key={label} className="flex justify-between items-center py-1.5 border-b last:border-b-0 text-xs">
                      <span className="text-muted-foreground">{t(label as never)}</span>
                      <span className="font-mono">{fmtDateTime(value)}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Coordinator actions inside the drawer */}
              {(() => {
                const actions = getActionsForRole(drawerTarget.status, user?.role, canEdit);
                if (actions.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-2 pt-2 border-t">
                    {actions.map((a) => (
                      <Button
                        key={a.status}
                        variant={a.variant}
                        size="sm"
                        className={a.variant === "default" ? "text-white" : ""}
                        onClick={() => { handleTransition(drawerTarget, a.status); setDrawerTarget(null); }}
                      >
                        {a.status === "APPROVED" && <Check className="h-3.5 w-3.5 me-1" />}
                        {a.status === "REJECTED" && <X className="h-3.5 w-3.5 me-1" />}
                        {t(a.labelKey as never)}
                      </Button>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}
        </DrawerContent>
      </Drawer>
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
