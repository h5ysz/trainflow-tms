"use client";

import { useState, useEffect, useState as useReactState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, PriorityBadge } from "@/components/common/status-badge";
import { ClipboardList, Plus, Building2, BookOpen, Users, Calendar, AlertCircle, Check, X } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";

interface CompanyOption { id: string; name: string; }
interface CourseOption { id: string; title: string; code: string; }
interface Request {
  id: string;
  requestNumber: string;
  companyName?: string | null;
  courseTitle?: string | null;
  courseCode?: string | null;
  traineeCount: number;
  preferredDateFrom?: string | null;
  preferredDateTo?: string | null;
  preferredLocation?: string | null;
  preferredLanguage?: string | null;
  notes?: string | null;
  status: string;
  priority: string;
  createdAt: string;
}

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

export function TrainingRequestsRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>({
    priority: "NORMAL",
    traineeCount: 1,
    preferredLanguage: "en",
  });
  const [companies, setCompanies] = useReactState<CompanyOption[]>([]);
  const [courses, setCourses] = useReactState<CourseOption[]>([]);

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Request>("/requests");

  const canCreate = user ? canPerformAction(user.role, "requests", "create") : false;
  const canApprove = user ? canPerformAction(user.role, "requests", "edit") : false;

  useEffect(() => {
    if (dialogOpen) {
      if (companies.length === 0) {
        api.get<{ rows: CompanyOption[] }>("/companies", { pageSize: 100 }).then((r) => {
          setCompanies(r.rows.map((c) => ({ id: c.id, name: c.name })));
        }).catch(() => {});
      }
      if (courses.length === 0) {
        api.get<{ rows: CourseOption[] }>("/courses", { pageSize: 100 }).then((r) => {
          setCourses(r.rows.map((c) => ({ id: c.id, title: c.title, code: c.code })));
        }).catch(() => {});
      }
    }
  }, [dialogOpen, companies.length, courses.length]);

  const handleApprove = async (id: string) => {
    try {
      await api.put(`/requests/${id}`, { status: "APPROVED" });
      toast({ title: t("misc.success"), description: t("action.approve") });
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };
  const handleReject = async (id: string) => {
    try {
      await api.put(`/requests/${id}`, { status: "REJECTED", rejectionReason: "Rejected by coordinator" });
      toast({ title: t("misc.success"), description: t("action.reject") });
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };

  const columns: Column<Request>[] = [
    {
      key: "id",
      header: t("requests.requestNumber"),
      cell: (r) => <div className="font-mono text-xs font-semibold text-primary">{r.requestNumber}</div>,
    },
    {
      key: "company",
      header: t("requests.company"),
      cell: (r) => (
        <div className="flex items-center gap-2 text-sm"><Building2 className="h-3.5 w-3.5 text-muted-foreground" />{r.companyName || "—"}</div>
      ),
    },
    {
      key: "course",
      header: t("requests.course"),
      cell: (r) => (
        <div className="flex items-center gap-2 text-sm"><BookOpen className="h-3.5 w-3.5 text-muted-foreground" />{r.courseTitle || "—"}</div>
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
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {canApprove && r.status === "PENDING" && (
            <>
              <Button variant="ghost" size="sm" className="h-8 text-success" onClick={() => handleApprove(r.id)}>
                <Check className="h-3.5 w-3.5 me-1" />{t("action.approve")}
              </Button>
              <Button variant="ghost" size="sm" className="h-8 text-destructive" onClick={() => handleReject(r.id)}>
                <X className="h-3.5 w-3.5 me-1" />{t("action.reject")}
              </Button>
            </>
          )}
          {(!canApprove || r.status !== "PENDING") && (
            <Button variant="ghost" size="sm" className="h-8">{t("action.details")}</Button>
          )}
        </div>
      ),
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
      setFormData({ priority: "NORMAL", traineeCount: 1, preferredLanguage: "en" });
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
        actions={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("requests.new")}</Button>}
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
          <FormGrid>
            {user?.role !== "CONTRACTOR" && (
              <Field label={t("requests.company")} required>
                <Select onValueChange={(v) => setField("companyId", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
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
    </div>
  );
}
