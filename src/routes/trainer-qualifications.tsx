"use client";

import { useState, useEffect, useState as useReactState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { Award, Plus, Calendar, FileText, User, AlertCircle } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";

interface TrainerOption { id: string; fullName: string; }
interface Qual {
  id: string;
  trainerName?: string | null;
  title: string;
  issuer?: string | null;
  credentialNumber?: string | null;
  issueDate?: string | null;
  expiryDate?: string | null;
  status: string;
}

export function TrainerQualificationsRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [trainers, setTrainers] = useReactState<TrainerOption[]>([]);

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Qual>("/trainer-qualifications");

  const canCreate = user ? canPerformAction(user.role, "trainer-qualifications", "create") : false;

  useEffect(() => {
    if (dialogOpen && trainers.length === 0) {
      api.getList<TrainerOption>("/trainers", { pageSize: 100 }).then((r) => {
        setTrainers(r.rows.map((t) => ({ id: t.id, fullName: t.fullName })));
      }).catch(() => {});
    }
  }, [dialogOpen, trainers.length]);

  const columns: Column<Qual>[] = [
    {
      key: "title",
      header: t("qualifications.title2"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-warning/10 text-warning shrink-0">
            <Award className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-medium">{r.title}</div>
            <div className="text-xs text-muted-foreground">{r.issuer || "—"}</div>
          </div>
        </div>
      ),
    },
    {
      key: "trainer",
      header: t("qualifications.trainer"),
      cell: (r) => (
        <div className="text-sm flex items-center gap-1.5">
          <User className="h-3.5 w-3.5 text-muted-foreground" />{r.trainerName || "—"}
        </div>
      ),
    },
    {
      key: "credential",
      header: t("qualifications.credentialNumber"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <FileText className="h-3 w-3" />{r.credentialNumber || "—"}
        </div>
      ),
    },
    {
      key: "dates",
      header: t("qualifications.issueDate"),
      cell: (r) => (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {r.issueDate && <div className="flex items-center gap-1.5"><Calendar className="h-3 w-3" />{new Date(r.issueDate).toLocaleDateString()}</div>}
          {r.expiryDate && <div className="flex items-center gap-1.5"><Calendar className="h-3 w-3" />{new Date(r.expiryDate).toLocaleDateString()}</div>}
        </div>
      ),
    },
    {
      key: "status",
      header: t("qualifications.status"),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: () => <Button variant="ghost" size="sm" className="h-8">{t("action.edit")}</Button>,
    },
  ];

  const handleSubmit = async () => {
    if (!formData.trainerId || !formData.title) {
      toast({ title: t("misc.error"), description: "Trainer and title are required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/trainer-qualifications", formData);
      toast({ title: t("misc.success"), description: t("misc.createSuccess") });
      setDialogOpen(false);
      setFormData({});
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
        title={t("qualifications.title")}
        subtitle={t("qualifications.subtitle")}
        icon={Award}
        actions={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("qualifications.new")}</Button>}
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
        emptyIcon={Award}
        emptyTitle={t("qualifications.empty.title")}
        emptySubtitle={t("qualifications.empty.subtitle")}
        emptyAction={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("qualifications.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("qualifications.new")}
        description={t("qualifications.subtitle")}
        icon={Award}
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("qualifications.trainer")} required>
              <Select onValueChange={(v) => setField("trainerId", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {trainers.map((t) => <SelectItem key={t.id} value={t.id}>{t.fullName}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("qualifications.title2")} required>
              <Input placeholder="NEBOSH General Certificate" value={(formData.title as string) ?? ""} onChange={(e) => setField("title", e.target.value)} />
            </Field>
            <Field label={t("qualifications.issuer")}>
              <Input placeholder="NEBOSH" value={(formData.issuer as string) ?? ""} onChange={(e) => setField("issuer", e.target.value)} />
            </Field>
            <Field label={t("qualifications.credentialNumber")}>
              <Input placeholder="NEB-000000" value={(formData.credentialNumber as string) ?? ""} onChange={(e) => setField("credentialNumber", e.target.value)} />
            </Field>
            <Field label={t("qualifications.issueDate")}>
              <Input type="date" value={(formData.issueDate as string) ?? ""} onChange={(e) => setField("issueDate", e.target.value)} />
            </Field>
            <Field label={t("qualifications.expiryDate")}>
              <Input type="date" value={(formData.expiryDate as string) ?? ""} onChange={(e) => setField("expiryDate", e.target.value)} />
            </Field>
          </FormGrid>
          <Field label={t("qualifications.document")}>
            <Input type="file" />
          </Field>
        </div>
      </FormDialog>
    </div>
  );
}
