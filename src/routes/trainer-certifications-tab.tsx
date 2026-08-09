"use client";

import { useState, useEffect, useRef } from "react";
import { useI18n } from "@/lib/i18n/context";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { RowActions } from "@/components/common/row-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { BadgeCheck, Plus, Calendar, User, BookOpen, AlertCircle, Download, Upload } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useEntityActions } from "@/hooks/use-entity-actions";
import { toDateInput } from "@/lib/utils";
import { trainerName } from "@/lib/i18n/trainer-name";

interface CertImportResult {
  coursesProcessed: number;
  certificationsCreated: number;
  certificationsSkipped: number;
  errors: { row: number; message: string }[];
}

interface TrainerOption { id: string; nameEn: string; nameAr?: string | null; }
interface CourseOption { id: string; title: string; code: string; }
interface QualOption { id: string; title: string; trainerId?: string; }

interface Certification {
  id: string;
  trainerId: string;
  courseId: string;
  qualificationId?: string | null;
  validFrom: string;
  validUntil?: string | null;
  status: string;
  notes?: string | null;
  trainer?: { id: string; nameEn: string; nameAr?: string | null; refNumber: string } | null;
  course?: { id: string; title: string; code: string; refNumber: string } | null;
  qualification?: { id: string; title: string; credentialNumber: string | null } | null;
}

const STATUSES = ["VALID", "EXPIRED", "REVOKED"];

/**
 * Trainer↔course certifications — the record of which courses a trainer is
 * cleared to teach. Authorised under the trainer-qualifications module, so it
 * lives as a tab on that page rather than as its own route.
 */
