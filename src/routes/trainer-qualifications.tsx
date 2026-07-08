"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { Award, Plus, Calendar, FileText, User } from "lucide-react";

interface Qual {
  id: string;
  trainerName: string;
  title: string;
  issuer: string;
  credentialNumber: string;
  issueDate: string;
  expiryDate: string;
  status: string;
}

export function TrainerQualificationsRoute() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const data: Qual[] = [];

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
          <User className="h-3.5 w-3.5 text-muted-foreground" />{r.trainerName}
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
          {r.issueDate && <div className="flex items-center gap-1.5"><Calendar className="h-3 w-3" />{r.issueDate}</div>}
          {r.expiryDate && <div className="flex items-center gap-1.5"><Calendar className="h-3 w-3" />{r.expiryDate}</div>}
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

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("qualifications.title")}
        subtitle={t("qualifications.subtitle")}
        icon={Award}
        actions={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("qualifications.new")}</Button>}
      />
      <DataTable
        columns={columns}
        data={data}
        rowKey={(r) => r.id}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        emptyIcon={Award}
        emptyTitle={t("qualifications.empty.title")}
        emptySubtitle={t("qualifications.empty.subtitle")}
        emptyAction={<Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 me-1.5" />{t("qualifications.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        title={t("qualifications.new")}
        description={t("qualifications.subtitle")}
        icon={Award}
        onSubmit={() => setDialogOpen(false)}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("qualifications.trainer")} required>
              <Select><SelectTrigger><SelectValue placeholder="—" /></SelectTrigger><SelectContent>
                <SelectItem value="—" disabled>—</SelectItem>
              </SelectContent></Select>
            </Field>
            <Field label={t("qualifications.title2")} required>
              <Input placeholder="NEBOSH General Certificate" />
            </Field>
            <Field label={t("qualifications.issuer")}>
              <Input placeholder="NEBOSH" />
            </Field>
            <Field label={t("qualifications.credentialNumber")}>
              <Input placeholder="NEB-000000" />
            </Field>
            <Field label={t("qualifications.issueDate")}>
              <Input type="date" />
            </Field>
            <Field label={t("qualifications.expiryDate")}>
              <Input type="date" />
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
