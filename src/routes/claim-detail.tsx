"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  FileText, ArrowLeft, Send, CheckCircle2, RotateCcw, Lock,
  Download, AlertCircle, Pencil, Trash2, Loader2, Clock, XCircle,
  Maximize2, Minimize2, Printer,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useAppStore } from "@/lib/store/app-store";
import { useToast } from "@/hooks/use-toast";
import { trainerName } from "@/lib/i18n/trainer-name";

interface ClaimItem {
  id: string;
  sessionId: string;
  sessionRef: string;
  date: string;
  courseCode: string | null;
  courseTitle: string | null;
  location: string | null;
  locationFlagged: boolean;
  flagReason: string | null;
  shift: string | null;
  actualHours: number;
  coordinatorName: string | null;
  originalValue: number;
  adjustedValue: number | null;
  adjustmentReason: string | null;
  finalValue: number;
  unit: string;
  rate: number | null;
  amount: number | null;
  included: boolean;
}

interface ClaimDetail {
  id: string;
  refNumber: string;
  claimType: string;
  engagementType: string;
  status: string;
  periodFrom: string;
  periodTo: string;
  dailyAllowance: number | null;
  mainLocation: string | null;
  notes: string | null;
  totalHours: number;
  totalDays: number;
  totalAmount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  trainer: {
    id: string;
    refNumber: string;
    nameEn: string;
    nameAr: string | null;
    engagementType: string;
  };
  coordinator?: { id: string; fullName: string } | null;
  items: ClaimItem[];
  returnReason: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  finalizedAt: string | null;
  employeeId?: string;
  employeeJobTitle?: string;
  employeeDepartment?: string;
  employeeProject?: string;
  employeeLineManager?: string;
  normalWorkingHoursPerDay?: number;
  estimatedOtPerDay?: number;
  reason?: string;
  requestedBy?: string;
  lineManagerDecision?: string;
  lineManagerChecklist?: string;
  lineManagerComments?: string;
  lineManagerSignatureBy?: string;
  lineManagerSignatureAt?: string;
  qhseAssessment?: string;
  qhseControls?: string;
  qhseSignatureBy?: string;
  qhseSignatureAt?: string;
  hrDecision?: string;
  hrMaxApprovedOt?: number;
  hrPeriodFrom?: string;
  hrPeriodTo?: string;
  hrComments?: string;
  hrSignatureBy?: string;
  hrSignatureAt?: string;
}

const STATUS_STYLES: Record<string, string> = {
  DRAFT: "bg-gray-100 text-gray-700",
  GENERATED: "bg-blue-100 text-blue-700",
  SUBMITTED: "bg-amber-100 text-amber-700",
  PENDING_COORDINATOR_APPROVAL: "bg-amber-100 text-amber-700",
  RETURNED: "bg-orange-100 text-orange-700",
  REJECTED: "bg-red-100 text-red-700",
  LINE_MANAGER_REVIEW: "bg-indigo-100 text-indigo-700",
  QHSE_REVIEW: "bg-cyan-100 text-cyan-700",
  HR_REVIEW: "bg-purple-100 text-purple-700",
  APPROVED: "bg-green-100 text-green-700",
  FINAL: "bg-emerald-100 text-emerald-700",
};

