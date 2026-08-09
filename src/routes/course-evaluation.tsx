"use client";

import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { RowActions } from "@/components/common/row-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Star, Check, X, MessageSquare, GraduationCap, AlertCircle, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api/client";
import { useList } from "@/lib/api/hooks";
import { useEntityActions } from "@/hooks/use-entity-actions";
import { useMemo, useState, useEffect } from "react";
import { trainerName } from "@/lib/i18n/trainer-name";

interface SessionOption { id: string; refNumber: string; title: string; }
interface TrainerOption { id: string; nameEn: string; nameAr?: string | null; }

interface Evaluation {
  id: string;
  sessionId: string;
  sessionCode?: string | null;
  trainerId?: string | null;
  trainerName?: string | null;
  trainer?: { nameEn: string; nameAr?: string | null } | null;
  traineeName: string;
  traineeEmail?: string | null;
  trainerRating: number;
  contentRating: number;
  venueRating: number;
  materialsRating: number;
  overallRating: number;
  comments?: string | null;
  wouldRecommend?: boolean | null;
  submittedAt: string;
}

const RATING_FIELDS = [
  "trainerRating",
  "contentRating",
  "venueRating",
  "materialsRating",
  "overallRating",
] as const;

// The API rejects anything outside 1..5, so a new evaluation starts mid-scale.
const NEW_EVALUATION = {
  trainerRating: 3,
  contentRating: 3,
  venueRating: 3,
  materialsRating: 3,
  overallRating: 3,
  wouldRecommend: true,
};

function StarRow({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star key={i} className={cn("h-3.5 w-3.5", i < value ? "text-warning fill-warning" : "text-muted-foreground/30")} />
      ))}
      <span className="ms-1.5 text-xs font-semibold text-foreground tabular-nums">{value.toFixed(1)}</span>
    </div>
  );
}

