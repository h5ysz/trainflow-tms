"use client";

import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { Card } from "@/components/ui/card";
import { Star, Check, X, MessageSquare, GraduationCap, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api/client";
import { useList } from "@/lib/api/hooks";
import { useMemo } from "react";

interface Evaluation {
  id: string;
  sessionCode?: string | null;
  trainerName?: string | null;
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

export function CourseEvaluationRoute() {
  const { t } = useI18n();
  const { data, pagination, loading, error, page, setPage, search, setSearch } = useList<Evaluation>("/evaluations");

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
        <div className="text-sm flex items-center gap-1.5"><GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />{r.trainerName || "—"}</div>
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
  ];

  const summary = [
    { label: t("evaluation.trainerRating"), val: avg?.trainer.toFixed(1) ?? "—" },
    { label: t("evaluation.contentRating"), val: avg?.content.toFixed(1) ?? "—" },
    { label: t("evaluation.venueRating"), val: avg?.venue.toFixed(1) ?? "—" },
    { label: t("evaluation.materialsRating"), val: avg?.materials.toFixed(1) ?? "—" },
    { label: t("evaluation.overallRating"), val: avg?.overall.toFixed(1) ?? "—" },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title={t("evaluation.title")} subtitle={t("evaluation.subtitle")} icon={Star} />

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
      />
    </div>
  );
}
