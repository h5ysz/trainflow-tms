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
import { BookOpen, Plus, Clock, Users, Award } from "lucide-react";

interface Course {
  id: string;
  code: string;
  title: string;
  category: string;
  durationHours: number;
  validityMonths: number;
  passScore: number;
  status: string;
}

const STATUSES = ["ACTIVE", "INACTIVE", "DRAFT"];

export function CoursesRoute() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const data: Course[] = [];

  const columns: Column<Course>[] = [
    {
      key: "title",
      header: t("courses.title2"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0 font-mono text-xs font-bold">
            {r.code || "—"}
          </div>
          <div>
            <div className="text-sm font-medium">{r.title}</div>
            <div className="text-xs text-muted-foreground">{r.category || "—"}</div>
          </div>
        </div>
      ),
    },
    {
      key: "duration",
      header: t("courses.durationHours"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Clock className="h-3 w-3" />{r.durationHours}h
        </div>
      ),
    },
    {
      key: "validity",
      header: t("courses.validityMonths"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Award className="h-3 w-3" />{r.validityMonths}m
        </div>
      ),
    },
    {
      key: "passScore",
      header: t("courses.passScore"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Users className="h-3 w-3" />{r.passScore}%
        </div>
      ),
    },
    {
      key: "status",
      header: t("courses.status"),
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
        title={t("courses.title")}
        subtitle={t("courses.subtitle")}
        icon={BookOpen}
        actions={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("courses.new")}</Button>}
      />
      <DataTable
        columns={columns}
        data={data}
        rowKey={(r) => r.id}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        emptyIcon={BookOpen}
        emptyTitle={t("courses.empty.title")}
        emptySubtitle={t("courses.empty.subtitle")}
        emptyAction={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("courses.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("courses.new")}
        description={t("courses.subtitle")}
        icon={BookOpen}
        size="lg"
        onSubmit={() => setDialogOpen(false)}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("courses.code")} required>
              <Input placeholder="CRS-001" />
            </Field>
            <Field label={t("courses.title2")} required>
              <Input placeholder="Basic Safety Training" />
            </Field>
            <Field label={t("courses.titleAr")}>
              <Input placeholder="التدريب الأساسي على السلامة" dir="rtl" />
            </Field>
            <Field label={t("courses.category")}>
              <Input placeholder="HSE / First Aid / Fire Safety" />
            </Field>
          </FormGrid>

          <Field label={t("courses.description")}>
            <Textarea rows={3} placeholder={t("courses.description")} />
          </Field>

          <div className="border-t pt-4">
            <FormGrid cols={3}>
              <Field label={t("courses.durationHours")} required>
                <Input type="number" defaultValue={8} min={1} />
              </Field>
              <Field label={t("courses.validityMonths")} required>
                <Input type="number" defaultValue={12} min={1} />
              </Field>
              <Field label={t("courses.passScore")} required>
                <Input type="number" defaultValue={70} min={0} max={100} />
              </Field>
              <Field label={t("courses.maxTrainees")}>
                <Input type="number" defaultValue={20} min={1} />
              </Field>
              <Field label={t("courses.language")}>
                <Select defaultValue="en"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                  <SelectItem value="bilingual">Bilingual</SelectItem>
                </SelectContent></Select>
              </Field>
              <Field label={t("courses.status")}>
                <Select defaultValue="ACTIVE"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`status.${s}` as never)}</SelectItem>)}
                </SelectContent></Select>
              </Field>
            </FormGrid>
          </div>

          <div className="border-t pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-sm"><Switch defaultChecked /> {t("courses.hasPreTest")}</label>
            <label className="flex items-center gap-2 text-sm"><Switch defaultChecked /> {t("courses.hasFinalTest")}</label>
            <label className="flex items-center gap-2 text-sm"><Switch defaultChecked /> {t("courses.hasEvaluation")}</label>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
