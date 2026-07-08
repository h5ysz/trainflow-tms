"use client";

import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { ShieldCheck, AlertCircle, Lock } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { useAppStore } from "@/lib/store/app-store";
import { canAccessModule } from "@/lib/auth/permissions";

interface RoleRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export function RolesRoute() {
  const { t, locale } = useI18n();
  const { user } = useAppStore();

  const canAccess = canAccessModule(user?.role ?? "CONTRACTOR", "roles");

  const { data, loading, error } = useList<RoleRow>("/roles");

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("misc.noAccess")}</p>
      </div>
    );
  }

  const columns: Column<RoleRow>[] = [
    {
      key: "code",
      header: locale === "en" ? "Code" : "الرمز",
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold">{row.code}</span>
          {row.isSystem && (
            <Badge variant="outline" className="gap-1 bg-blue-50 border-blue-200 text-blue-800">
              <Lock className="h-3 w-3" />
              {locale === "en" ? "System" : "نظامي"}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "name",
      header: locale === "en" ? "Role Name" : "اسم الدور",
      cell: (row) => (
        <div>
          <div className="font-medium">
            {locale === "ar" && row.nameAr ? row.nameAr : row.name}
          </div>
          {row.description && (
            <div className="text-xs text-muted-foreground">{row.description}</div>
          )}
        </div>
      ),
    },
    {
      key: "permissions",
      header: locale === "en" ? "Permissions" : "الصلاحيات",
      cell: (row) => (
        <div className="flex flex-wrap gap-1 max-w-md">
          {row.permissions && row.permissions.length > 0 ? (
            <>
              {row.permissions.slice(0, 4).map((p) => (
                <Badge key={p} variant="secondary" className="text-[10px] font-mono">
                  {p}
                </Badge>
              ))}
              {row.permissions.length > 4 && (
                <Badge variant="outline" className="text-[10px]">
                  +{row.permissions.length - 4} {locale === "en" ? "more" : "أخرى"}
                </Badge>
              )}
            </>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          )}
        </div>
      ),
    },
    {
      key: "createdAt",
      header: locale === "en" ? "Created" : "تاريخ الإنشاء",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString(
            locale === "en" ? "en-GB" : "ar-SA",
            { year: "numeric", month: "short", day: "numeric" }
          )}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.roles")}
        subtitle={
          locale === "en"
            ? "View system roles and their permission matrices"
            : "عرض أدوار النظام ومصفوفات الصلاحيات الخاصة بها"
        }
      />

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
            emptyIcon={ShieldCheck}
            emptyTitle={locale === "en" ? "No roles defined" : "لا توجد أدوار محددة"}
            emptySubtitle={
              locale === "en"
                ? "System and custom roles will appear here"
                : "ستظهر أدوار النظام والمخصصة هنا"
            }
          />
        )}
      </Card>
    </div>
  );
}
