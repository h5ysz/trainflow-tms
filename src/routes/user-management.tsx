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
import { Users, Search, AlertCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useList } from "@/lib/api/hooks";
import { useAppStore } from "@/lib/store/app-store";
import { canAccessModule } from "@/lib/auth/permissions";

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: string;
  isActive: boolean;
  language: string | null;
  companyName: string | null;
  companyRef: string | null;
  trainerName: string | null;
  trainerRef: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export function UserManagementRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const canAccess = canAccessModule(user?.role ?? "CONTRACTOR", "user-management");

  const { data, loading, error, search, setSearch } = useList<UserRow>("/users");

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("misc.noAccess")}</p>
      </div>
    );
  }

  const columns: Column<UserRow>[] = [
    {
      key: "fullName",
      header: locale === "en" ? "User" : "المستخدم",
      cell: (row) => (
        <div>
          <div className="font-medium">{row.fullName}</div>
          <div className="text-xs text-muted-foreground">{row.email}</div>
        </div>
      ),
    },
    {
      key: "role",
      header: locale === "en" ? "Role" : "الدور",
      cell: (row) => (
        <Badge variant="outline" className="font-mono text-xs">
          {row.role}
        </Badge>
      ),
    },
    {
      key: "company",
      header: locale === "en" ? "Company" : "الشركة",
      cell: (row) =>
        row.companyName ? (
          <div>
            <div className="text-sm">{row.companyName}</div>
            {row.companyRef && (
              <div className="text-xs text-muted-foreground">{row.companyRef}</div>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "isActive",
      header: locale === "en" ? "Status" : "الحالة",
      cell: (row) => (
        <Badge
          variant="outline"
          className={
            row.isActive
              ? "bg-emerald-100 text-emerald-800 border-emerald-200"
              : "bg-gray-100 text-gray-700 border-gray-200"
          }
        >
          {row.isActive
            ? locale === "en"
              ? "Active"
              : "نشط"
            : locale === "en"
            ? "Inactive"
            : "غير نشط"}
        </Badge>
      ),
    },
    {
      key: "lastLoginAt",
      header: locale === "en" ? "Last Login" : "آخر دخول",
      cell: (row) =>
        row.lastLoginAt ? (
          <span className="text-xs text-muted-foreground">
            {new Date(row.lastLoginAt).toLocaleDateString(
              locale === "en" ? "en-GB" : "ar-SA",
              { year: "numeric", month: "short", day: "numeric" }
            )}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
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
        title={t("nav.userManagement")}
        subtitle={
          locale === "en"
            ? "Manage all system users, their roles, and access"
            : "إدارة جميع مستخدمي النظام وأدوارهم وصلاحياتهم"
        }
      />

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={locale === "en" ? "Search users..." : "بحث عن المستخدمين..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-9 h-10"
          />
        </div>
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
            emptyIcon={Users}
            emptyTitle={locale === "en" ? "No users found" : "لا يوجد مستخدمون"}
            emptySubtitle={
              locale === "en"
                ? "System users will appear here"
                : "ستظهر مستخدمو النظام هنا"
            }
          />
        )}
      </Card>
    </div>
  );
}