export function ClaimDetailRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { navigate, routeParam } = useAppStore();
  const claimId = routeParam;

  const [claim, setClaim] = useState<ClaimDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Action states
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnReason, setReturnReason] = useState("");
  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustTarget, setAdjustTarget] = useState<ClaimItem | null>(null);
  const [adjustValue, setAdjustValue] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  // Employee info form (for acknowledge step)
  const [empId, setEmpId] = useState("");
  const [empJobTitle, setEmpJobTitle] = useState("");
  const [empDepartment, setEmpDepartment] = useState("");
  const [empProject, setEmpProject] = useState("");
  const [empLineManager, setEmpLineManager] = useState("");
  const [normalHours, setNormalHours] = useState(8);
  const [estimatedOt, setEstimatedOt] = useState(4);
  const [requestedBy, setRequestedBy] = useState("");
  const [reason, setReason] = useState("");

  // Line Manager review
  const [lmDecision, setLmDecision] = useState("");
  const [lmChecklist, setLmChecklist] = useState("");
  const [lmComments, setLmComments] = useState("");

  // QHSE review
  const [qhseAssessment, setQhseAssessment] = useState("");
  const [qhseControls, setQhseControls] = useState("");

  // HR review
  const [hrDecision, setHrDecision] = useState("");
  const [hrMaxOt, setHrMaxOt] = useState(0);
  const [hrPeriodFrom, setHrPeriodFrom] = useState("");
  const [hrPeriodTo, setHrPeriodTo] = useState("");
  const [hrComments, setHrComments] = useState("");

  // Fullscreen / Print
  const [fullscreen, setFullscreen] = useState(false);

  const fetchClaim = async () => {
    if (!claimId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ClaimDetail>(`/claims/${claimId}`);
      setClaim(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchClaim(); }, [claimId]);

  const runAction = async (action: string, body?: Record<string, unknown>) => {
    setActionLoading(true);
    try {
      await api.post(`/claims/${claimId}/${action}`, body ?? {});
      toast({ title: t("misc.success"), variant: "default" });
      await fetchClaim();
    } catch (err) {
      toast({ title: t("misc.error"), description: (err as Error).message, variant: "destructive" });
    } finally {
      setActionLoading(false);
      setConfirmAction(null);
    }
  };

  const handleExport = (format: "xlsx" | "pdf") => {
    window.open(`/api/claims/${claimId}/export?format=${format}`, "_blank");
  };

  const handlePrint = () => {
    window.print();
  };

  const handleToggleItem = async (itemId: string) => {
    try {
      await api.post(`/claims/${claimId}/toggle-item`, { itemId });
      await fetchClaim();
    } catch (err) {
      toast({ title: t("misc.error"), description: (err as Error).message, variant: "destructive" });
    }
  };

  const refresh = async () => { await fetchClaim(); };

  const forwardReview = async () => {
    if (!confirm(t("claims.actions.forwardReviewConfirm"))) return;
    await fetch(`/api/claims/${claimId}/forward-review`, { method: "POST" });
    refresh();
  };

  const acknowledge = async () => {
    await fetch(`/api/claims/${claimId}/acknowledge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accepted: true,
        empId,
        empJobTitle,
        empDepartment,
        empProject,
        empLineManager,
        requestedBy,
        reason,
        normalWorkingHours: normalHours,
        estimatedOtPerDay: estimatedOt,
      }),
    });
    refresh();
  };

  const submitLmReview = async () => {
    if (!lmDecision) return;
    await fetch(`/api/claims/${claimId}/line-manager`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: lmDecision, checklist: lmChecklist, comments: lmComments }),
    });
    refresh();
  };

  const submitQhseReview = async () => {
    if (!qhseAssessment) return;
    await fetch(`/api/claims/${claimId}/qhse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessment: qhseAssessment, controls: qhseControls }),
    });
    refresh();
  };

  const submitHrReview = async () => {
    if (!hrDecision) return;
    await fetch(`/api/claims/${claimId}/hr-review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        decision: hrDecision,
        maxApprovedOt: hrMaxOt || undefined,
        periodFrom: hrPeriodFrom || undefined,
        periodTo: hrPeriodTo || undefined,
        comments: hrComments || undefined,
      }),
    });
    refresh();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !claim) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" onClick={() => navigate("claims")}>
          <ArrowLeft className="h-4 w-4 me-1.5" />{t("action.back")}
        </Button>
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error ?? t("misc.notFound")}
        </div>
      </div>
    );
  }

  const status = claim.status;
  const canSubmit = status === "DRAFT" || status === "GENERATED" || status === "RETURNED";
  const canApprove = status === "SUBMITTED" || status === "PENDING_COORDINATOR_APPROVAL" || status === "HR_REVIEW";
  const canFinalize = status === "APPROVED";
  const canReturn = status === "SUBMITTED" || status === "PENDING_COORDINATOR_APPROVAL";
  const canReject = status === "SUBMITTED" || status === "PENDING_COORDINATOR_APPROVAL";
  const canAdjust = status === "DRAFT" || status === "GENERATED" || status === "RETURNED";
  const canDelete = status === "DRAFT";
  const canRegenerate = status === "DRAFT" || status === "GENERATED" || status === "RETURNED";

  const statusLabel = (s: string) => t(`claims.status.${s}` as never);
  const typeLabel = claim.claimType === "OVERTIME" ? t("claims.type.OVERTIME") : t("claims.type.BUSINESS_MISSION");

  const canToggle = status === "GENERATED" || status === "RETURNED";

  const items: ClaimItem[] = claim.items;
  const includedCount = items.filter((i) => i.included).length;

  const columns: Column<ClaimItem>[] = [
    ...(canToggle ? [{
      key: "included",
      header: t("claims.items.included"),
      className: "w-10",
      cell: (r: ClaimItem) => (
        <Checkbox
          checked={r.included}
          onCheckedChange={() => void handleToggleItem(r.id)}
        />
      ),
    }] : []),
    {
      key: "date",
      header: t("claims.items.date"),
      cell: (r) => <span className="text-xs">{new Date(r.date).toLocaleDateString()}</span>,
    },
    {
      key: "sessionRef",
      header: t("claims.items.sessionRef"),
      cell: (r) => <span className="font-mono text-xs">{r.sessionRef}</span>,
    },
    {
      key: "courseCode",
      header: t("claims.items.courseCode"),
      cell: (r) => <span className="text-xs">{r.courseCode ?? "—"}</span>,
    },
    {
      key: "courseTitle",
      header: t("claims.items.courseTitle"),
      cell: (r) => <span className="text-xs truncate max-w-[180px] block">{r.courseTitle ?? "—"}</span>,
    },
    {
      key: "location",
      header: t("claims.items.location"),
      cell: (r) => (
        <span className={`text-xs ${r.locationFlagged ? "text-amber-600 font-medium" : ""}`}>
          {r.location ?? "—"}
          {r.locationFlagged ? " ⚠" : ""}
        </span>
      ),
    },
    {
      key: "shift",
      header: t("claims.items.shift"),
      cell: (r) => <span className="text-xs">{r.shift ?? "—"}</span>,
    },
    {
      key: "actualHours",
      header: t("claims.items.actualHours"),
      cell: (r) => <span className="text-xs tabular-nums">{r.actualHours}</span>,
    },
    {
      key: "coordinatorName",
      header: t("claims.items.coordinator"),
      cell: (r) => <span className="text-xs">{r.coordinatorName ?? "—"}</span>,
    },
    {
      key: "finalValue",
      header: t("claims.items.finalValue"),
      cell: (r) => (
        <div className="text-xs tabular-nums">
          {r.finalValue} {r.unit}
          {r.adjustedValue !== null && (
            <span className="text-muted-foreground ml-1">(was {r.originalValue})</span>
          )}
        </div>
      ),
    },
    {
      key: "amount",
      header: t("claims.items.amount"),
      cell: (r) => (
        <span className="text-xs tabular-nums">
          {r.amount !== null ? `${r.amount} ${claim.currency}` : "—"}
        </span>
      ),
    },
  ];

  if (canAdjust) {
    columns.push({
      key: "adjust",
      header: "",
      className: "w-10",
      cell: (r) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2"
          onClick={() => {
            setAdjustTarget(r);
            setAdjustValue(String(r.adjustedValue ?? r.originalValue));
            setAdjustReason("");
            setAdjustDialogOpen(true);
          }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      ),
    });
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${claim.refNumber} — ${typeLabel}`}
        subtitle={trainerName(claim.trainer, locale)}
        icon={FileText}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <Button variant="ghost" size="sm" onClick={() => navigate("claims")}>
              <ArrowLeft className="h-4 w-4 me-1" />{t("action.back")}
            </Button>
            <Badge className={STATUS_STYLES[status] ?? STATUS_STYLES.DRAFT}>
              {statusLabel(status)}
            </Badge>

            {/* Export / Print */}
            <Button variant="outline" size="sm" onClick={() => handleExport("xlsx")}>
              <Download className="h-3.5 w-3.5 me-1" />Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => handleExport("pdf")}>
              <Download className="h-3.5 w-3.5 me-1" />PDF
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint}>
              <Printer className="h-3.5 w-3.5 me-1" />{t("claims.actions.print")}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setFullscreen(!fullscreen)}>
              {fullscreen ? <Minimize2 className="h-3.5 w-3.5 me-1" /> : <Maximize2 className="h-3.5 w-3.5 me-1" />}
              {fullscreen ? t("claims.actions.expand") : t("claims.actions.expand")}
            </Button>

            {/* Regenerate */}
            {canRegenerate && (
              <Button
                variant="outline"
                size="sm"
                disabled={actionLoading}
                onClick={() => void runAction("generate")}
              >
                {actionLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin me-1" /> : <RotateCcw className="h-3.5 w-3.5 me-1" />}
                {t("claims.actions.regenerate")}
              </Button>
            )}

            {/* Submit */}
            {canSubmit && (
              <Button
                size="sm"
                disabled={actionLoading || includedCount === 0}
                onClick={() => setConfirmAction("submit")}
              >
                <Send className="h-3.5 w-3.5 me-1" />{t("claims.actions.submit")}
              </Button>
            )}

            {/* Approve */}
            {canApprove && (
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700"
                disabled={actionLoading}
                onClick={() => setConfirmAction("approve")}
              >
                <CheckCircle2 className="h-3.5 w-3.5 me-1" />{t("claims.actions.approve")}
              </Button>
            )}

            {/* Return */}
            {canReturn && (
              <Button
                variant="outline"
                size="sm"
                disabled={actionLoading}
                onClick={() => { setReturnReason(""); setReturnDialogOpen(true); }}
              >
                <RotateCcw className="h-3.5 w-3.5 me-1" />{t("claims.actions.return")}
              </Button>
            )}

            {/* Reject (permanent) */}
            {canReject && (
              <Button
                variant="destructive"
                size="sm"
                disabled={actionLoading}
                onClick={() => { setReturnReason(""); setConfirmAction("reject"); }}
              >
                <XCircle className="h-3.5 w-3.5 me-1" />{t("claims.actions.reject")}
              </Button>
            )}

            {/* Forward to Line Manager */}
            {claim.status === "SUBMITTED" && claim.claimType === "OVERTIME" && (
              <Button
                variant="outline"
                size="sm"
                disabled={actionLoading}
                onClick={() => void forwardReview()}
              >
                {t("claims.actions.forwardReview")}
              </Button>
            )}

            {/* Finalize */}
            {canFinalize && (
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700"
                disabled={actionLoading}
                onClick={() => setConfirmAction("finalize")}
              >
                <Lock className="h-3.5 w-3.5 me-1" />{t("claims.actions.finalize")}
              </Button>
            )}

            {/* Delete */}
            {canDelete && (
              <Button
                variant="destructive"
                size="sm"
                disabled={actionLoading}
                onClick={() => setConfirmAction("delete")}
              >
                <Trash2 className="h-3.5 w-3.5 me-1" />{t("action.delete")}
              </Button>
            )}
          </div>
        }
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{t("claims.period")}</div>
          <div className="text-sm font-medium mt-0.5">
            {new Date(claim.periodFrom).toLocaleDateString()} → {new Date(claim.periodTo).toLocaleDateString()}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{t("claims.totalHours")}</div>
          <div className="text-sm font-medium mt-0.5">
            {claim.claimType === "OVERTIME" ? `${claim.totalHours}h` : `${claim.totalDays}d`}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{t("claims.totalAmount")}</div>
          <div className="text-sm font-medium mt-0.5 tabular-nums">
            {claim.totalAmount} {claim.currency}
          </div>
        </div>
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground">{t("claims.items")}</div>
          <div className="text-sm font-medium mt-0.5">{includedCount} / {items.length}</div>
        </div>
      </div>

      {/* Coordinator info */}
      {claim.coordinator && (
        <div className="rounded-md border p-3 bg-blue-50/50">
          <div className="text-xs text-muted-foreground">{t("claims.coordinator")}</div>
          <div className="text-sm font-medium mt-0.5">{claim.coordinator.fullName}</div>
        </div>
      )}

      {/* Return/Rejection reason banner */}
      {claim.returnReason && (
        <div className="flex items-start gap-2 rounded-md border border-orange-300 bg-orange-50 p-3 text-sm text-orange-800">
          <Clock className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">{t("claims.actions.return")}</div>
            <div className="mt-0.5">{claim.returnReason}</div>
          </div>
        </div>
      )}

      {/* Notes */}
      {claim.notes && (
        <div className="rounded-md border p-3">
          <div className="text-xs text-muted-foreground mb-1">{t("claims.new.notes")}</div>
          <div className="text-sm">{claim.notes}</div>
        </div>
      )}

      {/* Employee acknowledgment form */}
      {claim.engagementType === "EMPLOYEE" && (claim.status === "GENERATED" || claim.status === "RETURNED") && (
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-semibold mb-3">{t("claims.employee.acknowledgment")}</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label className="text-xs">{t("claims.employee.employeeId")}</Label>
              <Input className="mt-1" value={empId} onChange={(e) => setEmpId(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t("claims.employee.jobTitle")}</Label>
              <Input className="mt-1" value={empJobTitle} onChange={(e) => setEmpJobTitle(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t("claims.employee.department")}</Label>
              <Input className="mt-1" value={empDepartment} onChange={(e) => setEmpDepartment(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t("claims.employee.project")}</Label>
              <Input className="mt-1" value={empProject} onChange={(e) => setEmpProject(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t("claims.employee.lineManager")}</Label>
              <Input className="mt-1" value={empLineManager} onChange={(e) => setEmpLineManager(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t("claims.employee.requestedBy")}</Label>
              <Input className="mt-1" value={requestedBy} onChange={(e) => setRequestedBy(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t("claims.employee.normalHours")}</Label>
              <Input className="mt-1" type="number" value={normalHours} onChange={(e) => setNormalHours(Number(e.target.value))} />
            </div>
            <div>
              <Label className="text-xs">{t("claims.employee.estimatedOt")}</Label>
              <Input className="mt-1" type="number" value={estimatedOt} onChange={(e) => setEstimatedOt(Number(e.target.value))} />
            </div>
          </div>
          <div className="mt-4">
            <Label className="text-xs">{t("claims.employee.reason")}</Label>
            <Textarea className="mt-1" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <Button className="mt-4" onClick={() => void acknowledge()}>{t("claims.actions.acknowledge")}</Button>
        </div>
      )}

      {/* Employee info display (read-only reference) */}
      {claim.engagementType === "EMPLOYEE" && claim.employeeId && (
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-semibold mb-3">{t("claims.review.lineManager")}</h3>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="font-medium">{t("claims.review.lineManager")}</dt><dd>{claim.trainer?.nameEn}</dd>
            <dt>{t("claims.employee.employeeId")}</dt><dd>{claim.employeeId}</dd>
            <dt>{t("claims.employee.jobTitle")}</dt><dd>{claim.employeeJobTitle}</dd>
            <dt>{t("claims.employee.department")}</dt><dd>{claim.employeeDepartment}</dd>
            <dt>{t("claims.employee.project")}</dt><dd>{claim.employeeProject}</dd>
            <dt>{t("claims.employee.lineManager")}</dt><dd>{claim.employeeLineManager}</dd>
            <dt>{t("claims.employee.normalHours")}</dt><dd>{claim.normalWorkingHoursPerDay}</dd>
            <dt>{t("claims.employee.estimatedOt")}</dt><dd>{claim.estimatedOtPerDay}</dd>
            <dt>{t("claims.employee.reason")}</dt><dd>{claim.reason}</dd>
          </dl>
        </div>
      )}

      {/* Line Manager Review Panel */}
      {claim.status === "LINE_MANAGER_REVIEW" && (
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-semibold mb-3">{t("claims.review.lineManager")}</h3>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t("claims.review.lineManager")}</Label>
              <RadioGroup className="mt-1" value={lmDecision} onValueChange={setLmDecision}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="APPROVED" id="lm-approved" />
                  <Label htmlFor="lm-approved" className="text-sm font-normal">{t("claims.review.lineManager.approved")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="APPROVED_WITH_CONDITIONS" id="lm-conditions" />
                  <Label htmlFor="lm-conditions" className="text-sm font-normal">{t("claims.review.lineManager.approvedConditions")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="NOT_APPROVED" id="lm-not-approved" />
                  <Label htmlFor="lm-not-approved" className="text-sm font-normal">{t("claims.review.lineManager.notApproved")}</Label>
                </div>
              </RadioGroup>
            </div>
            <div>
              <Label className="text-xs">{t("claims.review.lineManager.checklist")}</Label>
              <Textarea className="mt-1" rows={3} value={lmChecklist} onChange={(e) => setLmChecklist(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t("claims.review.lineManager.comments")}</Label>
              <Textarea className="mt-1" rows={2} value={lmComments} onChange={(e) => setLmComments(e.target.value)} />
            </div>
            <Button disabled={!lmDecision} onClick={() => void submitLmReview()}>{t("claims.actions.lineManagerReview")}</Button>
          </div>
        </div>
      )}

      {/* QHSE Review Panel */}
      {claim.status === "QHSE_REVIEW" && (
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-semibold mb-3">{t("claims.review.qhse")}</h3>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t("claims.review.qhse")}</Label>
              <RadioGroup className="mt-1" value={qhseAssessment} onValueChange={setQhseAssessment}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="ACCEPTABLE" id="qhse-acceptable" />
                  <Label htmlFor="qhse-acceptable" className="text-sm font-normal">{t("claims.review.qhse.acceptable")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="ACCEPTABLE_WITH_CONTROLS" id="qhse-controls" />
                  <Label htmlFor="qhse-controls" className="text-sm font-normal">{t("claims.review.qhse.acceptableControls")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="FURTHER_ASSESSMENT" id="qhse-further" />
                  <Label htmlFor="qhse-further" className="text-sm font-normal">{t("claims.review.qhse.furtherAssessment")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="NOT_RECOMMENDED" id="qhse-not-rec" />
                  <Label htmlFor="qhse-not-rec" className="text-sm font-normal">{t("claims.review.qhse.notRecommended")}</Label>
                </div>
              </RadioGroup>
            </div>
            <div>
              <Label className="text-xs">{t("claims.review.qhse.controls")}</Label>
              <Textarea className="mt-1" rows={3} value={qhseControls} onChange={(e) => setQhseControls(e.target.value)} />
            </div>
            <Button disabled={!qhseAssessment} onClick={() => void submitQhseReview()}>{t("claims.actions.qhseReview")}</Button>
          </div>
        </div>
      )}

      {/* HR Review Panel */}
      {claim.status === "HR_REVIEW" && (
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-semibold mb-3">{t("claims.review.hr")}</h3>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">{t("claims.review.hr")}</Label>
              <RadioGroup className="mt-1" value={hrDecision} onValueChange={setHrDecision}>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="APPROVED" id="hr-approved" />
                  <Label htmlFor="hr-approved" className="text-sm font-normal">{t("claims.review.lineManager.approved")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="APPROVED_WITH_CONDITIONS" id="hr-conditions" />
                  <Label htmlFor="hr-conditions" className="text-sm font-normal">{t("claims.review.lineManager.approvedConditions")}</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="NOT_APPROVED" id="hr-not-approved" />
                  <Label htmlFor="hr-not-approved" className="text-sm font-normal">{t("claims.review.lineManager.notApproved")}</Label>
                </div>
              </RadioGroup>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">{t("claims.review.hr.maxOt")}</Label>
                <Input className="mt-1" type="number" value={hrMaxOt} onChange={(e) => setHrMaxOt(Number(e.target.value))} />
              </div>
              <div>
                <Label className="text-xs">{t("claims.review.hr.comments")}</Label>
                <Textarea className="mt-1" rows={2} value={hrComments} onChange={(e) => setHrComments(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-xs">{t("claims.review.hr.period")}</Label>
                <Input className="mt-1" type="date" value={hrPeriodFrom} onChange={(e) => setHrPeriodFrom(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">{t("claims.review.hr.period")}</Label>
                <Input className="mt-1" type="date" value={hrPeriodTo} onChange={(e) => setHrPeriodTo(e.target.value)} />
              </div>
            </div>
            <Button disabled={!hrDecision} onClick={() => void submitHrReview()}>{t("claims.actions.hrReview")}</Button>
          </div>
        </div>
      )}

      {/* Completed review results */}
      {claim.lineManagerDecision && (
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-semibold mb-3">{t("claims.review.lineManager")}</h3>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="font-medium">{t("claims.review.lineManager")}</dt><dd>{claim.lineManagerDecision}</dd>
            <dt>{t("claims.review.lineManager.comments")}</dt><dd>{claim.lineManagerComments}</dd>
            <dt>{t("claims.review.lineManager")}</dt><dd>{claim.lineManagerSignatureBy}</dd>
            <dt>{t("claims.review.lineManager")}</dt><dd>{claim.lineManagerSignatureAt}</dd>
          </dl>
        </div>
      )}
      {claim.qhseAssessment && (
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-semibold mb-3">{t("claims.review.qhse")}</h3>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="font-medium">{t("claims.review.qhse")}</dt><dd>{claim.qhseAssessment}</dd>
            <dt>{t("claims.review.qhse.controls")}</dt><dd>{claim.qhseControls}</dd>
            <dt>{t("claims.review.qhse")}</dt><dd>{claim.qhseSignatureBy}</dd>
            <dt>{t("claims.review.qhse")}</dt><dd>{claim.qhseSignatureAt}</dd>
          </dl>
        </div>
      )}
      {claim.hrDecision && (
        <div className="rounded-md border p-4">
          <h3 className="text-sm font-semibold mb-3">{t("claims.review.hr")}</h3>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <dt className="font-medium">{t("claims.review.hr")}</dt><dd>{claim.hrDecision}</dd>
            <dt>{t("claims.review.hr.maxOt")}</dt><dd>{claim.hrMaxApprovedOt}</dd>
            <dt>{t("claims.review.hr.comments")}</dt><dd>{claim.hrComments}</dd>
            <dt>{t("claims.review.hr")}</dt><dd>{claim.hrSignatureBy}</dd>
            <dt>{t("claims.review.hr")}</dt><dd>{claim.hrSignatureAt}</dd>
          </dl>
        </div>
      )}

      {/* Items table */}
      <div>
        <h3 className="text-sm font-semibold mb-2">{t("claims.items")}</h3>
        <DataTable
          columns={columns}
          data={items}
          loading={false}
          rowKey={(r) => r.id}
          emptyIcon={FileText}
          emptyTitle={t("claims.empty.title")}
          emptySubtitle={t("claims.items.empty")}
        />
      </div>

      {/* Fullscreen overlay for items table */}
      {fullscreen && (
        <div className="fixed inset-0 z-50 bg-background flex flex-col" style={{ printColorAdjust: "exact" }}>
          <div className="flex items-center justify-between border-b px-4 py-2 no-print">
            <h3 className="text-sm font-semibold">{claim.refNumber} — {t("claims.items")}</h3>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handlePrint}>
                <Printer className="h-3.5 w-3.5 me-1" />{t("claims.actions.print")}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setFullscreen(false)}>
                <Minimize2 className="h-3.5 w-3.5 me-1" />{t("claims.actions.expand")}
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <DataTable
              columns={columns}
              data={items}
              loading={false}
              rowKey={(r) => r.id}
              emptyIcon={FileText}
              emptyTitle={t("claims.empty.title")}
              emptySubtitle={t("claims.items.empty")}
            />
          </div>
        </div>
      )}

      {/* Confirm workflow dialogs */}
      <ConfirmDialog
        open={confirmAction === "submit"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title={t("claims.actions.submit")}
        description={t("claims.actions.submitConfirm")}
        onConfirm={() => void runAction("submit")}
        loading={actionLoading}
      />
      <ConfirmDialog
        open={confirmAction === "approve"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title={t("claims.actions.approve")}
        description={t("claims.actions.approveConfirm")}
        onConfirm={() => void runAction("approve")}
        loading={actionLoading}
      />
      <ConfirmDialog
        open={confirmAction === "finalize"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title={t("claims.actions.finalize")}
        description={t("claims.actions.finalizeConfirm")}
        onConfirm={() => void runAction("finalize")}
        loading={actionLoading}
      />
      <ConfirmDialog
        open={confirmAction === "delete"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title={t("action.delete")}
        description={`${t("claims.refNumber")}: ${claim.refNumber}`}
        onConfirm={() => { void runAction("delete").then(() => navigate("claims")); }}
        loading={actionLoading}
      />

      {/* Return with reason dialog */}
      <FormDialog
        open={returnDialogOpen}
        onOpenChange={(o) => !o && setReturnDialogOpen(false)}
        title={t("claims.actions.return")}
        description={t("claims.actions.returnReason")}
        onSubmit={() => void runAction("return", { reason: returnReason })}
        isSubmitting={actionLoading}
      >
        <Field label={t("claims.actions.returnReason")} required>
          <Textarea
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            rows={3}
            placeholder={t("claims.actions.returnReasonPlaceholder")}
          />
        </Field>
      </FormDialog>

      {/* Reject with reason dialog (permanent) */}
      <FormDialog
        open={confirmAction === "reject"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title={t("claims.actions.reject")}
        description={t("claims.actions.rejectConfirm")}
        onSubmit={() => void runAction("reject", { reason: returnReason })}
        isSubmitting={actionLoading}
      >
        <Field label={t("claims.actions.rejectReason")} required>
          <Textarea
            value={returnReason}
            onChange={(e) => setReturnReason(e.target.value)}
            rows={3}
            placeholder={t("claims.actions.rejectReasonPlaceholder")}
          />
        </Field>
      </FormDialog>

      {/* Adjust item dialog */}
      <FormDialog
        open={adjustDialogOpen}
        onOpenChange={(o) => !o && setAdjustDialogOpen(false)}
        title={t("claims.actions.adjust")}
        description={adjustTarget ? `${adjustTarget.sessionRef} — ${adjustTarget.courseCode ?? ""}` : ""}
        onSubmit={() =>
          void runAction("adjust", {
            itemId: adjustTarget?.id,
            value: Number(adjustValue),
            reason: adjustReason,
          })
        }
        isSubmitting={actionLoading}
      >
        <FormGrid>
          <Field label={t("claims.items.finalValue")} required>
            <Input
              type="number"
              step="0.5"
              value={adjustValue}
              onChange={(e) => setAdjustValue(e.target.value)}
            />
          </Field>
        </FormGrid>
        <Field label={t("claims.actions.adjustReason")} required>
          <Textarea
            value={adjustReason}
            onChange={(e) => setAdjustReason(e.target.value)}
            rows={2}
          />
        </Field>
      </FormDialog>
    </div>
  );
}
