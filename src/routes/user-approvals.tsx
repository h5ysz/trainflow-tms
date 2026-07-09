"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import {
  UserPlus, Check, X, Loader2, AlertCircle, Clock, Ban, CheckCircle2,
  MailQuestion, Power, Building2,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useList } from "@/lib/api/hooks";
import { useAppStore } from "@/lib/store/app-store";
import { canAccessModule } from "@/lib/auth/permissions";

interface ApprovalRow {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  role: string;
  accountStatus: string;
  registrationData: {
    companyName?: string;
    contactPerson?: string;
    nationalId?: string;
    mobileNumber?: string;
    crNumber?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string; refNumber: string } | null;
}

type ActionType = "APPROVE" | "REJECT" | "SUSPEND" | "ACTIVATE" | "REQUEST_INFO";

const STATUS_STYLES: Record<string, string> = {
  PENDING_APPROVAL: "bg-amber-100 text-amber-800 border-amber-200",
  SUSPENDED: "bg-red-100 text-red-800 border-red-200",
  REJECTED: "bg-gray-100 text-gray-700 border-gray-200",
  ACTIVE: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

const STATUS_ICONS: Record<string, typeof Clock> = {
  PENDING_APPROVAL: Clock,
  SUSPENDED: Ban,
  REJECTED: X,
  ACTIVE: CheckCircle2,
};

const ACTION_LABELS: Record<ActionType, { en: string; ar: string }> = {
  APPROVE: { en: "Approve", ar: "اعتماد" },
  REJECT: { en: "Reject", ar: "رفض" },
  SUSPEND: { en: "Suspend", ar: "إيقاف" },
  ACTIVATE: { en: "Activate", ar: "تفعيل" },
  REQUEST_INFO: { en: "Request Info", ar: "طلب معلومات" },
};

// Actions that prompt for a reason
const REASON_ACTIONS: ActionType[] = ["REJECT", "SUSPEND", "REQUEST_INFO"];

export function UserApprovalsRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [filter, setFilter] = useState<string>("PENDING_APPROVAL");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<{ row: ApprovalRow; action: ActionType } | null>(null);
  const [reason, setReason] = useState("");
  const [createCompany, setCreateCompany] = useState(true);

  const canAccess = canAccessModule(user?.role ?? "CONTRACTOR", "user-approvals");

  const { data, loading, error, refetch } = useList<ApprovalRow>(
    `/user-approvals?filters.accountStatus=${filter}`
  );

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("misc.noAccess")}</p>
      </div>
    );
  }

  const executeAction = async (row: ApprovalRow, action: ActionType, reasonText?: string, linkCompany?: boolean) => {
    setActionLoading(row.id + action);
    try {
      // CRITICAL: API expects POST /api/user-approvals/{id} with { action: "UPPERCASE", reason?, createCompany? }
      await api.post(`/user-approvals/${row.id}`, {
        action,
        reason: reasonText || undefined,
        createCompany: action === "APPROVE" ? linkCompany : undefined,
      });
      toast({
        title: t("misc.success"),
        description: locale === "en"
          ? `${ACTION_LABELS[action].en} — ${row.fullName}`
          : `${ACTION_LABELS[action].ar} — ${row.fullName}`,
      });
      setDialogOpen(false);
      setReason("");
      setCreateCompany(true);
      setPendingAction(null);
      refetch();
    } catch (e) {
      toast({
        title: t("misc.error"),
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const openActionDialog = (row: ApprovalRow, action: ActionType) => {
    if (REASON_ACTIONS.includes(action) || action === "APPROVE") {
      setPendingAction({ row, action });
      setReason("");
      setCreateCompany(true);
      setDialogOpen(true);
    } else {
      // ACTIVATE — no dialog needed
      void executeAction(row, action);
    }
  };

  const confirmDialogAction = () => {
    if (!pendingAction) return;
    void executeAction(pendingAction.row, pendingAction.action, reason, createCompany);
  };

  const columns: Column<ApprovalRow>[] = [
    {
      key: "fullName",
      header: locale === "en" ? "Applicant" : "مقدم الطلب",
      cell: (row) => (
        <div>
          <div className="font-medium">{row.fullName}</div>
          <div className="text-xs text-muted-foreground">{row.email}</div>
          {row.phone && <div className="text-xs text-muted-foreground">{row.phone}</div>}
        </div>
      ),
    },
    {
      key: "company",
      header: locale === "en" ? "Company" : "الشركة",
      cell: (row) => (
        <div>
          <div className="text-sm font-medium">
            {row.registrationData?.companyName || row.company?.name || "—"}
          </div>
          {row.registrationData?.crNumber && (
            <div className="text-xs text-muted-foreground">
              CR: {row.registrationData.crNumber}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "registrationData",
      header: locale === "en" ? "Contact" : "جهة الاتصال",
      cell: (row) => (
        <div className="text-xs space-y-0.5">
          {row.registrationData?.contactPerson && (
            <div>{row.registrationData.contactPerson}</div>
          )}
          {row.registrationData?.nationalId && (
            <div className="text-muted-foreground">ID: {row.registrationData.nationalId}</div>
          )}
          {row.registrationData?.mobileNumber && (
            <div className="text-muted-foreground">{row.registrationData.mobileNumber}</div>
          )}
        </div>
      ),
    },
    {
      key: "accountStatus",
      header: locale === "en" ? "Status" : "الحالة",
      cell: (row) => {
        const Icon = STATUS_ICONS[row.accountStatus] ?? Clock;
        return (
          <Badge variant="outline" className={`gap-1 ${STATUS_STYLES[row.accountStatus] ?? ""}`}>
            <Icon className="h-3 w-3" />
            {row.accountStatus.replace(/_/g, " ")}
          </Badge>
        );
      },
    },
    {
      key: "createdAt",
      header: locale === "en" ? "Submitted" : "تاريخ التقديم",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString(locale === "en" ? "en-GB" : "ar-SA", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </span>
      ),
    },
    {
      key: "actions",
      header: locale === "en" ? "Actions" : "إجراءات",
      cell: (row) => {
        const s = row.accountStatus;
        const loadingKey = row.id;
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* APPROVE — visible when pending/suspended/rejected */}
            {(s === "PENDING_APPROVAL" || s === "SUSPENDED" || s === "REJECTED") && (
              <Button
                size="sm"
                variant="default"
                disabled={actionLoading === loadingKey + "APPROVE"}
                onClick={() => openActionDialog(row, "APPROVE")}
                className="h-8 gap-1"
              >
                {actionLoading === loadingKey + "APPROVE" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Check className="h-3 w-3" />
                )}
                {ACTION_LABELS.APPROVE[locale === "en" ? "en" : "ar"]}
              </Button>
            )}
            {/* REJECT — visible when pending */}
            {s === "PENDING_APPROVAL" && (
              <Button
                size="sm"
                variant="outline"
                disabled={actionLoading === loadingKey + "REJECT"}
                onClick={() => openActionDialog(row, "REJECT")}
                className="h-8 gap-1 text-destructive hover:text-destructive"
              >
                <X className="h-3 w-3" />
                {ACTION_LABELS.REJECT[locale === "en" ? "en" : "ar"]}
              </Button>
            )}
            {/* SUSPEND — visible when active */}
            {s === "ACTIVE" && (
              <Button
                size="sm"
                variant="outline"
                disabled={actionLoading === loadingKey + "SUSPEND"}
                onClick={() => openActionDialog(row, "SUSPEND")}
                className="h-8 gap-1"
              >
                <Ban className="h-3 w-3" />
                {ACTION_LABELS.SUSPEND[locale === "en" ? "en" : "ar"]}
              </Button>
            )}
            {/* ACTIVATE — visible when suspended */}
            {s === "SUSPENDED" && (
              <Button
                size="sm"
                variant="outline"
                disabled={actionLoading === loadingKey + "ACTIVATE"}
                onClick={() => openActionDialog(row, "ACTIVATE")}
                className="h-8 gap-1"
              >
                <Power className="h-3 w-3" />
                {ACTION_LABELS.ACTIVATE[locale === "en" ? "en" : "ar"]}
              </Button>
            )}
            {/* REQUEST_INFO — always visible */}
            <Button
              size="sm"
              variant="ghost"
              disabled={actionLoading === loadingKey + "REQUEST_INFO"}
              onClick={() => openActionDialog(row, "REQUEST_INFO")}
              className="h-8 gap-1"
            >
              <MailQuestion className="h-3 w-3" />
              {ACTION_LABELS.REQUEST_INFO[locale === "en" ? "en" : "ar"]}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.userApprovals")}
        subtitle={
          locale === "en"
            ? "Review and approve pending company registrations"
            : "مراجعة واعتماد تسجيلات الشركات المعلقة"
        }
      />

      {/* Filter tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {[
          { value: "PENDING_APPROVAL", label: locale === "en" ? "Pending" : "معلّق" },
          { value: "SUSPENDED", label: locale === "en" ? "Suspended" : "موقوف" },
          { value: "REJECTED", label: locale === "en" ? "Rejected" : "مرفوض" },
          { value: "ACTIVE", label: locale === "en" ? "Active" : "نشط" },
        ].map((f) => (
          <Button
            key={f.value}
            variant={filter === f.value ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </Button>
        ))}
      </div>

      <Card className="p-0">
        {error ? (
          <div className="p-6">
            <EmptyState icon={AlertCircle} title={t("misc.error")} subtitle={error} />
          </div>
        ) : (
          <DataTable
            data={data}
            columns={columns}
            loading={loading}
            rowKey={(r) => r.id}
            emptyIcon={UserPlus}
            emptyTitle={locale === "en" ? "No requests in this status" : "لا توجد طلبات في هذه الحالة"}
            emptySubtitle={
              locale === "en"
                ? "Pending registrations will appear here"
                : "ستظهر التسجيلات المعلقة هنا"
            }
          />
        )}
      </Card>

      {/* Reason / Confirm dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pendingAction?.action === "APPROVE" && <Check className="h-5 w-5 text-emerald-600" />}
              {pendingAction?.action === "REJECT" && <X className="h-5 w-5 text-destructive" />}
              {pendingAction?.action === "SUSPEND" && <Ban className="h-5 w-5 text-amber-600" />}
              {pendingAction?.action === "REQUEST_INFO" && <MailQuestion className="h-5 w-5 text-blue-600" />}
              {pendingAction
                ? `${ACTION_LABELS[pendingAction.action][locale === "en" ? "en" : "ar"]} — ${pendingAction.row.fullName}`
                : ""}
            </DialogTitle>
            <DialogDescription>
              {pendingAction?.action === "APPROVE" && (locale === "en"
                ? "Confirm approval. The user will be activated and notified by email."
                : "تأكيد الاعتماد. سيتم تفعيل المستخدم وإشعاره بالبريد الإلكتروني.")}
              {pendingAction?.action === "REJECT" && (locale === "en"
                ? "Rejection is final. The user will be notified."
                : "الرفض نهائي. سيتم إشعار المستخدم.")}
              {pendingAction?.action === "SUSPEND" && (locale === "en"
                ? "The user will be signed out and notified. Can be re-activated later."
                : "سيتم تسجيل خروج المستخدم وإشعاره. يمكن إعادة التفعيل لاحقاً.")}
              {pendingAction?.action === "REQUEST_INFO" && (locale === "en"
                ? "The user will be asked to provide additional information."
                : "سيُطلب من المستخدم تقديم معلومات إضافية.")}
            </DialogDescription>
          </DialogHeader>

          {/* Approve: option to create/link a Company record */}
          {pendingAction?.action === "APPROVE" && (
            <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <Checkbox
                id="create-company"
                checked={createCompany}
                onCheckedChange={(v) => setCreateCompany(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="create-company" className="text-sm font-normal cursor-pointer">
                <div className="flex items-center gap-1.5 font-medium">
                  <Building2 className="h-4 w-4" />
                  {locale === "en" ? "Create Company record" : "إنشاء سجل شركة"}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {locale === "en"
                    ? "Links this contractor to a new or existing Company (by name)."
                    : "يربط هذا المقاول بسجل شركة جديدة أو موجودة (حسب الاسم)."}
                </p>
              </Label>
            </div>
          )}

          {/* Reason field for reject/suspend/request-info */}
          {pendingAction && REASON_ACTIONS.includes(pendingAction.action) && (
            <div className="space-y-1.5">
              <Label htmlFor="reason" className="text-sm font-medium">
                {locale === "en" ? "Reason / Message" : "السبب / الرسالة"}
                {pendingAction.action !== "REQUEST_INFO" && (
                  <span className="text-muted-foreground ms-1">
                    ({locale === "en" ? "optional" : "اختياري"})
                  </span>
                )}
                {pendingAction.action === "REQUEST_INFO" && (
                  <span className="text-destructive ms-1">*</span>
                )}
              </Label>
              <Textarea
                id="reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder={
                  locale === "en"
                    ? pendingAction.action === "REQUEST_INFO"
                      ? "Specify what information is needed..."
                      : "Optional reason for this action..."
                    : pendingAction.action === "REQUEST_INFO"
                    ? "حدد المعلومات المطلوبة..."
                    : "سبب اختياري لهذا الإجراء..."
                }
              />
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={!!actionLoading}>
              {locale === "en" ? "Cancel" : "إلغاء"}
            </Button>
            <Button
              onClick={confirmDialogAction}
              disabled={
                !!actionLoading ||
                (pendingAction?.action === "REQUEST_INFO" && !reason.trim())
              }
              variant={pendingAction?.action === "REJECT" ? "destructive" : "default"}
            >
              {actionLoading ? (
                <>
                  <Loader2 className="h-4 w-4 me-2 animate-spin" />
                  {locale === "en" ? "Processing..." : "جاري المعالجة..."}
                </>
              ) : (
                pendingAction && ACTION_LABELS[pendingAction.action][locale === "en" ? "en" : "ar"]
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
