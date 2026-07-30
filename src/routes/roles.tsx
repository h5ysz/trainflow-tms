"use client";

import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { RowActions } from "@/components/common/row-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { ShieldCheck, AlertCircle, Lock, Plus } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { useAppStore } from "@/lib/store/app-store";
import { canAccessModule, ACTIONS, ALL_MODULES, type UserRole, type RouteKey } from "@/lib/auth/permissions";
import { useEntityActions } from "@/hooks/use-entity-actions";

interface RoleRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  description: string | null;
  isSystem: boolean;
  baseType: UserRole;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

// A custom role can never acquire the platform-admin-exclusive gates: these
// three modules stay hard-coded to SUPER_ADMIN in the backend regardless of
// what's checked here, so the checkboxes are disabled to avoid implying
// otherwise (the exact trap this whole feature is meant to fix).
const ADMIN_ONLY_MODULES = new Set<RouteKey>(["settings", "user-management", "roles"]);

// Reserve SUPER_ADMIN for the real Super Admin system role.
const ASSIGNABLE_BASE_TYPES: UserRole[] = ["COMPANY_ADMIN", "COORDINATOR", "TRAINER", "AUDITOR", "CONTRACTOR", "VIEWER"];

export function RolesRoute() {
  const { t, locale } = useI18n();
  const { user } = useAppStore();

  const canAccess = canAccessModule(user?.permissions ?? [], "roles");
  // Every role endpoint except GET is requireRole("SUPER_ADMIN").
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const { data, loading, error, refetch } = useList<RoleRow>("/roles");

  const {
    dialogOpen, isEditing, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<RoleRow>({
    resource: "/roles",
    module: "roles",
    refetch,
    toForm: (r) => ({
      name: r.name,
      nameAr: r.nameAr,
      description: r.description,
      baseType: r.baseType,
      permissions: r.permissions ?? [],
    }),
  });

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("misc.noAccess")}</p>
      </div>
    );
  }

  const selected = (formData.permissions as string[]) ?? [];

  const togglePermission = (value: string) => {
    setField(
      "permissions",
      selected.includes(value) ? selected.filter((p) => p !== value) : [...selected, value]
    );
  };

  const handleSubmit = () =>
    void submit(
      requireFields(
        isEditing
          ? { [locale === "en" ? "Role Name" : "اسم الدور"]: "name" }
          : {
              [locale === "en" ? "Code" : "الرمز"]: "code",
              [locale === "en" ? "Role Name" : "اسم الدور"]: "name",
            }
      )
    );

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
      key: "baseType",
      header: locale === "en" ? "Base Type" : "النوع الأساسي",
      cell: (row) => <Badge variant="secondary" className="font-mono text-xs">{row.baseType}</Badge>,
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
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: (row) => (
        <RowActions
          // System roles are seeded and the API refuses to delete them.
          canEdit={isSuperAdmin && !row.isSystem}
          canDelete={isSuperAdmin && !row.isSystem}
          onEdit={() => void openEdit(row)}
          onDelete={() => setDeleteTarget(row)}
        />
      ),
    },
  ];

  const newRoleButton = isSuperAdmin && (
    <Button onClick={() => openCreate({ baseType: "COORDINATOR", permissions: [] })}>
      <Plus className="h-4 w-4 me-1.5" />
      {locale === "en" ? "New Role" : "دور جديد"}
    </Button>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.roles")}
        subtitle={
          locale === "en"
            ? "View system roles and their permission matrices"
            : "عرض أدوار النظام ومصفوفات الصلاحيات الخاصة بها"
        }
        actions={newRoleButton}
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

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={
          isEditing
            ? locale === "en" ? "Edit Role" : "تعديل الدور"
            : locale === "en" ? "New Role" : "دور جديد"
        }
        icon={ShieldCheck}
        size="xl"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            {/* The API derives code from create only; it is not updatable. */}
            {!isEditing && (
              <Field label={locale === "en" ? "Code" : "الرمز"} required hint="AUDITOR">
                <Input
                  value={(formData.code as string) ?? ""}
                  onChange={(e) => setField("code", e.target.value.toUpperCase())}
                />
              </Field>
            )}
            <Field label={locale === "en" ? "Role Name" : "اسم الدور"} required>
              <Input
                value={(formData.name as string) ?? ""}
                onChange={(e) => setField("name", e.target.value)}
              />
            </Field>
            <Field label={locale === "en" ? "Arabic Name" : "الاسم بالعربية"}>
              <Input
                dir="rtl"
                value={(formData.nameAr as string) ?? ""}
                onChange={(e) => setField("nameAr", e.target.value)}
              />
            </Field>
          </FormGrid>

          <Field label={locale === "en" ? "Description" : "الوصف"}>
            <Textarea
              rows={2}
              value={(formData.description as string) ?? ""}
              onChange={(e) => setField("description", e.target.value)}
            />
          </Field>

          <Field
            label={locale === "en" ? "Base Type" : "النوع الأساسي"}
            required
            hint={
              locale === "en"
                ? "Determines company-scoping and admin-gate behavior for users assigned this role"
                : "يحدد سلوك النطاق حسب الشركة وصلاحيات الإدارة للمستخدمين المعينين لهذا الدور"
            }
          >
            <Select
              value={(formData.baseType as string) ?? "COORDINATOR"}
              onValueChange={(v) => setField("baseType", v)}
              disabled={isEditing}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ASSIGNABLE_BASE_TYPES.map((bt) => (
                  <SelectItem key={bt} value={bt}>{bt}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <div className="border-t pt-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium">
                {locale === "en" ? "Permissions" : "الصلاحيات"}
              </label>
              <label className="flex items-center gap-2 text-xs">
                <Checkbox
                  checked={selected.includes("*")}
                  onCheckedChange={() => togglePermission("*")}
                />
                <span className="font-mono">*</span>
                <span className="text-muted-foreground">
                  {locale === "en" ? "full access" : "صلاحية كاملة"}
                </span>
              </label>
            </div>

            {/* "*" supersedes everything, so the per-module grid is redundant then. */}
            {!selected.includes("*") && (
              <div className="rounded-md border divide-y max-h-72 overflow-y-auto">
                {ALL_MODULES.map((mod) => {
                  const adminOnly = ADMIN_ONLY_MODULES.has(mod);
                  return (
                    <div key={mod} className="flex items-center justify-between gap-4 px-3 py-2">
                      <span className="text-xs font-mono flex items-center gap-1.5">
                        {mod}
                        {adminOnly && (
                          <span
                            className="text-[10px] text-muted-foreground font-sans"
                            title={
                              locale === "en"
                                ? "Reserved for Super Admin — not governed by role permissions"
                                : "محجوز لمدير النظام — لا يخضع لصلاحيات الدور"
                            }
                          >
                            ({locale === "en" ? "Super Admin only" : "لمدير النظام فقط"})
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-[11px]">
                          <Checkbox
                            disabled={adminOnly}
                            checked={selected.includes(`${mod}.*`)}
                            onCheckedChange={() => togglePermission(`${mod}.*`)}
                          />
                          <span className="font-mono">*</span>
                        </label>
                        {ACTIONS.map((action) => (
                          <label key={action} className="flex items-center gap-1.5 text-[11px]">
                            <Checkbox
                              disabled={adminOnly || selected.includes(`${mod}.*`)}
                              checked={selected.includes(`${mod}.${action}`)}
                              onCheckedChange={() => togglePermission(`${mod}.${action}`)}
                            />
                            {action}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        description={deleteTarget ? `${deleteTarget.code} — ${deleteTarget.name}` : undefined}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