export function TrainerCertificationsTab() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);
  const [courses, setCourses] = useState<CourseOption[]>([]);
  const [quals, setQuals] = useState<QualOption[]>([]);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Certification>("/trainer-certifications");

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<Certification>({
    resource: "/trainer-certifications",
    module: "trainer-qualifications",
    refetch,
    fetchOnEdit: true,
    toForm: (r) => ({
      trainerId: r.trainerId,
      courseId: r.courseId,
      qualificationId: r.qualificationId ?? "",
      validFrom: toDateInput(r.validFrom),
      validUntil: toDateInput(r.validUntil),
      status: r.status,
      notes: r.notes ?? "",
    }),
  });

  useEffect(() => {
    if (!dialogOpen) return;
    if (trainers.length === 0) {
      api.getList<TrainerOption>("/trainers", { pageSize: 100 })
        .then((r) => setTrainers(r.rows.map((x) => ({ id: x.id, nameEn: x.nameEn, nameAr: x.nameAr }))))
        .catch(() => {});
    }
    if (courses.length === 0) {
      api.getList<CourseOption>("/courses", { pageSize: 100 })
        .then((r) => setCourses(r.rows.map((c) => ({ id: c.id, title: c.title, code: c.code }))))
        .catch(() => {});
    }
    if (quals.length === 0) {
      api.getList<QualOption>("/trainer-qualifications", { pageSize: 100 })
        .then((r) => setQuals(r.rows.map((q) => ({ id: q.id, title: q.title, trainerId: q.trainerId }))))
        .catch(() => {});
    }
  }, [dialogOpen, trainers.length, courses.length, quals.length]);

  // The API rejects a qualification that belongs to a different trainer.
  const selectableQuals = quals.filter((q) => !q.trainerId || q.trainerId === formData.trainerId);

  const handleImportClick = () => fileInputRef.current?.click();

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImporting(true);
    try {
      const result = await api.postFile<CertImportResult>("/trainer-certifications/import", file);
      toast({
        title: t("misc.success"),
        description: t("certifications.import.success", {
          created: result.certificationsCreated,
          skipped: result.certificationsSkipped,
        }),
        variant: result.errors.length > 0 ? "destructive" : "default",
      });
      refetch();
    } catch (err) {
      toast({ title: t("misc.error"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const handleSubmit = () =>
    void submit(requireFields({
      [t("certifications.trainer")]: "trainerId",
      [t("certifications.course")]: "courseId",
    }));

  const columns: Column<Certification>[] = [
    {
      key: "trainer",
      header: t("certifications.trainer"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-success/10 text-success shrink-0">
            <BadgeCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-medium flex items-center gap-1.5">
              <User className="h-3 w-3 text-muted-foreground" />
              {r.trainer ? trainerName(r.trainer, locale) : "—"}
            </div>
            <div className="text-[10px] font-mono text-muted-foreground">{r.trainer?.refNumber}</div>
          </div>
        </div>
      ),
    },
    {
      key: "course",
      header: t("certifications.course"),
      cell: (r) => (
        <div>
          <div className="text-sm flex items-center gap-1.5">
            <BookOpen className="h-3 w-3 text-muted-foreground" />
            {r.course?.title ?? "—"}
          </div>
          <div className="text-xs font-mono text-muted-foreground">{r.course?.code}</div>
        </div>
      ),
    },
    {
      key: "qualification",
      header: t("certifications.qualification"),
      cell: (r) => <span className="text-xs text-muted-foreground">{r.qualification?.title ?? "—"}</span>,
    },
    {
      key: "validity",
      header: t("certifications.validFrom"),
      cell: (r) => (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3 w-3" />{new Date(r.validFrom).toLocaleDateString()}
          </div>
          {r.validUntil && (
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3 w-3" />{new Date(r.validUntil).toLocaleDateString()}
            </div>
          )}
        </div>
      ),
    },
    { key: "status", header: t("certifications.status"), cell: (r) => <StatusBadge status={r.status} /> },
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

  const newButton = canCreate && (
    <Button onClick={() => openCreate({ status: "VALID" })}>
      <Plus className="h-4 w-4 me-1.5" />
      {t("certifications.new")}
    </Button>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{t("certifications.subtitle")}</p>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => window.open("/api/trainer-certifications/export", "_blank")}>
            <Download className="h-4 w-4 me-1.5" />{t("certifications.export")}
          </Button>
          {canCreate && (
            <>
              <input ref={fileInputRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => void handleImportFile(e)} />
              <Button variant="outline" onClick={handleImportClick} disabled={importing}>
                <Upload className="h-4 w-4 me-1.5" />{t("certifications.import")}
              </Button>
            </>
          )}
          {newButton}
        </div>
      </div>

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
        emptyIcon={BadgeCheck}
        emptyTitle={t("certifications.empty.title")}
        emptySubtitle={t("certifications.empty.subtitle")}
        emptyAction={newButton}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={isEditing ? t("certifications.edit") : t("certifications.new")}
        description={t("certifications.subtitle")}
        icon={BadgeCheck}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            {/* trainer+course form the uniqueness key; the API has no way to move
                an existing certification onto a different pair. */}
            <Field label={t("certifications.trainer")} required>
              <Select
                disabled={isEditing}
                value={(formData.trainerId as string) ?? ""}
                onValueChange={(v) => setField("trainerId", v)}
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {trainers.map((x) => <SelectItem key={x.id} value={x.id}>{trainerName(x, locale)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("certifications.course")} required>
              <Select
                disabled={isEditing}
                value={(formData.courseId as string) ?? ""}
                onValueChange={(v) => setField("courseId", v)}
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {courses.map((c) => <SelectItem key={c.id} value={c.id}>{c.title} ({c.code})</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("certifications.qualification")}>
              <Select value={(formData.qualificationId as string) ?? ""} onValueChange={(v) => setField("qualificationId", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {selectableQuals.map((q) => <SelectItem key={q.id} value={q.id}>{q.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("certifications.status")}>
              <Select value={(formData.status as string) ?? "VALID"} onValueChange={(v) => setField("status", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`status.${s}` as never)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("certifications.validFrom")}>
              <Input
                type="date"
                value={(formData.validFrom as string) ?? ""}
                onChange={(e) => setField("validFrom", e.target.value)}
              />
            </Field>
            <Field label={t("certifications.validUntil")}>
              <Input
                type="date"
                value={(formData.validUntil as string) ?? ""}
                onChange={(e) => setField("validUntil", e.target.value)}
              />
            </Field>
          </FormGrid>

          <Field label={t("certifications.notes")}>
            <Textarea
              rows={2}
              value={(formData.notes as string) ?? ""}
              onChange={(e) => setField("notes", e.target.value)}
            />
          </Field>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        description={
          deleteTarget
            ? `${trainerName(deleteTarget.trainer, locale)} — ${deleteTarget.course?.title ?? ""}`
            : undefined
        }
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
