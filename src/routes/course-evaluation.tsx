"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { Card } from "@/components/ui/card";
import { Star, Check, X, MessageSquare, GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

interface Evaluation {
  id: string;
  sessionCode: string;
  trainerName: string;
  traineeName: string;
  trainerRating: number;
  contentRating: number;
  venueRating: number;
  materialsRating: number;
  overallRating: number;
  comments: string;
  wouldRecommend: boolean;
  submittedAt: string;
}

function StarRow({ value, max = 5 }: { value: number; max?: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star
          key={i}
          className={cn(
            "h-3.5 w-3.5",
            i < value ? "text-warning fill-warning" : "text-muted-foreground/30"
          )}
        />
      ))}
      <span className="ms-1.5 text-xs font-semibold text-foreground tabular-nums">{value.toFixed(1)}</span>
    </div>
  );
}

export function CourseEvaluationRoute() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const data: Evaluation[] = [];

  const columns: Column<Evaluation>[] = [
    {
      key: "trainee",
      header: t("evaluation.trainee"),
      cell: (r) => (
        <div>
          <div className="text-sm font-medium">{r.traineeName}</div>
          <div className="text-xs text-muted-foreground font-mono">{r.sessionCode}</div>
        </div>
      ),
    },
    {
      key: "trainer",
      header: t("evaluation.trainer"),
      cell: (r) => (
        <div className="text-sm flex items-center gap-1.5">
          <GraduationCap className="h-3.5 w-3.5 text-muted-foreground" />{r.trainerName}
        </div>
      ),
    },
    {
      key: "trainerRating",
      header: t("evaluation.trainerRating"),
      cell: (r) => <StarRow value={r.trainerRating} />,
    },
    {
      key: "contentRating",
      header: t("evaluation.contentRating"),
      cell: (r) => <StarRow value={r.contentRating} />,
    },
    {
      key: "overallRating",
      header: t("evaluation.overallRating"),
      cell: (r) => (
        <div className="flex items-center gap-2">
          <StarRow value={r.overallRating} />
          {r.wouldRecommend ? (
            <span className="inline-flex items-center gap-0.5 text-success text-xs"><Check className="h-3 w-3" /></span>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-destructive text-xs"><X className="h-3 w-3" /></span>
          )}
        </div>
      ),
    },
    {
      key: "submittedAt",
      header: t("evaluation.submittedAt"),
      cell: (r) => <span className="text-xs text-muted-foreground">{r.submittedAt}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("evaluation.title")}
        subtitle={t("evaluation.subtitle")}
        icon={Star}
      />

      {/* Summary cards (when data exists) */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: t("evaluation.trainerRating"), val: "—" },
          { label: t("evaluation.contentRating"), val: "—" },
          { label: t("evaluation.venueRating"), val: "—" },
          { label: t("evaluation.materialsRating"), val: "—" },
          { label: t("evaluation.overallRating"), val: "—" },
        ].map((s) => (
          <Card key={s.label} className="p-3 text-center">
            <div className="text-2xl font-bold tabular-nums text-foreground">{s.val}</div>
            <div className="text-xs text-muted-foreground mt-0.5 flex items-center justify-center gap-1">
              <Star className="h-3 w-3 text-warning fill-warning" />
              {s.label}
            </div>
          </Card>
        ))}
      </div>

      <DataTable
        columns={columns}
        data={data}
        rowKey={(r) => r.id}
        searchable
        searchValue={search}
        onSearchChange={setSearch}
        emptyIcon={MessageSquare}
        emptyTitle={t("evaluation.empty.title")}
        emptySubtitle={t("evaluation.empty.subtitle")}
      />
    </div>
  );
}
