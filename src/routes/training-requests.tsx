"use client";

import { useState, useEffect, useRef, useState as useReactState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, PriorityBadge } from "@/components/common/status-badge";
import { ClipboardList, Plus, Building2, BookOpen, Users, Calendar, AlertCircle, Check, X, RotateCcw, ArrowRight, FileText, Download, Upload } from "lucide-react";
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
    try {
      await api.put(`/requests/${req.id}`, { status: newStatus });
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
        if (actions.length === 0) return <Button variant="ghost" size="sm" className="h-8">{t("action.details")}</Button>;
        return (
          <div className="flex justify-end gap-1 flex-wrap">
            {actions.map((a) => (
              <Button
                key={a.status}
                variant={a.variant}
                size="sm"
                className={`h-8 ${a.tone === "success" ? "text-success" : a.tone === "destructive" ? "text-destructive" : a.tone === "info" ? "text-info" : ""}`}
                onClick={() => handleTransition(r, a.status)}
                disabled={!canEdit && user?.role !== "CONTRACTOR"}
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
    setSubmitting(true);
    try {
      await api.post("/requests", formData);
      toast({ title: t("misc.success"), description: t("misc.createSuccess") });
      setDialogOpen(false);
      setFormData({ priority: "NORMAL", traineeCount: 1, preferredLanguage: "en", status: "DRAFT" });
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
            <Field label={t("requests.traineeCount")} required>
              <Input type="number" min={1} value={formData.traineeCount as number} onChange={(e) => setField("traineeCount", parseInt(e.target.value, 10) || 1)} />
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
          <Field label={t("requests.notes")}>
            <Textarea rows={3} placeholder={t("requests.notes")} value={(formData.notes as string) ?? ""} onChange={(e) => setField("notes", e.target.value)} />
          </Field>
        </div>
      </FormDialog>

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
    </div>
  );
}
