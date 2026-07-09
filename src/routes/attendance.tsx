"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { RowActions } from "@/components/common/row-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { UserCheck, Plus, QrCode, Calendar, Building2, AlertCircle } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { useEntityActions } from "@/hooks/use-entity-actions";

interface AttendanceRow {
  id: string;
  sessionCode?: string | null;
  sessionTitle?: string | null;
  traineeName: string;
  traineeEmail?: string | null;
  company?: string | null;
  checkInAt?: string | null;
  status: string;
  checkInMethod?: string | null;
}

const STATUSES = ["REGISTERED", "PRESENT", "ABSENT", "LATE", "EXCUSED"];

const NEW_ATTENDANCE = { status: "PRESENT", checkInMethod: "MANUAL" };

export function AttendanceRoute() {
  const { t } = useI18n();
  const [scanOpen, setScanOpen] = useState(false);

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<AttendanceRow>("/attendance");

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<AttendanceRow>({
    resource: "/attendance",
    module: "attendance",
    refetch,
    fetchOnEdit: true,
  });

  const columns: Column<AttendanceRow>[] = [
    {
      key: "trainee",
      header: t("attendance.traineeName"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-info/10 text-info text-xs font-semibold shrink-0">
            {r.traineeName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-medium">{r.traineeName}</div>
            <div className="text-xs text-muted-foreground">{r.traineeEmail}</div>
          </div>
        </div>
      ),
    },
    {
      key: "session",
      header: t("attendance.session"),
      cell: (r) => <div className="font-mono text-xs font-semibold text-primary">{r.sessionCode || "—"}</div>,
    },
    {
      key: "company",
      header: t("attendance.company"),
      cell: (r) => <div className="text-sm flex items-center gap-1.5"><Building2 className="h-3.5 w-3.5 text-muted-foreground" />{r.company || "—"}</div>,
    },
    {
      key: "checkIn",
      header: t("attendance.checkInAt"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Calendar className="h-3 w-3" />{r.checkInAt ? new Date(r.checkInAt).toLocaleString() : "—"}
        </div>
      ),
    },
    {
      key: "method",
      header: t("attendance.checkInMethod"),
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{r.checkInMethod === "QR" ? "QR" : r.checkInMethod === "MANUAL" ? t("attendance.manualCheckIn") : "—"}</span>
      ),
    },
    {
      key: "status",
      header: t("attendance.status"),
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
      [t("attendance.session")]: "sessionId",
      [t("attendance.traineeName")]: "traineeName",
    }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("attendance.title")}
        subtitle={t("attendance.subtitle")}
        icon={UserCheck}
        actions={
          canCreate && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setScanOpen(true)}>
                <QrCode className="h-4 w-4 me-1.5" />{t("attendance.scanQR")}
              </Button>
              <Button onClick={() => openCreate(NEW_ATTENDANCE)}>
                <Plus className="h-4 w-4 me-1.5" />{t("attendance.manualCheckIn")}
              </Button>
            </div>
          )
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
        emptyIcon={UserCheck}
        emptyTitle={t("attendance.empty.title")}
        emptySubtitle={t("attendance.empty.subtitle")}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={isEditing ? t("action.edit") : t("attendance.manualCheckIn")}
        icon={UserCheck}
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-4">
          <FormGrid>
            <Field label={t("attendance.session")} required>
              <Input placeholder="Session ID" value={(formData.sessionId as string) ?? ""} onChange={(e) => setField("sessionId", e.target.value)} />
            </Field>
            <Field label={t("attendance.status")}>
              <Select value={formData.status as string} onValueChange={(v) => setField("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`status.${s}` as never)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </FormGrid>
          <FormGrid>
            <Field label={t("attendance.traineeName")} required>
              <Input placeholder="Full name" value={(formData.traineeName as string) ?? ""} onChange={(e) => setField("traineeName", e.target.value)} />
            </Field>
            <Field label={t("attendance.traineeId")}>
              <Input placeholder="National ID" value={(formData.traineeIdNational as string) ?? ""} onChange={(e) => setField("traineeIdNational", e.target.value)} />
            </Field>
            <Field label={t("attendance.traineeEmail")}>
              <Input type="email" placeholder="trainee@company.com" value={(formData.traineeEmail as string) ?? ""} onChange={(e) => setField("traineeEmail", e.target.value)} />
            </Field>
            <Field label={t("attendance.traineePhone")}>
              <Input placeholder="+966 5X XXX XXXX" value={(formData.traineePhone as string) ?? ""} onChange={(e) => setField("traineePhone", e.target.value)} />
            </Field>
            <Field label={t("attendance.company")}>
              <Input placeholder="Company name" value={(formData.company as string) ?? ""} onChange={(e) => setField("company", e.target.value)} />
            </Field>
          </FormGrid>
        </div>
      </FormDialog>

      <FormDialog open={scanOpen} onOpenChange={setScanOpen} title={t("attendance.scanQR")} icon={QrCode} size="sm">
        <div className="text-center py-4">
          <div className="flex h-40 w-40 mx-auto items-center justify-center rounded-xl border-2 border-dashed border-primary/40 bg-primary/5">
            <QrCode className="h-16 w-16 text-primary/60" />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">{t("qr.scanInstructions")}</p>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        description={deleteTarget?.traineeName}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
