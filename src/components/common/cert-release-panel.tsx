"use client";

// GCCLAB TMS — Certificate Release Panel
// =====================================================================
// Displays the release checklist for all certificates in a session.
// Coordinators can:
//   - View payment status + progress bar
//   - View attendance/exam/profession status per certificate
//   - Verify profession (if course requires it)
//   - Release certificates (when all requirements met)
//
// Contractors see a read-only view with locked certificates until released.
import { useState, useEffect, useCallback, Fragment } from "react";
import { useI18n } from "@/lib/i18n/context";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canPerformAction } from "@/lib/auth/permissions";
import { SearchableSelect, type SearchableSelectOption } from "@/components/ui/searchable-select";
import { api, downloadFile } from "@/lib/api/client";
import { CertificatePreviewDialog } from "@/components/certificates/certificate-preview-dialog";
import {
  CheckCircle2, XCircle, Lock, Unlock, Download, Loader2, AlertTriangle,
  FileText, ShieldCheck, RefreshCw, Plus, Clock, Eye,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ReleaseChecklistItem {
  key: string;
  label: string;
  labelAr: string;
  passed: boolean;
  details?: string;
  detailsAr?: string;
}

interface ReleaseChecklist {
  certificateId: string;
  certificateRef: string;
  traineeName: string;
  courseTitle: string;
  courseRequiresProfessionVerification: boolean;
  items: ReleaseChecklistItem[];
  readyForRelease: boolean;
  released: boolean;
  releaseStatus: string;
  missingRequirements: string[];
  missingRequirementsAr: string[];
  payment?: {
    totalAmount: number;
    paidAmount: number;
    remainingBalance: number;
    paymentPercentage: number;
    paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
    currency: string;
    invoiceRef?: string | null;
  };
}

interface SessionPayment {
  id: string;
  companyId: string;
  companyName: string;
  companyRef: string;
  totalAmount: number;
  paidAmount: number;
  remainingBalance: number;
  paymentPercentage: number;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  currency: string;
  sessionRef?: string | null;
  traineeCount?: number;
  invoiceRef?: string | null;
  invoiceIssuedAt?: string | null;
  invoiceDueDate?: string | null;
  verificationStatus?: string | null;
  verifiedAt?: string | null;
  verifiedByName?: string | null;
  printingReleased?: boolean | null;
  printingReleasedBy?: string | null;
  printingReleasedAt?: string | null;
  printingReleasedByName?: string | null;
  notes?: string | null;
}

interface CertReleasePanelProps {
  sessionId: string;
}

export function CertReleasePanel({ sessionId }: CertReleasePanelProps) {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState(false);
  const [releasePrintingBusy, setReleasePrintingBusy] = useState<string | null>(null);
  const [checklists, setChecklists] = useState<ReleaseChecklist[]>([]);
  const [payments, setPayments] = useState<SessionPayment[]>([]);
  const [companyRows, setCompanyRows] = useState<Array<{ companyId: string; companyName: string; companyRef: string | null; traineeCount: number }>>([]);
  const [companies, setCompanies] = useState<SearchableSelectOption[]>([]);
  // Payment form
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [viewPaymentId, setViewPaymentId] = useState<string | null>(null);
  const [paymentForm, setPaymentForm] = useState({
    companyId: "",
    totalAmount: "",
    paidAmount: "",
    invoiceRef: "",
    notes: "",
  });
  // Profession verify dialog
  const [verifyDialog, setVerifyDialog] = useState<{ certId: string; certRef: string; traineeName: string } | null>(null);
  const [verifyNotes, setVerifyNotes] = useState("");
  const [verifyAttachment, setVerifyAttachment] = useState("");
  const [previewCert, setPreviewCert] = useState<{ id: string; refNumber: string; traineeName: string; releaseStatus: string } | null>(null);

  const canRelease = user?.role === "COORDINATOR" || user?.role === "SUPER_ADMIN";
  const canEditPayments = canRelease;
  const isContractor = user?.role === "CONTRACTOR";

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [checks, pays, comps] = await Promise.all([
        api.get<ReleaseChecklist[]>(`/sessions/${sessionId}/release-checklist`).catch(() => []),
        canEditPayments ? api.get<SessionPayment[]>(`/sessions/${sessionId}/payments`).catch(() => []) : Promise.resolve([]),
        api
          .get<{ companies: Array<{ companyId: string; companyName: string | null; companyRef: string | null; traineeCount: number }> }>(
            `/sessions/${sessionId}/enrollments`,
          )
          .catch(() => ({ companies: [] })),
      ]);
      setChecklists(checks);
      setPayments(pays);
      const rows = (comps.companies ?? []).map((c) => ({
        companyId: c.companyId,
        companyName: c.companyName ?? c.companyId,
        companyRef: c.companyRef,
        traineeCount: c.traineeCount ?? 0,
      }));
      setCompanyRows(rows);
      setCompanies(
        rows.map((c) => ({
          value: c.companyId,
          label: c.companyRef ? `${c.companyName} (${c.companyRef})` : c.companyName,
          keywords: `${c.companyName} ${c.companyRef ?? ""}`.toLowerCase(),
        })),
      );
    } catch (e) {
      console.error("Failed to load release data:", e);
    } finally {
      setLoading(false);
    }
  }, [sessionId, canEditPayments]);

  useEffect(() => {
    const handle = setTimeout(() => { void load(); }, 0);
    return () => clearTimeout(handle);
  }, [load]);

  const handleRelease = async (companyId?: string) => {
    setReleasing(true);
    try {
      const res = await api.post<{ released: number; skipped: number }>(`/sessions/${sessionId}/release-certificates`, {
        ...(companyId ? { companyId } : {}),
      });
      toast({
        title: t("misc.success"),
        description: t("certRelease.success.released").replace("{count}", String(res.released)),
      });
      await load();
    } catch (e) {
      toast({
        title: t("misc.error"),
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setReleasing(false);
    }
  };

  const handleVerifyProfession = async (certId: string, verified: boolean) => {
    try {
      await api.post(`/certificates/${certId}/profession-verify`, {
        verified,
        notes: verifyNotes || undefined,
        attachmentUrl: verifyAttachment || undefined,
      });
      toast({ title: t("misc.success"), description: t("certRelease.success.professionVerified") });
      setVerifyDialog(null);
      setVerifyNotes("");
      setVerifyAttachment("");
      await load();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleSavePayment = async () => {
    try {
      await api.post(`/sessions/${sessionId}/payments`, {
        companyId: paymentForm.companyId,
        totalAmount: parseFloat(paymentForm.totalAmount) || 0,
        paidAmount: parseFloat(paymentForm.paidAmount) || 0,
        invoiceRef: paymentForm.invoiceRef || undefined,
        notes: paymentForm.notes || undefined,
      });
      toast({ title: t("misc.success"), description: t("misc.saveSuccess") });
      setShowPaymentForm(false);
      setPaymentForm({ companyId: "", totalAmount: "", paidAmount: "", invoiceRef: "", notes: "" });
      await load();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleReleasePrinting = async (paymentId: string) => {
    setReleasePrintingBusy(paymentId);
    try {
      await api.post(`/session-payments/${paymentId}/release-printing`, {});
      toast({ title: t("misc.success"), description: t("certRelease.success.printingReleased") });
      await load();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setReleasePrintingBusy(null);
    }
  };

  const handleDownload = async (cl: ReleaseChecklist) => {
    try {
      await downloadFile(`/certificates/${cl.certificateId}/generate-pdf`, `certificate-${cl.certificateRef}.pdf`);
      if (isContractor && cl.released) {
        await api.post(`/certificates/${cl.certificateId}/mark-downloaded`, {}).catch(() => {});
      }
      await load();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const paymentByCompany = new Map(payments.map((p) => [p.companyId, p]));

  return (
    <div className="space-y-4">
      {/* Payments section (coordinator only) */}
      {canEditPayments && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {t("certRelease.tab.payments")}
            </h3>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void load()}>
                <RefreshCw className="h-3 w-3 me-1" />
                {locale === "ar" ? "تحديث" : "Refresh"}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowPaymentForm(!showPaymentForm)}>
                {showPaymentForm ? t("action.cancel") : t("action.create")}
              </Button>
            </div>
          </div>

          {/* Payment form */}
          {showPaymentForm && (
            <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">{locale === "ar" ? "الشركة" : "Company"}</Label>
                  <SearchableSelect
                    value={paymentForm.companyId}
                    onChange={(v) => setPaymentForm({ ...paymentForm, companyId: v })}
                    options={companies}
                    placeholder={locale === "ar" ? "اختر الشركة…" : "Select company…"}
                    searchPlaceholder={locale === "ar" ? "بحث عن شركة…" : "Search company…"}
                    emptyText={locale === "ar" ? "لا توجد شركات" : "No companies"}
                    className="h-8"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t("certRelease.field.totalAmount")}</Label>
                  <Input
                    type="number"
                    value={paymentForm.totalAmount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, totalAmount: e.target.value })}
                    placeholder="20000"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t("certRelease.field.paidAmount")}</Label>
                  <Input
                    type="number"
                    value={paymentForm.paidAmount}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paidAmount: e.target.value })}
                    placeholder="12000"
                    className="h-8 text-xs"
                  />
                </div>
                <div>
                  <Label className="text-xs">{t("certRelease.field.invoiceRef")}</Label>
                  <Input
                    value={paymentForm.invoiceRef}
                    onChange={(e) => setPaymentForm({ ...paymentForm, invoiceRef: e.target.value })}
                    placeholder="INV-001"
                    className="h-8 text-xs"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">{t("certRelease.field.notes")}</Label>
                <Input
                  value={paymentForm.notes}
                  onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })}
                  className="h-8 text-xs"
                />
              </div>
              <Button size="sm" onClick={() => void handleSavePayment()} disabled={!paymentForm.companyId || !paymentForm.totalAmount}>
                {t("action.save")}
              </Button>
            </div>
          )}

          {/* Payment list */}
          {companyRows.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t("certRelease.payment.noRecord")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("certRelease.field.company")}</TableHead>
                  <TableHead>{t("certRelease.field.traineeCount")}</TableHead>
                  <TableHead>{t("certRelease.field.paymentStatus")}</TableHead>
                  <TableHead>{t("certRelease.field.verification")}</TableHead>
                  <TableHead>{t("certRelease.field.printing")}</TableHead>
                  <TableHead className="text-end">{t("action.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companyRows.map((c) => {
                  const p = paymentByCompany.get(c.companyId);
                  return (
                    <Fragment key={c.companyId}>
                      <TableRow>
                        <TableCell>
                          <div className="font-medium">{c.companyName}</div>
                          <div className="text-xs text-muted-foreground font-mono">{c.companyRef ?? "—"}</div>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm font-semibold tabular-nums">{c.traineeCount}</span>
                        </TableCell>
                        <TableCell>
                          {p
                            ? <PaymentStatusBadge status={p.paymentStatus} t={t} />
                            : (
                              <span className="inline-flex items-center rounded-full border border-muted bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                                {t("certRelease.payment.noRecordShort")}
                              </span>
                            )}
                        </TableCell>
                        <TableCell>
                          {p
                            ? <VerificationBadge status={p.verificationStatus ?? "PENDING"} t={t} />
                            : <span className="text-xs text-muted-foreground">—</span>}
                        </TableCell>
                        <TableCell>
                          {p
                            ? <PrintingBadge released={p.printingReleased ?? false} t={t} />
                            : <PrintingBadge released={false} t={t} />}
                        </TableCell>
                        <TableCell className="text-end">
                          <div className="flex items-center justify-end gap-1">
                            {p ? (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => setViewPaymentId(viewPaymentId === p.id ? null : p.id)}
                                >
                                  {viewPaymentId === p.id ? t("action.cancel") : t("certRelease.viewRecord")}
                                </Button>
                                {canEditPayments && p.paymentStatus === "PAID" && !p.printingReleased && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-7 px-2 text-xs"
                                    disabled={releasePrintingBusy === p.id}
                                    onClick={() => void handleReleasePrinting(p.id)}
                                  >
                                    {releasePrintingBusy === p.id ? (
                                      <Loader2 className="h-3 w-3 me-1 animate-spin" />
                                    ) : (
                                      <Unlock className="h-3 w-3 me-1" />
                                    )}
                                    {locale === "ar" ? "السماح بالطباعة" : "Release printing"}
                                  </Button>
                                )}
                              </>
                            ) : (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs"
                                onClick={() => {
                                  setPaymentForm((f) => ({ ...f, companyId: c.companyId }));
                                  setShowPaymentForm(true);
                                }}
                              >
                                <Plus className="h-3 w-3 me-1" />
                                {locale === "ar" ? "إنشاء سجل" : "Create record"}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {p && viewPaymentId === p.id && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/30">
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-3 py-2">
                              <Field label={t("certRelease.field.company")} value={`${p.companyName} (${p.companyRef})`} />
                              <Field label={t("certRelease.field.session")} value={p.sessionRef ?? "—"} mono />
                              <Field label={t("certRelease.field.traineeCount")} value={String(p.traineeCount ?? c.traineeCount ?? "—")} />
                              <Field label={t("certRelease.field.invoiceRef")} value={p.invoiceRef ?? "—"} mono />
                              <Field label={t("certRelease.payment.total")} value={`${p.totalAmount.toLocaleString()} ${p.currency}`} />
                              <Field label={t("certRelease.payment.paid")} value={`${p.paidAmount.toLocaleString()} ${p.currency}`} />
                              <Field label={t("certRelease.payment.remaining")} value={`${p.remainingBalance.toLocaleString()} ${p.currency}`} />
                              <Field label={t("certRelease.field.paymentStatus")} node={<PaymentStatusBadge status={p.paymentStatus} t={t} />} />
                              <Field label={t("certRelease.field.verificationStatus")} node={<VerificationBadge status={p.verificationStatus ?? "PENDING"} t={t} />} />
                              <Field label={t("certRelease.field.verifiedBy")} value={p.verifiedByName ?? "—"} />
                              <Field label={t("certRelease.field.verificationDate")} value={p.verifiedAt ? new Date(p.verifiedAt).toLocaleDateString() : "—"} />
                              <Field label={t("certRelease.field.printingReleased")} node={<PrintingBadge released={p.printingReleased ?? false} t={t} />} />
                              <Field label={t("certRelease.field.releasedBy")} value={p.printingReleasedByName ?? "—"} />
                              <Field label={t("certRelease.field.releasedAt")} value={p.printingReleasedAt ? new Date(p.printingReleasedAt).toLocaleDateString() : "—"} />
                              <Field label={t("certRelease.field.invoiceDate")} value={p.invoiceIssuedAt ? new Date(p.invoiceIssuedAt).toLocaleDateString() : "—"} />
                              <Field label={t("certRelease.field.dueDate")} value={p.invoiceDueDate ? new Date(p.invoiceDueDate).toLocaleDateString() : "—"} />
                              {p.notes && <Field label={t("certRelease.field.notes")} value={p.notes} wide />}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {/* Certificates checklist */}
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            {t("certRelease.title")}
          </h3>
          {canRelease && checklists.length > 0 && (
            <Button
              size="sm"
              onClick={() => void handleRelease()}
              disabled={releasing || !checklists.some((c) => c.readyForRelease && !c.released)}
            >
              {releasing ? <Loader2 className="h-3 w-3 animate-spin me-1" /> : <Unlock className="h-3 w-3 me-1" />}
              {releasing ? t("certRelease.button.releasing") : t("certRelease.button.release")}
            </Button>
          )}
        </div>

        {checklists.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {locale === "ar" ? "لا توجد شهادات في هذه الجلسة." : "No certificates in this session."}
          </p>
        ) : (
          <div className="space-y-3">
            {checklists.map((cl) => (
              <div key={cl.certificateId} className="rounded-lg border p-3 space-y-2">
                {/* Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ReleaseStatusBadge status={cl.releaseStatus} t={t} />
                    <span className="text-sm font-medium">{cl.traineeName}</span>
                    <span className="text-xs text-muted-foreground font-mono">{cl.certificateRef}</span>
                  </div>
                  <div className="flex gap-1">
                    {/* Preview button (all roles) */}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() =>
                        setPreviewCert({
                          id: cl.certificateId,
                          refNumber: cl.certificateRef,
                          traineeName: cl.traineeName,
                          releaseStatus: cl.releaseStatus,
                        })
                      }
                    >
                      <Eye className="h-3 w-3 me-1" />
                      {t("certificates.preview")}
                    </Button>
                    {/* Profession verify button (coordinator + course requires it) */}
                    {canRelease && cl.courseRequiresProfessionVerification && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => {
                          const item = cl.items.find((i) => i.key === "profession_verified");
                          if (item?.passed) {
                            void handleVerifyProfession(cl.certificateId, false);
                          } else {
                            setVerifyDialog({ certId: cl.certificateId, certRef: cl.certificateRef, traineeName: cl.traineeName });
                          }
                        }}
                      >
                        <ShieldCheck className="h-3 w-3 me-1" />
                        {cl.items.find((i) => i.key === "profession_verified")?.passed
                          ? t("certRelease.button.unverifyProfession")
                          : t("certRelease.button.verifyProfession")}
                      </Button>
                    )}
                    {/* Download button (contractor + released, coordinator anytime) */}
                    {(canRelease || (isContractor && cl.released)) && (
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void handleDownload(cl)}>
                        <Download className="h-3 w-3 me-1" />
                        {t("certRelease.button.download")}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Checklist items */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                  {cl.items.map((item) => (
                    <div key={item.key} className="flex items-center gap-2 text-xs">
                      {item.passed ? (
                        <CheckCircle2 className="h-3 w-3 text-green-600 shrink-0" />
                      ) : (
                        <XCircle className="h-3 w-3 text-red-600 shrink-0" />
                      )}
                      <span className={cn(item.passed ? "text-foreground" : "text-red-600 font-medium")}>
                        {locale === "ar" ? item.labelAr : item.label}
                      </span>
                      {item.details && (
                        <span className="text-muted-foreground truncate">— {item.details}</span>
                      )}
                    </div>
                  ))}
                </div>

                {/* Missing requirements warning */}
                {!cl.readyForRelease && !cl.released && (
                  <div className="flex items-start gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 p-2 text-xs">
                    <AlertTriangle className="h-3 w-3 text-amber-600 shrink-0 mt-0.5" />
                    <div>
                      <span className="text-amber-700 dark:text-amber-400 font-medium">{t("certRelease.warning.missing")}</span>
                      <span className="text-amber-600 dark:text-amber-500 ms-1">
                        {(locale === "ar" ? cl.missingRequirementsAr : cl.missingRequirements).join(", ")}
                      </span>
                    </div>
                  </div>
                )}

                {/* Locked warning for contractor */}
                {isContractor && !cl.released && (
                  <div className="flex items-center gap-2 rounded-md bg-red-50 dark:bg-red-950/30 p-2 text-xs">
                    <Lock className="h-3 w-3 text-red-600 shrink-0" />
                    <span className="text-red-700 dark:text-red-400">{t("certRelease.warning.notReleased")}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Profession verify dialog */}
      {verifyDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setVerifyDialog(null)}>
          <Card className="p-4 max-w-md w-full mx-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold">{t("certRelease.button.verifyProfession")}</h3>
            <p className="text-xs text-muted-foreground">
              {verifyDialog.traineeName} ({verifyDialog.certRef})
            </p>
            <div>
              <Label className="text-xs">{t("certRelease.field.verificationNotes")}</Label>
              <Textarea
                value={verifyNotes}
                onChange={(e) => setVerifyNotes(e.target.value)}
                rows={2}
                className="text-xs"
              />
            </div>
            <div>
              <Label className="text-xs">{t("certRelease.field.attachment")}</Label>
              <Input
                value={verifyAttachment}
                onChange={(e) => setVerifyAttachment(e.target.value)}
                placeholder="https://..."
                className="text-xs"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setVerifyDialog(null)}>{t("action.cancel")}</Button>
              <Button size="sm" onClick={() => void handleVerifyProfession(verifyDialog.certId, true)}>
                <CheckCircle2 className="h-3 w-3 me-1" />
                {t("certRelease.button.verifyProfession")}
              </Button>
            </div>
          </Card>
        </div>
      )}

      <CertificatePreviewDialog
        cert={previewCert}
        onOpenChange={(o) => { if (!o) setPreviewCert(null); }}
        onDownload={previewCert ? () => void handleDownload(checklists.find((c) => c.certificateId === previewCert.id)!) : undefined}
      />
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────

type TFunc = ReturnType<typeof useI18n>["t"];

function Field({
  label,
  value,
  node,
  mono,
  wide,
}: {
  label: string;
  value?: React.ReactNode;
  node?: React.ReactNode;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "col-span-full" : undefined}>
      <div className="text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono font-medium" : "font-medium"}>{node ?? value ?? "—"}</div>
    </div>
  );
}

function VerificationBadge({ status, t }: { status: string; t: TFunc }) {
  const map: Record<string, { cls: string; label: string }> = {
    VERIFIED: { cls: "border-green-600/20 bg-green-600/10 text-green-600", label: t("certRelease.verification.VERIFIED") },
    PARTIALLY_VERIFIED: { cls: "border-amber-600/20 bg-amber-600/10 text-amber-600", label: t("certRelease.verification.PARTIALLY_VERIFIED") },
    PENDING: { cls: "border-muted bg-muted text-muted-foreground", label: t("certRelease.verification.PENDING") },
  };
  const s = map[status] ?? map.PENDING;
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", s.cls)}>
      {status === "VERIFIED" ? <CheckCircle2 className="h-3 w-3 me-1" /> : <Clock className="h-3 w-3 me-1" />}
      {s.label}
    </span>
  );
}

function PrintingBadge({ released, t }: { released: boolean; t: TFunc }) {
  return released ? (
    <span className="inline-flex items-center rounded-full border border-blue-600/20 bg-blue-600/10 px-2 py-0.5 text-[10px] font-medium text-blue-600">
      <Unlock className="h-3 w-3 me-1" />
      {t("certRelease.printing.available")}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-full border border-muted bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      <Lock className="h-3 w-3 me-1" />
      {t("certRelease.printing.notAvailable")}
    </span>
  );
}

function PaymentStatusBadge({ status, t }: { status: "UNPAID" | "PARTIALLY_PAID" | "PAID"; t: TFunc }) {
  const variant = status === "PAID" ? "default" : status === "PARTIALLY_PAID" ? "secondary" : "destructive";
  return (
    <Badge variant={variant} className="text-[10px]">
      {t(`certRelease.payment.status.${status}` as never)}
    </Badge>
  );
}

function ReleaseStatusBadge({ status, t }: { status: string; t: TFunc }) {
  const colors: Record<string, string> = {
    DRAFT: "bg-gray-100 text-gray-700 dark:bg-gray-900 dark:text-gray-300",
    READY_FOR_RELEASE: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
    RELEASED: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300",
    DOWNLOADED: "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300",
  };
  const icons: Record<string, React.ReactNode> = {
    DRAFT: <Lock className="h-3 w-3" />,
    READY_FOR_RELEASE: <Clock className="h-3 w-3" />,
    RELEASED: <Unlock className="h-3 w-3" />,
    DOWNLOADED: <Download className="h-3 w-3" />,
  };
  return (
    <span className={cn("inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded", colors[status] ?? colors.DRAFT)}>
      {icons[status] ?? icons.DRAFT}
      {t(`certRelease.status.${status}` as never)}
    </span>
  );
}