function StarInput({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n}`}
          onClick={() => onChange(n)}
          className="p-0.5"
        >
          <Star className={cn("h-5 w-5", n <= value ? "text-warning fill-warning" : "text-muted-foreground/30")} />
        </button>
      ))}
      <span className="ms-2 text-xs tabular-nums text-muted-foreground">{value}/5</span>
    </div>
  );
}

export function CourseEvaluationRoute() {
  const { t, locale } = useI18n();
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [trainers, setTrainers] = useState<TrainerOption[]>([]);

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Evaluation>("/evaluations");

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<Evaluation>({
    resource: "/evaluations",
    module: "evaluation",
    refetch,
    fetchOnEdit: true,
    mapError: (m) => (m.includes("already submitted") ? t("evaluation.duplicate") : m),
  });

  useEffect(() => {
    if (!dialogOpen) return;
    if (sessions.length === 0) {
      api.getList<SessionOption>("/sessions", { pageSize: 100 })
        .then((r) => setSessions(r.rows.map((s) => ({ id: s.id, refNumber: s.refNumber, title: s.title }))))
        .catch(() => {});
    }
    if (trainers.length === 0) {
      api.getList<TrainerOption>("/trainers", { pageSize: 100 })
        .then((r) => setTrainers(r.rows.map((x) => ({ id: x.id, nameEn: x.nameEn, nameAr: x.nameAr }))))
        .catch(() => {});
    }
  }, [dialogOpen, sessions.length, trainers.length]);

  const handleSubmit = () =>
    void submit(() => {
      const missing = requireFields({
        [t("evaluation.session")]: "sessionId",
        [t("evaluation.trainee")]: "traineeName",
      })();
      if (missing) return missing;
      // Guard client-side; the API 422s on out-of-range ratings.
      for (const f of RATING_FIELDS) {
        const v = formData[f];
        if (typeof v !== "number" || v < 1 || v > 5) return t("evaluation.ratingRange");
      }
      return null;
    });

  const avg = useMemo(() => {
    if (data.length === 0) return null;
    const sum = data.reduce(
      (acc, e) => ({
        trainer: acc.trainer + e.trainerRating,
        content: acc.content + e.contentRating,
        venue: acc.venue + e.venueRating,
        materials: acc.materials + e.materialsRating,
        overall: acc.overall + e.overallRating,
      }),
      { trainer: 0, content: 0, venue: 0, materials: 0, overall: 0 }
    );
    const n = data.length;
    return {
      trainer: sum.trainer / n,
      content: sum.content / n,
      venue: sum.venue / n,
      materials: sum.materials / n,
      overall: sum.overall / n,
    };
  }, [data]);

  const columns: Column<Evaluation>[] = [
    {
      key: "trainee",
      header: t("evaluation.trainee"),
      cell: (r) => (
        <div>
          <div className="text-sm font-medium">{r.traineeName}</div>
          <div className="text-xs text-muted-foreground font-mono">{r.sessionCode || "—"}</div>
        </div>
      ),
    },
    {
      key: "trainer",
      header: t("evaluation.trainer"),
      cell: (r) => (
        <div className="text-sm flex items-center gap-1.5"><GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />{r.trainer ? trainerName(r.trainer, locale) : (r.trainerName || "—")}</div>
      ),
    },
    { key: "trainerRating", header: t("evaluation.trainerRating"), cell: (r) => <StarRow value={r.trainerRating} /> },
    { key: "contentRating", header: t("evaluation.contentRating"), cell: (r) => <StarRow value={r.contentRating} /> },
    {
      key: "overallRating",
      header: t("evaluation.overallRating"),
      cell: (r) => (
        <div className="flex items-center gap-2">
          <StarRow value={r.overallRating} />
          {r.wouldRecommend ? <Check className="h-3.5 w-3.5 text-success" /> : r.wouldRecommend === false ? <X className="h-3.5 w-3.5 text-destructive" /> : null}
        </div>
      ),
    },
    { key: "submittedAt", header: t("evaluation.submittedAt"), cell: (r) => <span className="text-xs text-muted-foreground">{new Date(r.submittedAt).toLocaleDateString()}</span> },
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
    <Button onClick={() => openCreate(NEW_EVALUATION)}>
      <Plus className="h-4 w-4 me-1.5" />
      {t("evaluation.new")}
    </Button>
  );

  const summary = [
    { label: t("evaluation.trainerRating"), val: avg?.trainer.toFixed(1) ?? "—" },
    { label: t("evaluation.contentRating"), val: avg?.content.toFixed(1) ?? "—" },
    { label: t("evaluation.venueRating"), val: avg?.venue.toFixed(1) ?? "—" },
    { label: t("evaluation.materialsRating"), val: avg?.materials.toFixed(1) ?? "—" },
    { label: t("evaluation.overallRating"), val: avg?.overall.toFixed(1) ?? "—" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t("evaluation.title")} subtitle={t("evaluation.subtitle")} icon={Star} actions={newButton} />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {summary.map((s) => (
          <Card key={s.label} className="p-3 text-center">
            <div className="text-2xl font-bold tabular-nums text-foreground">{s.val}</div>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
              <Star className="h-3 w-3 text-warning fill-warning" />
              {s.label}
            </div>
          </Card>
        ))}
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
        emptyIcon={MessageSquare}
        emptyTitle={t("evaluation.empty.title")}
        emptySubtitle={t("evaluation.empty.subtitle")}
        emptyAction={newButton}
      />

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={isEditing ? t("evaluation.edit") : t("evaluation.new")}
        description={t("evaluation.subtitle")}
        icon={Star}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            {/* The API keys duplicate detection on sessionId + traineeName, so
                neither can move once the evaluation exists. */}
            <Field label={t("evaluation.session")} required>
              <Select
                disabled={isEditing}
                value={(formData.sessionId as string) ?? ""}
                onValueChange={(v) => setField("sessionId", v)}
              >
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.refNumber} — {s.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("evaluation.trainer")}>
              <Select value={(formData.trainerId as string) ?? ""} onValueChange={(v) => setField("trainerId", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {trainers.map((x) => <SelectItem key={x.id} value={x.id}>{trainerName(x, locale)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("evaluation.trainee")} required>
              <Input
                value={(formData.traineeName as string) ?? ""}
                onChange={(e) => setField("traineeName", e.target.value)}
              />
            </Field>
            <Field label={t("evaluation.traineeEmail")}>
              <Input
                type="email"
                value={(formData.traineeEmail as string) ?? ""}
                onChange={(e) => setField("traineeEmail", e.target.value)}
              />
            </Field>
          </FormGrid>

          <div className="border-t pt-4 space-y-3">
            {RATING_FIELDS.map((f) => (
              <div key={f} className="flex items-center justify-between gap-4">
                <span className="text-xs font-medium">{t(`evaluation.${f}` as never)}</span>
                <StarInput
                  value={(formData[f] as number) ?? 3}
                  onChange={(v) => setField(f, v)}
                />
              </div>
            ))}
          </div>

          <div className="border-t pt-4 space-y-4">
            <Field label={t("evaluation.comments")}>
              <Textarea
                rows={2}
                value={(formData.comments as string) ?? ""}
                onChange={(e) => setField("comments", e.target.value)}
              />
            </Field>
            <Field label={t("evaluation.suggestions")}>
              <Textarea
                rows={2}
                value={(formData.suggestions as string) ?? ""}
                onChange={(e) => setField("suggestions", e.target.value)}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={(formData.wouldRecommend as boolean) ?? false}
                onCheckedChange={(v) => setField("wouldRecommend", v)}
              />
              {t("evaluation.wouldRecommend")}
            </label>
          </div>
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
