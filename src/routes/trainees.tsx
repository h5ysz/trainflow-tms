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
import { StatusBadge } from "@/components/common/status-badge";
import { UserSquare, Plus, Mail, Phone, Building2, AlertCircle, Fingerprint } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";

interface CompanyOption { id: string; name: string; refNumber: string; }
interface Trainee {
  id: string;
  refNumber: string;
  fullName: string;
  nationalId: string;
  nationality?: string | null;
  jobTitle?: string | null;
  mobile?: string | null;
  email?: string | null;
  companyId: string;
  companyName?: string | null;
  companyRef?: string | null;
  status: string;
  requestsCount: number;
  createdAt: string;
}

const STATUSES = ["ACTIVE", "INACTIVE"];

export function TraineesRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>({
    status: "ACTIVE",
    nationality: "Saudi",
  });
  const [companies, setCompanies] = useReactState<CompanyOption[]>([]);

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Trainee>("/trainees");

  const canCreate = user ? canPerformAction(user.role, "trainees", "create") : false;
  const canEdit = user ? canPerformAction(user.role, "trainees", "edit") : false;

  useEffect(() => {
    if (dialogOpen && companies.length === 0 && user?.role !== "CONTRACTOR") {
      api.getList<CompanyOption>("/companies", { pageSize: 100 }).then((r) => {
        setCompanies(r.rows.map((c) => ({ id: c.id, name: c.name, refNumber: c.refNumber })));
      }).catch(() => {});
    }
  }, [dialogOpen, companies.length, user?.role]);

  const columns: Column<Trainee>[] = [
    {
      key: "name",
      header: t("trainees.fullName"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
            {r.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{r.fullName}</div>
            <div className="text-[10px] text-muted-foreground font-mono">{r.refNumber}</div>
          </div>
        </div>
      ),
    },
    {
      key: "nationalId",
      header: t("trainees.nationalId"),
      cell: (r) => (
        <div className="text-xs flex items-center gap-1.5 font-mono">
          <Fingerprint className="h-3.5 w-3.5 text-muted-foreground" />
          {r.nationalId}
        </div>
      ),
    },
    {
      key: "nationality",
      header: t("trainees.nationality"),
      cell: (r) => <span className="text-sm text-muted-foreground">{r.nationality || "—"}</span>,
    },
    {
      key: "jobTitle",
      header: t("trainees.jobTitle"),
      cell: (r) => <span className="text-sm text-muted-foreground">{r.jobTitle || "—"}</span>,
    },
    {
      key: "contact",
      header: t("trainees.mobile"),
      cell: (r) => (
        <div className="space-y-0.5">
          {r.mobile && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" />{r.mobile}</div>}
          {r.email && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Mail className="h-3 w-3" />{r.email}</div>}
        </div>
      ),
    },
    {
      key: "company",
      header: t("trainees.company"),
      cell: (r) => (
        <div className="text-sm">
          <div className="flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-muted-foreground" />{r.companyName || "—"}</div>
          {r.companyRef && <div className="text-[10px] text-muted-foreground font-mono">{r.companyRef}</div>}
        </div>
      ),
    },
    {
      key: "status",
      header: t("trainees.status"),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: () => canEdit ? <Button variant="ghost" size="sm" className="h-8">{t("action.edit")}</Button> : null,
    },
  ];

  const handleSubmit = async () => {
    if (!formData.fullName || !formData.nationalId) {
      toast({ title: t("misc.error"), description: "Full Name and National ID are required", variant: "destructive" });
      return;
    }
    // For contractors, companyId is auto-set by backend
    if (user?.role !== "CONTRACTOR" && !formData.companyId) {
      toast({ title: t("misc.error"), description: "Company is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/trainees", formData);
      toast({ title: t("misc.success"), description: t("misc.createSuccess") });
      setDialogOpen(false);
      setFormData({ status: "ACTIVE", nationality: "Saudi" });
      refetch();
    } catch (e) {
      const msg = (e as Error).message;
      toast({
        title: t("misc.error"),
        description: msg.includes("already exists") ? t("trainees.duplicate") : msg,
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const setField = (k: string, v: unknown) => setFormData((p) => ({ ...p, [k]: v }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("trainees.title")}
        subtitle={t("trainees.subtitle")}
        icon={UserSquare}
        actions={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("trainees.new")}</Button>}
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
        emptyIcon={UserSquare}
        emptyTitle={t("trainees.empty.title")}
        emptySubtitle={t("trainees.empty.subtitle")}
        emptyAction={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("trainees.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("trainees.new")}
        description={t("trainees.subtitle")}
        icon={UserSquare}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("trainees.fullName")} required>
              <Input placeholder="Full name" value={(formData.fullName as string) ?? ""} onChange={(e) => setField("fullName", e.target.value)} />
            </Field>
            <Field label={t("trainees.nationalId")} required>
              <Input placeholder="0000000000" value={(formData.nationalId as string) ?? ""} onChange={(e) => setField("nationalId", e.target.value)} />
            </Field>
            <Field label={t("trainees.nationality")}>
              <Input placeholder="Saudi" value={(formData.nationality as string) ?? ""} onChange={(e) => setField("nationality", e.target.value)} />
            </Field>
            <Field label={t("trainees.jobTitle")}>
              <Input placeholder="HSE Officer" value={(formData.jobTitle as string) ?? ""} onChange={(e) => setField("jobTitle", e.target.value)} />
            </Field>
            <Field label={t("trainees.mobile")}>
              <Input placeholder="+966 5X XXX XXXX" value={(formData.mobile as string) ?? ""} onChange={(e) => setField("mobile", e.target.value)} />
            </Field>
            <Field label={t("trainees.email")}>
              <Input type="email" placeholder="trainee@company.com" value={(formData.email as string) ?? ""} onChange={(e) => setField("email", e.target.value)} />
            </Field>
          </FormGrid>

          {user?.role !== "CONTRACTOR" && (
            <Field label={t("trainees.company")} required>
              <Select onValueChange={(v) => setField("companyId", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name} ({c.refNumber})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field label={t("trainees.status")}>
            <Select value={(formData.status as string) ?? "ACTIVE"} onValueChange={(v) => setField("status", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`status.${s}` as never)}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>

          <Field label={t("trainees.notes")}>
            <Textarea rows={2} placeholder={t("trainees.notes")} value={(formData.notes as string) ?? ""} onChange={(e) => setField("notes", e.target.value)} />
          </Field>
        </div>
      </FormDialog>
    </div>
  );
}
