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
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/common/status-badge";
import { Users, Plus, Mail, Phone, Award, CalendarDays } from "lucide-react";

interface Trainer {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  nationality: string;
  status: string;
  qualificationsCount: number;
  sessionsCount: number;
  hireDate: string;
}

const STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED"];

export function TrainersRoute() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const data: Trainer[] = [];

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
            <div className="text-xs text-muted-foreground">{r.nationality || "—"}</div>
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
      cell: (r) => <span className="text-sm text-muted-foreground">{r.hireDate || "—"}</span>,
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

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("trainers.title")}
        subtitle={t("trainers.subtitle")}
        icon={Users}
        actions={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("trainers.new")}</Button>}
      />
      <DataTable
        columns={columns}
        data={data}
        rowKey={(r) => r.id}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        emptyIcon={Users}
        emptyTitle={t("trainers.empty.title")}
        emptySubtitle={t("trainers.empty.subtitle")}
        emptyAction={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("trainers.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("trainers.new")}
        description={t("trainers.subtitle")}
        icon={Users}
        size="lg"
        onSubmit={() => setDialogOpen(false)}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("trainers.fullName")} required>
              <Input placeholder="Full name" />
            </Field>
            <Field label={t("trainers.fullNameAr")}>
              <Input placeholder="الاسم بالعربية" dir="rtl" />
            </Field>
            <Field label={t("trainers.nationalId")}>
              <Input placeholder="ID Number" />
            </Field>
            <Field label={t("trainers.gender")}>
              <Select><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>
                <SelectItem value="MALE">{t("misc.yes") === "Yes" ? "Male" : "ذكر"}</SelectItem>
                <SelectItem value="FEMALE">{t("misc.yes") === "Yes" ? "Female" : "أنثى"}</SelectItem>
              </SelectContent></Select>
            </Field>
            <Field label={t("trainers.nationality")}>
              <Input placeholder="Saudi" />
            </Field>
            <Field label={t("trainers.hireDate")}>
              <Input type="date" />
            </Field>
          </FormGrid>

          <div className="border-t pt-4">
            <FormGrid>
              <Field label={t("trainers.email")} required>
                <Input type="email" placeholder="trainer@trainflow.io" />
              </Field>
              <Field label={t("trainers.phone")}>
                <Input placeholder="+966 11 000 0000" />
              </Field>
              <Field label={t("trainers.mobile")}>
                <Input placeholder="+966 5X XXX XXXX" />
              </Field>
              <Field label={t("trainers.country")}>
                <Input placeholder="Saudi Arabia" />
              </Field>
              <Field label={t("trainers.city")}>
                <Input placeholder="Riyadh" />
              </Field>
            </FormGrid>
          </div>

          <div className="border-t pt-4 space-y-4">
            <Field label={t("trainers.address")}>
              <Input placeholder="Street, District" />
            </Field>
            <Field label={t("trainers.bio")}>
              <Textarea placeholder={t("trainers.bio")} rows={3} />
            </Field>
            <Field label={t("trainers.status")}>
              <Select defaultValue="ACTIVE"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`status.${s}` as never)}</SelectItem>)}
              </SelectContent></Select>
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch defaultChecked /> {t("status.ACTIVE")}
            </label>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
