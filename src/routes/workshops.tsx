"use client";

import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { RowActions } from "@/components/common/row-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { Wrench, Plus, Clock, Users, AlertCircle } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { useEntityActions } from "@/hooks/use-entity-actions";

interface Workshop {
  id: string;
  refNumber: string;
  code: string;
  title: string;
  description?: string | null;
  category?: string | null;
  durationDays: number;
  durationText?: string | null;
  durationHours: number;
  status: string;
  isActive: boolean;
  authorizedTrainersCount: number;
}

const STATUSES = ["ACTIVE", "INACTIVE"];

const NEW_WORKSHOP = {
  durationDays: 1,
  durationHours: 8,
  status: "ACTIVE",
  isActive: true,
};

export function WorkshopsRoute() {
  const { t } = useI18n();

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Workshop>("/workshops");

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<Workshop>({
    resource: "/workshops",
    module: "workshops",
    refetch,
    fetchOnEdit: true,
  });

  const columns: Column<Workshop>[] = [
    {
      key: "title",
      header: t("workshops.title2"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0 font-mono text-xs font-bold">
            {r.code || "—"}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium">{r.title}</div>
            <div className="text-[10px] text-muted-foreground font-mono">{r.refNumber} · {r.category || "—"}</div>
          </div>
        </div>
      ),
    },
    {
      key: "duration",
      header: t("workshops.durationText"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Clock className="h-3 w-3" />{r.durationText || `${r.durationDays}d`}
        </div>
      ),
    },
    {
      key: "authorizedTrainers",
      header: t("workshops.authorizedTrainers"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Users className="h-3 w-3" />{r.authorizedTrainersCount}
        </div>
      ),
    },
    {
      key: "status",
      header: t("workshops.status"),
      cell: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: (row) => (
        <RowActions
          canEdit={canEdit}
          canDelete={canDelete}
          onEdit={() => void openEdit(row)}
          onDelete={() => setDeleteTarget(row)}
        />
      ),
    },
  ];

  const handleSubmit = () =>
    void submit(requireFields({
      [t("workshops.code")]: "code",
      [t("workshops.title2")]: "title",
    }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("workshops.title")}
        subtitle={t("workshops.subtitle")}
        icon={Wrench}
        actions={canCreate && <Button onClick={() => openCreate(NEW_WORKSHOP)}><Plus className="h-4 w-4 me-1.5" />{t("workshops.new")}</Button>}
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
        emptyIcon={Wrench}
        emptyTitle={t("workshops.empty.title")}
        emptySubtitle={t("workshops.empty.subtitle")}
        emptyAction={canCreate && <Button onClick={() => openCreate(NEW_WORKSHOP)}><Plus className="h-4 w-4 me-1.5" />{t("workshops.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={isEditing ? t("workshops.edit") : t("workshops.new")}
        description={t("workshops.subtitle")}
        icon={Wrench}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("workshops.code")} required>
              <Input placeholder="CTCT06" value={(formData.code as string) ?? ""} onChange={(e) => setField("code", e.target.value)} />
            </Field>
            <Field label={t("workshops.title2")} required>
              <Input placeholder="Cable Joint & Termination" value={(formData.title as string) ?? ""} onChange={(e) => setField("title", e.target.value)} />
            </Field>
            <Field label={t("workshops.category")}>
              <Input placeholder="Technical Certification" value={(formData.category as string) ?? ""} onChange={(e) => setField("category", e.target.value)} />
            </Field>
          </FormGrid>

          <Field label={t("workshops.description")}>
            <Textarea rows={3} placeholder={t("workshops.description")} value={(formData.description as string) ?? ""} onChange={(e) => setField("description", e.target.value)} />
          </Field>

          <div className="border-t pt-4">
            <FormGrid cols={3}>
              <Field label={t("workshops.durationDays")} required>
                <Input type="number" min={1} value={(formData.durationDays as number) ?? 0} onChange={(e) => setField("durationDays", parseInt(e.target.value, 10) || 0)} />
              </Field>
              <Field label={t("workshops.durationText")}>
                <Input placeholder="1 Day joint" value={(formData.durationText as string) ?? ""} onChange={(e) => setField("durationText", e.target.value)} />
              </Field>
              <Field label={t("workshops.durationHours")}>
                <Input type="number" min={1} value={(formData.durationHours as number) ?? 0} onChange={(e) => setField("durationHours", parseInt(e.target.value, 10) || 0)} />
              </Field>
              <Field label={t("workshops.status")}>
                <Select value={(formData.status as string) ?? "ACTIVE"} onValueChange={(v) => setField("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`status.${s}` as never)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </FormGrid>
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        description={deleteTarget ? `${deleteTarget.code} — ${deleteTarget.title}` : undefined}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
