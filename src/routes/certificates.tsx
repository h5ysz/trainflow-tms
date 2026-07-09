"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field } from "@/components/common/form-dialog";
import { RowActions } from "@/components/common/row-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/common/status-badge";
import { BadgeCheck, Download, QrCode, Calendar, Building2, AlertCircle, Ban, Loader2 } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api, downloadFile } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";

interface Certificate {
  id: string;
  refNumber: string;
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
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();

  const { data, pagination, loading, error, page, setPage, search, setSearch, refetch } =
    useList<Certificate>("/certificates");

  const [downloading, setDownloading] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<Certificate | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState<Certificate | null>(null);

  const canEdit = user ? canPerformAction(user.role, "certificates", "edit") : false;

  const verifyUrl = (token: string) =>
    `${typeof window === "undefined" ? "" : window.location.origin}/api/certificates/verify?token=${token}`;

  const handleDownload = async (row: Certificate) => {
    setDownloading(row.id);
    try {
      await downloadFile(`/certificates/${row.id}/generate-pdf`, `certificate-${row.refNumber}.pdf`);
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setDownloading(null);
    }
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      await api.put(`/certificates/${revokeTarget.id}`, { status: "REVOKED" });
      toast({ title: t("misc.success"), description: t("misc.updateSuccess") });
      setRevokeTarget(null);
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setRevoking(false);
    }
  };

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
      cell: (r) => (
        <div className="flex justify-end items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            disabled={downloading === r.id}
            onClick={() => void handleDownload(r)}
          >
            {downloading === r.id
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Download className="h-3.5 w-3.5" />}
            {t("certificates.download")}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            disabled={!r.verificationToken}
            onClick={() => setVerifyTarget(r)}
          >
            <QrCode className="h-3.5 w-3.5" />
          </Button>
          <RowActions
            extraItems={
              canEdit && r.status !== "REVOKED" ? (
                <DropdownMenuItem
                  onSelect={() => setRevokeTarget(r)}
                  className="text-destructive focus:text-destructive"
                >
                  <Ban className="h-3.5 w-3.5 me-2" />
                  {locale === "en" ? "Revoke" : "إلغاء"}
                </DropdownMenuItem>
              ) : null
            }
          />
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

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(o) => !o && setRevokeTarget(null)}
        title={locale === "en" ? "Revoke this certificate?" : "إلغاء هذه الشهادة؟"}
        description={
          revokeTarget
            ? `${revokeTarget.refNumber} — ${revokeTarget.traineeName}`
            : undefined
        }
        confirmLabel={locale === "en" ? "Revoke" : "إلغاء"}
        destructive
        loading={revoking}
        onConfirm={() => void handleRevoke()}
      />

      <FormDialog
        open={verifyTarget !== null}
        onOpenChange={(o) => !o && setVerifyTarget(null)}
        title={t("certificates.verify")}
        icon={QrCode}
        size="md"
      >
        <div className="space-y-4">
          {/* Visual QR placeholder — a real QR lib can be plugged in here. */}
          <div className="flex h-36 w-36 mx-auto items-center justify-center rounded-xl border-2 border-dashed border-primary/40 bg-primary/5">
            <QrCode className="h-14 w-14 text-primary/60" />
          </div>

          <Field label={t("certificates.verificationUrl")}>
            <Input readOnly value={verifyTarget?.verificationToken ? verifyUrl(verifyTarget.verificationToken) : ""} onFocus={(e) => e.target.select()} />
          </Field>

          <div className="grid grid-cols-2 gap-4 border-t pt-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">{t("certificates.certificateNumber")}</div>
              <div className="font-mono font-medium">{verifyTarget?.refNumber}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("certificates.verificationCount")}</div>
              <div className="font-medium tabular-nums">{verifyTarget?.verificationCount ?? 0}</div>
            </div>
          </div>
        </div>
      </FormDialog>
    </div>
  );
}
