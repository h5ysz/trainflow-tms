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
import { StatusBadge, PriorityBadge } from "@/components/common/status-badge";
import { ClipboardList, Plus, Building2, BookOpen, Users, Calendar } from "lucide-react";

interface Request {
  id: string;
  requestNumber: string;
  companyName: string;
  courseTitle: string;
  traineeCount: number;
  preferredDateFrom: string;
  priority: string;
  status: string;
}

const PRIORITIES = ["LOW", "NORMAL", "HIGH", "URGENT"];

export function TrainingRequestsRoute() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const data: Request[] = [];

  const columns: Column<Request>[] = [
    {
      key: "id",
      header: t("requests.requestNumber"),
      cell: (r) => (
        <div className="font-mono text-xs font-semibold text-primary">{r.requestNumber}</div>
      ),
    },
    {
      key: "company",
      header: t("requests.company"),
      cell: (r) => (
        <div className="flex items-center gap-2 text-sm">
          <Building2 className="h-3.5 w-3.5 text-muted-foreground" />{r.companyName}
        </div>
      ),
    },
    {
      key: "course",
      header: t("requests.course"),
      cell: (r) => (
        <div className="flex items-center gap-2 text-sm">
          <BookOpen className="h-3.5 w-3.5 text-muted-foreground" />{r.courseTitle}
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
        <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Calendar className="h-3 w-3" />{r.preferredDateFrom || "—"}</div>
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
      cell: () => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" className="h-8 text-success">{t("action.approve")}</Button>
          <Button variant="ghost" size="sm" className="h-8 text-destructive">{t("action.reject")}</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("requests.title")}
        subtitle={t("requests.subtitle")}
        icon={ClipboardList}
        actions={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("requests.new")}</Button>}
      />
      <DataTable
        columns={columns}
        data={data}
        rowKey={(r) => r.id}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        emptyIcon={ClipboardList}
        emptyTitle={t("requests.empty.title")}
        emptySubtitle={t("requests.empty.subtitle")}
        emptyAction={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("requests.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("requests.new")}
        description={t("requests.subtitle")}
        icon={ClipboardList}
        size="lg"
        onSubmit={() => setDialogOpen(false)}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("requests.company")} required>
              <Select><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>
                <SelectItem value="—" disabled>—</SelectItem>
              </SelectContent></Select>
            </Field>
            <Field label={t("requests.course")} required>
              <Select><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>
                <SelectItem value="—" disabled>—</SelectItem>
              </SelectContent></Select>
            </Field>
            <Field label={t("requests.traineeCount")} required>
              <Input type="number" defaultValue={1} min={1} />
            </Field>
            <Field label={t("requests.priority")}>
              <Select defaultValue="NORMAL"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                {PRIORITIES.map((p) => <SelectItem key={p} value={p}>{t(`priority.${p}` as never)}</SelectItem>)}
              </SelectContent></Select>
            </Field>
            <Field label={t("requests.preferredDateFrom")}>
              <Input type="date" />
            </Field>
            <Field label={t("requests.preferredDateTo")}>
              <Input type="date" />
            </Field>
            <Field label={t("requests.preferredLocation")}>
              <Input placeholder="Riyadh / On-site / Virtual" />
            </Field>
            <Field label={t("requests.preferredLanguage")}>
              <Select defaultValue="en"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                <SelectItem value="en">English</SelectItem>
                <SelectItem value="ar">العربية</SelectItem>
                <SelectItem value="bilingual">Bilingual</SelectItem>
              </SelectContent></Select>
            </Field>
          </FormGrid>
          <Field label={t("requests.notes")}>
            <Textarea rows={3} placeholder={t("requests.notes")} />
          </Field>
        </div>
      </FormDialog>
    </div>
  );
}
