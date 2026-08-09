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
import { BadgeCheck, Download, QrCode, Calendar, Building2, AlertCircle, Ban, Loader2, Lock, Unlock, Eye } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api, downloadFile } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";
import { QrImage } from "@/components/common/qr-image";
import { buildVerifyUrl } from "@/lib/qr/urls";
import { CertificatePreviewDialog } from "@/components/certificates/certificate-preview-dialog";

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
  releaseStatus?: string;
  releasedAt?: string | null;
  downloadedAt?: string | null;
  professionVerified?: boolean;
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
  const [previewTarget, setPreviewTarget] = useState<Certificate | null>(null);

  const canEdit = user ? canPerformAction(user.permissions, "certificates", "edit") : false;

  // The human-facing verification page, not the raw JSON endpoint — this is the URL
  // printed on the certificate and encoded into its QR code.
  const verifyUrl = (token: string) =>
    buildVerifyUrl(typeof window === "undefined" ? "" : window.location.origin, token);

  const handleDownload = async (row: Certificate) => {
    // Contractors can only download if certificate is released
    if (user?.role === "CONTRACTOR" && row.releaseStatus !== "RELEASED" && row.releaseStatus !== "DOWNLOADED") {
      toast({ title: t("misc.error"), description: t("certRelease.warning.notReleased"), variant: "destructive" });
      return;
    }
    setDownloading(row.id);
    try {
      await downloadFile(`/certificates/${row.id}/generate-pdf`, `certificate-${row.refNumber}.pdf`);
      // Mark as downloaded if contractor
      if (user?.role === "CONTRACTOR") {
        await api.post(`/certificates/${row.id}/mark-downloaded`, {}).catch(() => {});
        refetch();
      }
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
    { key: "status", header: t("certificates.status"), cell: (r) => (
      <div className="flex items-center gap-1.5">
        <StatusBadge status={r.status} />
        {r.releaseStatus && r.releaseStatus !== "RELEASED" && r.releaseStatus !== "DOWNLOADED" && user?.role === "CONTRACTOR" && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-amber-600 font-medium" title={t("certRelease.warning.notReleased")}>
            <Lock className="h-3 w-3" />
            {t("certRelease.locked.icon")}
          </span>
        )}
        {r.releaseStatus === "RELEASED" && (
          <span className="inline-flex items-center gap-0.5 text-[10px] text-green-600 font-medium">
            <Unlock className="h-3 w-3" />
            {t("certRelease.released.icon")}
          </span>
        )}
      </div>
    )},
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
            disabled={downloading === r.id || (user?.role === "CONTRACTOR" && r.releaseStatus !== "RELEASED" && r.releaseStatus !== "DOWNLOADED")}
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
            title={t("certificates.preview")}
            onClick={() => setPreviewTarget(r)}
          >
            <Eye className="h-3.5 w-3.5" />
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
          {verifyTarget?.verificationToken ? (
            <QrImage
              value={verifyUrl(verifyTarget.verificationToken)}
              size={168}
              className="mx-auto border"
              label={t("certificates.verify")}
            />
          ) : (
            <div className="flex h-36 w-36 mx-auto items-center justify-center rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/20">
              <QrCode className="h-10 w-10 text-muted-foreground/40" />
            </div>
          )}

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

      <CertificatePreviewDialog
        cert={previewTarget}
        onOpenChange={(o) => {
          if (!o) setPreviewTarget(null);
        }}
        onDownload={previewTarget ? () => void handleDownload(previewTarget) : undefined}
      />
    </div>
  );
}
