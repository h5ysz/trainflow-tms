"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/common/status-badge";
import { BadgeCheck, Download, QrCode, Calendar, Building2, AlertCircle } from "lucide-react";
import { useList } from "@/lib/api/hooks";

interface Certificate {
  id: string;
  refNumber: string;
  certificateNumber?: string;
  traineeName: string;
  courseTitle?: string | null;
  courseCode?: string | null;
  courseRef?: string | null;
  companyName?: string | null;
  companyRef?: string | null;
  finalScore: number;
  issuedAt: string;
  validUntil: string;
  status: string;
  verificationToken?: string | null;
  verificationCount?: number;
}

export function CertificatesRoute() {
  const { t } = useI18n();
  const [search, setSearch] = useState("");
  const { data, pagination, loading, error, page, setPage } = useList<Certificate>("/certificates");

  const columns: Column<Certificate>[] = [
    {
      key: "cert",
      header: t("certificates.certificateNumber"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
            <BadgeCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="font-mono text-xs font-semibold text-primary">{r.refNumber}</div>
            <div className="text-xs text-muted-foreground">{t("certificates.issuedAt")}: {new Date(r.issuedAt).toLocaleDateString()}</div>
          </div>
        </div>
      ),
    },
    {
      key: "trainee",
      header: t("certificates.traineeName"),
      cell: (r) => (
        <div>
          <div className="text-sm font-medium">{r.traineeName}</div>
          <div className="text-xs text-muted-foreground flex items-center gap-1"><Building2 className="h-3 w-3" />{r.companyName || "—"}</div>
        </div>
      ),
    },
    {
      key: "course",
      header: t("certificates.course"),
      cell: (r) => (
        <div>
          <div className="text-sm">{r.courseTitle || "—"}</div>
          <div className="text-xs text-muted-foreground font-mono">{r.courseCode || "—"}</div>
        </div>
      ),
    },
    {
      key: "score",
      header: t("certificates.finalScore"),
      cell: (r) => <div className="text-sm font-semibold tabular-nums">{r.finalScore}%</div>,
    },
    {
      key: "validity",
      header: t("certificates.validUntil"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Calendar className="h-3 w-3" />{new Date(r.validUntil).toLocaleDateString()}</div>
      ),
    },
    { key: "status", header: t("certificates.status"), cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: () => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5"><Download className="h-3.5 w-3.5" />{t("certificates.download")}</Button>
          <Button variant="ghost" size="icon" className="h-8 w-8"><QrCode className="h-3.5 w-3.5" /></Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("certificates.title")}
        subtitle={t("certificates.subtitle")}
        icon={BadgeCheck}
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
        emptyIcon={BadgeCheck}
        emptyTitle={t("certificates.empty.title")}
        emptySubtitle={t("certificates.empty.subtitle")}
      />
    </div>
  );
}
