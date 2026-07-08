"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { UserPlus, Check, X, Loader2, AlertCircle, Clock, Ban, CheckCircle2 } from "lucide-react";
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

export function UserApprovalsRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [filter, setFilter] = useState<string>("PENDING_APPROVAL");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

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

  const handleAction = async (id: string, action: "approve" | "reject" | "suspend" | "activate") => {
    setActionLoading(id);
    try {
      await api.post(`/user-approvals/${id}/${action}`, {});
      toast({
        title: t("misc.success"),
        description: locale === "en" ? `User ${action}d successfully` : `تم تنفيذ الإجراء بنجاح`,
      });
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
      cell: (row) => (
        <div className="flex items-center gap-1.5">
          {(row.accountStatus === "PENDING_APPROVAL" ||
            row.accountStatus === "SUSPENDED" ||
            row.accountStatus === "REJECTED") && (
            <Button
              size="sm"
              variant="default"
              disabled={actionLoading === row.id}
              onClick={() => handleAction(row.id, "approve")}
              className="h-8 gap-1"
            >
              {actionLoading === row.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              {locale === "en" ? "Approve" : "اعتماد"}
            </Button>
          )}
          {row.accountStatus === "PENDING_APPROVAL" && (
            <Button
              size="sm"
              variant="outline"
              disabled={actionLoading === row.id}
              onClick={() => handleAction(row.id, "reject")}
              className="h-8 gap-1"
            >
              <X className="h-3 w-3" />
              {locale === "en" ? "Reject" : "رفض"}
            </Button>
          )}
          {row.accountStatus === "ACTIVE" && (
            <Button
              size="sm"
              variant="outline"
              disabled={actionLoading === row.id}
              onClick={() => handleAction(row.id, "suspend")}
              className="h-8 gap-1"
            >
              <Ban className="h-3 w-3" />
              {locale === "en" ? "Suspend" : "تعليق"}
            </Button>
          )}
        </div>
      ),
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
      <div className="flex items-center gap-2">
        {[
          { value: "PENDING_APPROVAL", label: locale === "en" ? "Pending" : "معلّق" },
          { value: "SUSPENDED", label: locale === "en" ? "Suspended" : "موقوف" },
          { value: "REJECTED", label: locale === "en" ? "Rejected" : "مرفوض" },
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
            <EmptyState
              icon={AlertCircle}
              title={t("misc.error")}
              subtitle={error}
            />
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
    </div>
  );
}
