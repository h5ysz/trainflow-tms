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
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/common/status-badge";
import { BookOpen, Plus, Clock, Users, Award, AlertCircle } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { useEntityActions } from "@/hooks/use-entity-actions";

interface Course {
  id: string;
  refNumber: string;
  code: string;
  title: string;
  titleAr?: string | null;
  category?: string | null;
  durationHours: number;
  validityMonths: number;
  passScore: number;
  maxTrainees: number;
  language: string;
  status: string;
  hasPreTest: boolean;
  hasFinalTest: boolean;
  hasEvaluation: boolean;
  requiresProfessionVerification: boolean;
}

const STATUSES = ["ACTIVE", "INACTIVE", "DRAFT"];

const NEW_COURSE = {
  durationHours: 8,
  validityMonths: 12,
  passScore: 70,
  maxTrainees: 20,
  language: "en",
  status: "ACTIVE",
  hasPreTest: true,
  hasFinalTest: true,
  hasEvaluation: true,
  requiresProfessionVerification: false,
};

export function CoursesRoute() {
  const { t } = useI18n();

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Course>("/courses");

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<Course>({
    resource: "/courses",
    module: "courses",
    refetch,
    fetchOnEdit: true,
  });

  const columns: Column<Course>[] = [
    {
      key: "title",
      header: t("courses.title2"),
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
      [t("courses.code")]: "code",
      [t("courses.title2")]: "title",
    }));

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("courses.title")}
        subtitle={t("courses.subtitle")}
        icon={BookOpen}
        actions={canCreate && <Button onClick={() => openCreate(NEW_COURSE)}><Plus className="h-4 w-4 me-1.5" />{t("courses.new")}</Button>}
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
        emptyIcon={BookOpen}
        emptyTitle={t("courses.empty.title")}
        emptySubtitle={t("courses.empty.subtitle")}
        emptyAction={canCreate && <Button onClick={() => openCreate(NEW_COURSE)}><Plus className="h-4 w-4 me-1.5" />{t("courses.new")}</Button>}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={isEditing ? t("courses.edit") : t("courses.new")}
        description={t("courses.subtitle")}
        icon={BookOpen}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("courses.code")} required>
              <Input placeholder="CRS-001" value={(formData.code as string) ?? ""} onChange={(e) => setField("code", e.target.value)} />
            </Field>
            <Field label={t("courses.title2")} required>
              <Input placeholder="Basic Safety Training" value={(formData.title as string) ?? ""} onChange={(e) => setField("title", e.target.value)} />
            </Field>
            <Field label={t("courses.titleAr")}>
              <Input placeholder="التدريب الأساسي على السلامة" dir="rtl" value={(formData.titleAr as string) ?? ""} onChange={(e) => setField("titleAr", e.target.value)} />
            </Field>
            <Field label={t("courses.category")}>
              <Input placeholder="HSE / First Aid / Fire Safety" value={(formData.category as string) ?? ""} onChange={(e) => setField("category", e.target.value)} />
            </Field>
          </FormGrid>

          <Field label={t("courses.description")}>
            <Textarea rows={3} placeholder={t("courses.description")} value={(formData.description as string) ?? ""} onChange={(e) => setField("description", e.target.value)} />
          </Field>

          <div className="border-t pt-4">
            <FormGrid cols={3}>
              <Field label={t("courses.durationHours")} required>
                <Input type="number" min={1} value={formData.durationHours as number} onChange={(e) => setField("durationHours", parseInt(e.target.value, 10) || 0)} />
              </Field>
              <Field label={t("courses.validityMonths")} required>
                <Input type="number" min={1} value={formData.validityMonths as number} onChange={(e) => setField("validityMonths", parseInt(e.target.value, 10) || 0)} />
              </Field>
              <Field label={t("courses.passScore")} required>
                <Input type="number" min={0} max={100} value={formData.passScore as number} onChange={(e) => setField("passScore", parseInt(e.target.value, 10) || 0)} />
              </Field>
              <Field label={t("courses.maxTrainees")}>
                <Input type="number" min={1} value={formData.maxTrainees as number} onChange={(e) => setField("maxTrainees", parseInt(e.target.value, 10) || 0)} />
              </Field>
              <Field label={t("courses.language")}>
                <Select value={formData.language as string} onValueChange={(v) => setField("language", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ar">العربية</SelectItem>
                    <SelectItem value="en">English</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label={t("courses.status")}>
                <Select value={formData.status as string} onValueChange={(v) => setField("status", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`status.${s}` as never)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </FormGrid>
          </div>

          <div className="border-t pt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="flex items-center gap-2 text-sm"><Switch checked={formData.hasPreTest as boolean} onCheckedChange={(v) => setField("hasPreTest", v)} /> {t("courses.hasPreTest")}</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={formData.hasFinalTest as boolean} onCheckedChange={(v) => setField("hasFinalTest", v)} /> {t("courses.hasFinalTest")}</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={formData.hasEvaluation as boolean} onCheckedChange={(v) => setField("hasEvaluation", v)} /> {t("courses.hasEvaluation")}</label>
          </div>

          <div className="border-t pt-4">
            <label className="flex items-start gap-2 text-sm">
              <Switch checked={formData.requiresProfessionVerification as boolean} onCheckedChange={(v) => setField("requiresProfessionVerification", v)} />
              <div>
                <div>{t("certRelease.course.requiresProfessionVerification")}</div>
                <div className="text-xs text-muted-foreground">{t("certRelease.course.requiresProfessionVerificationDesc")}</div>
              </div>
            </label>
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
