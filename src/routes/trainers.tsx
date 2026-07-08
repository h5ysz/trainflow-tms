"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { Users, Plus, Mail, Phone, Award, CalendarDays, AlertCircle } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";

interface Trainer {
  id: string;
  refNumber: string;
  fullName: string;
  fullNameAr?: string | null;
  email?: string | null;
  phone?: string | null;
  nationality?: string | null;
  status: string;
  qualificationsCount: number;
  sessionsCount: number;
  hireDate?: string | null;
}

const STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED"];

export function TrainersRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>({});

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Trainer>("/trainers");

  const canCreate = user ? canPerformAction(user.role, "trainers", "create") : false;

  const columns: Column<Trainer>[] = [
    {
      key: "name",
      header: t("trainers.fullName"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-warning/10 text-warning text-xs font-semibold shrink-0">
            {r.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-medium">{r.fullName}</div>
            <div className="text-[10px] text-muted-foreground font-mono">{r.refNumber}</div>
          </div>
        </div>
      ),
    },
    {
      key: "contact",
      header: t("trainers.email"),
      cell: (r) => (
        <div className="space-y-0.5">
          {r.email && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Mail className="h-3 w-3" />{r.email}</div>}
          {r.phone && <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Phone className="h-3 w-3" />{r.phone}</div>}
        </div>
      ),
    },
    {
      key: "stats",
      header: t("trainers.qualifications"),
      cell: (r) => (
        <div className="flex gap-3 text-xs">
          <div>
            <div className="font-semibold tabular-nums flex items-center gap-1"><Award className="h-3 w-3" />{r.qualificationsCount}</div>
            <div className="text-muted-foreground">{t("trainers.qualifications")}</div>
          </div>
          <div>
            <div className="font-semibold tabular-nums flex items-center gap-1"><CalendarDays className="h-3 w-3" />{r.sessionsCount}</div>
            <div className="text-muted-foreground">{t("trainers.sessions")}</div>
          </div>
        </div>
      ),
    },
    {
      key: "hireDate",
      header: t("trainers.hireDate"),
      cell: (r) => <span className="text-sm text-muted-foreground">{r.hireDate ? new Date(r.hireDate).toLocaleDateString() : "—"}</span>,
    },
    {
      key: "status",
      header: t("trainers.status"),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: () => <Button variant="ghost" size="sm" className="h-8">{t("action.details")}</Button>,
    },
  ];

  const handleSubmit = async () => {
    if (!formData.fullName) {
      toast({ title: t("misc.error"), description: "Name is required", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      await api.post("/trainers", formData);
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
        title={t("trainers.title")}
        subtitle={t("trainers.subtitle")}
        icon={Users}
        actions={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("trainers.new")}</Button>}
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
        emptyIcon={Users}
        emptyTitle={t("trainers.empty.title")}
        emptySubtitle={t("trainers.empty.subtitle")}
        emptyAction={canCreate && <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("trainers.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("trainers.new")}
        description={t("trainers.subtitle")}
        icon={Users}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("trainers.fullName")} required>
              <Input placeholder="Full name" value={(formData.fullName as string) ?? ""} onChange={(e) => setField("fullName", e.target.value)} />
            </Field>
            <Field label={t("trainers.fullNameAr")}>
              <Input placeholder="الاسم بالعربية" dir="rtl" value={(formData.fullNameAr as string) ?? ""} onChange={(e) => setField("fullNameAr", e.target.value)} />
            </Field>
            <Field label={t("trainers.nationalId")}>
              <Input placeholder="ID Number" value={(formData.nationalId as string) ?? ""} onChange={(e) => setField("nationalId", e.target.value)} />
            </Field>
            <Field label={t("trainers.gender")}>
              <Select onValueChange={(v) => setField("gender", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MALE">{t("misc.yes") === "Yes" ? "Male" : "ذكر"}</SelectItem>
                  <SelectItem value="FEMALE">{t("misc.yes") === "Yes" ? "Female" : "أنثى"}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("trainers.nationality")}>
              <Input placeholder="Saudi" value={(formData.nationality as string) ?? ""} onChange={(e) => setField("nationality", e.target.value)} />
            </Field>
            <Field label={t("trainers.hireDate")}>
              <Input type="date" value={(formData.hireDate as string) ?? ""} onChange={(e) => setField("hireDate", e.target.value)} />
            </Field>
          </FormGrid>

          <div className="border-t pt-4">
            <FormGrid>
              <Field label={t("trainers.email")} required>
                <Input type="email" placeholder="trainer@trainflow.io" value={(formData.email as string) ?? ""} onChange={(e) => setField("email", e.target.value)} />
              </Field>
              <Field label={t("trainers.phone")}>
                <Input placeholder="+966 11 000 0000" value={(formData.phone as string) ?? ""} onChange={(e) => setField("phone", e.target.value)} />
              </Field>
              <Field label={t("trainers.mobile")}>
                <Input placeholder="+966 5X XXX XXXX" value={(formData.mobile as string) ?? ""} onChange={(e) => setField("mobile", e.target.value)} />
              </Field>
              <Field label={t("trainers.country")}>
                <Input placeholder="Saudi Arabia" value={(formData.country as string) ?? ""} onChange={(e) => setField("country", e.target.value)} />
              </Field>
              <Field label={t("trainers.city")}>
                <Input placeholder="Riyadh" value={(formData.city as string) ?? ""} onChange={(e) => setField("city", e.target.value)} />
              </Field>
            </FormGrid>
          </div>

          <div className="border-t pt-4 space-y-4">
            <Field label={t("trainers.address")}>
              <Input placeholder="Street, District" value={(formData.address as string) ?? ""} onChange={(e) => setField("address", e.target.value)} />
            </Field>
            <Field label={t("trainers.bio")}>
              <Textarea placeholder={t("trainers.bio")} rows={3} value={(formData.bio as string) ?? ""} onChange={(e) => setField("bio", e.target.value)} />
            </Field>
            <Field label={t("trainers.status")}>
              <Select defaultValue="ACTIVE" onValueChange={(v) => setField("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`status.${s}` as never)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
