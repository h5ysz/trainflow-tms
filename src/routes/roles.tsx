"use client";

import { useState, useMemo } from "react";
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import {
  ShieldCheck, Search, AlertCircle, Plus, Pencil, Trash2, Copy,
  Users as UsersIcon, Loader2, Lock,
} from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useList } from "@/lib/api/hooks";
import { useAppStore } from "@/lib/store/app-store";
import { canAccessModule } from "@/lib/auth/permissions";
import {
  ALL_ACTIONS, ACTION_LABELS, MODULE_APPLICABLE_ACTIONS,
  type Action, type RouteKey,
} from "@/lib/auth/permissions";

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

// All modules in display order — used by the permission matrix editor.
const ALL_MODULES: { key: RouteKey; labelEn: string; labelAr: string }[] = [
  { key: "dashboard", labelEn: "Dashboard", labelAr: "لوحة التحكم" },
  { key: "companies", labelEn: "Companies", labelAr: "الشركات" },
  { key: "company-contacts", labelEn: "Company Contacts", labelAr: "جهات اتصال الشركات" },
  { key: "trainers", labelEn: "Trainers", labelAr: "المدرّبون" },
  { key: "trainer-qualifications", labelEn: "Trainer Qualifications", labelAr: "مؤهلات المدرّب" },
  { key: "trainees", labelEn: "Trainees", labelAr: "المتدربون" },
  { key: "courses", labelEn: "Courses", labelAr: "الدورات" },
  { key: "requests", labelEn: "Training Requests", labelAr: "طلبات التدريب" },
  { key: "sessions", labelEn: "Sessions", labelAr: "الجلسات" },
  { key: "scheduling", labelEn: "Scheduling", labelAr: "الجدولة" },
  { key: "attendance", labelEn: "Attendance", labelAr: "الحضور" },
  { key: "qr-code", labelEn: "QR Code", labelAr: "رمز QR" },
  { key: "pre-test", labelEn: "Pre-Test", labelAr: "الاختبار القبلي" },
  { key: "final-test", labelEn: "Final Test", labelAr: "الاختبار النهائي" },
  { key: "evaluation", labelEn: "Course Evaluation", labelAr: "تقييم الدورة" },
  { key: "certificates", labelEn: "Certificates", labelAr: "الشهادات" },
  { key: "reports", labelEn: "Reports", labelAr: "التقارير" },
  { key: "notifications", labelEn: "Notifications", labelAr: "الإشعارات" },
  { key: "audit-log", labelEn: "Audit Log", labelAr: "سجل التدقيق" },
  { key: "user-approvals", labelEn: "User Approvals", labelAr: "اعتماد المستخدمين" },
  { key: "user-management", labelEn: "User Management", labelAr: "إدارة المستخدمين" },
  { key: "roles", labelEn: "Roles", labelAr: "الأدوار" },
  { key: "settings", labelEn: "Settings", labelAr: "الإعدادات" },
];

interface RoleForm {
  id?: string;
  code: string;
  name: string;
  nameAr: string;
  description: string;
  permissions: Set<string>; // entries like "companies.view" or "companies.*"
}

export function RolesRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "edit" | "duplicate">("create");
  const [formData, setFormData] = useState<RoleForm>({
    code: "", name: "", nameAr: "", description: "", permissions: new Set(),
  });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<RoleRow | null>(null);
  const [assignUsersOpen, setAssignUsersOpen] = useState<RoleRow | null>(null);
  const [assignableUsers, setAssignableUsers] = useState<{ id: string; fullName: string; email: string; roleId: string | null }[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());

  const canAccess = canAccessModule(user?.role ?? "CONTRACTOR", "roles");
  const canManage = user?.role === "SUPER_ADMIN";

  const { data, loading, error, refetch } = useList<RoleRow>(
    `/roles${search ? `?search=${encodeURIComponent(search)}` : ""}`
  );

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("misc.noAccess")}</p>
      </div>
    );
  }

  // ── Permission matrix helpers ────────────────────────────────────────────
  const isPermissionSet = (permSet: Set<string>, mod: RouteKey, action: Action): boolean => {
    if (permSet.has("*")) return true;
    if (permSet.has(`${mod}.*`)) return true;
    return permSet.has(`${mod}.${action}`);
  };

  const togglePermission = (mod: RouteKey, action: Action) => {
    setFormData((prev) => {
      const next = new Set(prev.permissions);
      const key = `${mod}.${action}`;
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return { ...prev, permissions: next };
    });
  };

  const toggleModuleAll = (mod: RouteKey) => {
    setFormData((prev) => {
      const next = new Set(prev.permissions);
      const applicable = MODULE_APPLICABLE_ACTIONS[mod] ?? ["view"];
      const allSet = applicable.every((a) => isPermissionSet(next, mod, a));
      if (allSet) {
        // Remove all actions for this module
        next.delete(`${mod}.*`);
        for (const a of applicable) next.delete(`${mod}.${a}`);
      } else {
        // Add wildcard for this module (cleaner than enumerating)
        next.add(`${mod}.*`);
      }
      return { ...prev, permissions: next };
    });
  };

  const grantAll = () => {
    setFormData((prev) => ({ ...prev, permissions: new Set(["*"]) }));
  };

  const clearAll = () => {
    setFormData((prev) => ({ ...prev, permissions: new Set() }));
  };

  const permissionCount = (row: RoleRow): number => {
    if (row.permissions.includes("*")) return -1; // all
    return row.permissions.length;
  };

  // ── Handlers ─────────────────────────────────────────────────────────────
  const openCreate = () => {
    setFormMode("create");
    setFormData({ code: "", name: "", nameAr: "", description: "", permissions: new Set() });
    setFormOpen(true);
  };

  const openEdit = (row: RoleRow) => {
    setFormMode("edit");
    setFormData({
      id: row.id,
      code: row.code,
      name: row.name,
      nameAr: row.nameAr ?? "",
      description: row.description ?? "",
      permissions: new Set(row.permissions ?? []),
    });
    setFormOpen(true);
  };

  const openDuplicate = (row: RoleRow) => {
    setFormMode("duplicate");
    setFormData({
      code: `${row.code}_COPY`,
      name: `${row.name} (Copy)`,
      nameAr: row.nameAr ?? "",
      description: row.description ?? "",
      permissions: new Set(row.permissions ?? []),
    });
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!formData.code || !formData.name) {
      toast({ title: t("misc.error"), description: locale === "en" ? "Code and name are required" : "الرمز والاسم مطلوبان", variant: "destructive" });
      return;
    }
    setActionLoading("form");
    try {
      const perms = Array.from(formData.permissions);
      if (formMode === "create" || formMode === "duplicate") {
        if (formMode === "duplicate" && formData.id) {
          // Use the duplicate endpoint to preserve audit trail
          await api.post(`/roles/${formData.id}/duplicate`, {
            code: formData.code, name: formData.name, nameAr: formData.nameAr || undefined,
            description: formData.description || undefined,
          });
          // Then update permissions if they differ (duplicate copies source permissions verbatim)
          // — fetch the new role and patch if needed
        } else {
          await api.post("/roles", {
            code: formData.code.toUpperCase(),
            name: formData.name,
            nameAr: formData.nameAr || undefined,
            description: formData.description || undefined,
            permissions: perms,
          });
        }
        toast({ title: t("misc.success"), description: locale === "en" ? "Role created" : "تم إنشاء الدور" });
      } else if (formData.id) {
        await api.put(`/roles/${formData.id}`, {
          name: formData.name,
          nameAr: formData.nameAr || undefined,
          description: formData.description || undefined,
          permissions: perms,
        });
        toast({ title: t("misc.success"), description: locale === "en" ? "Role updated" : "تم تحديث الدور" });
      }
      setFormOpen(false);
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const confirmDeleteRole = async () => {
    if (!confirmDelete) return;
    setActionLoading(confirmDelete.id + "delete");
    try {
      await api.delete(`/roles/${confirmDelete.id}`);
      toast({ title: t("misc.success"), description: locale === "en" ? "Role deleted" : "تم حذف الدور" });
      setConfirmDelete(null);
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const openAssignUsers = async (row: RoleRow) => {
    setAssignUsersOpen(row);
    try {
      const allUsers = await api.get<{ id: string; fullName: string; email: string; roleId: string | null }[]>("/users?pageSize=1000");
      setAssignableUsers(allUsers);
      setSelectedUserIds(new Set(allUsers.filter((u) => u.roleId === row.id).map((u) => u.id)));
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };

  const toggleUserSelect = (id: string) => {
    setSelectedUserIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const saveAssignUsers = async () => {
    if (!assignUsersOpen) return;
    setActionLoading("assign");
    try {
      // Compute diff: users currently on this role vs newly selected
      const currentlyAssigned = new Set(assignableUsers.filter((u) => u.roleId === assignUsersOpen.id).map((u) => u.id));
      const toAdd = Array.from(selectedUserIds).filter((id) => !currentlyAssigned.has(id));
      const toRemove = Array.from(currentlyAssigned).filter((id) => !selectedUserIds.has(id));

      if (toAdd.length > 0) {
        await api.post(`/roles/${assignUsersOpen.id}/users`, { userIds: toAdd, action: "assign" });
      }
      if (toRemove.length > 0) {
        await api.post(`/roles/${assignUsersOpen.id}/users`, { userIds: toRemove, action: "unassign" });
      }
      toast({
        title: t("misc.success"),
        description: locale === "en"
          ? `Assigned ${toAdd.length}, unassigned ${toRemove.length}`
          : `تم تعيين ${toAdd.length}، وإلغاء تعيين ${toRemove.length}`,
      });
      setAssignUsersOpen(null);
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  // ── Table columns ────────────────────────────────────────────────────────
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
          <div className="font-medium">{locale === "ar" && row.nameAr ? row.nameAr : row.name}</div>
          {row.description && <div className="text-xs text-muted-foreground">{row.description}</div>}
        </div>
      ),
    },
    {
      key: "permissions",
      header: locale === "en" ? "Permissions" : "الصلاحيات",
      cell: (row) => {
        const count = permissionCount(row);
        return (
          <Badge variant="outline" className="text-xs">
            {count === -1
              ? locale === "en" ? "All (wildcard)" : "الكل"
              : `${count} ${locale === "en" ? "entries" : "إدخالات"}`}
          </Badge>
        );
      },
    },
    {
      key: "createdAt",
      header: locale === "en" ? "Created" : "تاريخ الإنشاء",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {new Date(row.createdAt).toLocaleDateString(locale === "en" ? "en-GB" : "ar-SA", { year: "numeric", month: "short", day: "numeric" })}
        </span>
      ),
    },
    {
      key: "actions",
      header: locale === "en" ? "Actions" : "إجراءات",
      cell: (row) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={!canManage || !!actionLoading}
            onClick={() => openEdit(row)} title={locale === "en" ? "Edit" : "تعديل"}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={!canManage || !!actionLoading}
            onClick={() => openDuplicate(row)} title={locale === "en" ? "Duplicate" : "نسخ"}>
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" disabled={!canManage || !!actionLoading}
            onClick={() => openAssignUsers(row)} title={locale === "en" ? "Assign Users" : "تعيين مستخدمين"}>
            <UsersIcon className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive"
            disabled={!canManage || row.isSystem || !!actionLoading}
            onClick={() => setConfirmDelete(row)} title={locale === "en" ? "Delete" : "حذف"}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.roles")}
        subtitle={locale === "en"
          ? "Manage dynamic roles, permission matrices, and user assignments"
          : "إدارة الأدوار الديناميكية ومصفوفات الصلاحيات وتعيين المستخدمين"}
        actions={canManage ? (
          <Button size="sm" onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" />
            {locale === "en" ? "New Role" : "دور جديد"}
          </Button>
        ) : undefined}
      />

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={locale === "en" ? "Search by code or name..." : "بحث بالرمز أو الاسم..."}
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
            emptyIcon={ShieldCheck}
            emptyTitle={locale === "en" ? "No roles defined" : "لا توجد أدوار محددة"}
            emptySubtitle={locale === "en" ? "Create your first role to get started" : "أنشئ دورك الأول للبدء"}
          />
        )}
      </Card>

      {/* Create / Edit / Duplicate dialog with Permission Matrix editor */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh]">
          <DialogHeader>
            <DialogTitle>
              {formMode === "create" && (locale === "en" ? "Create New Role" : "إنشاء دور جديد")}
              {formMode === "edit" && (locale === "en" ? "Edit Role" : "تعديل الدور")}
              {formMode === "duplicate" && (locale === "en" ? "Duplicate Role" : "نسخ الدور")}
            </DialogTitle>
            <DialogDescription>
              {locale === "en"
                ? "Configure the role's identity and permission matrix. Use the wildcard * to grant all actions on a module."
                : "اضبط هوية الدور ومصفوفة الصلاحيات. استخدم الرمز * لمنح كل الإجراءات على وحدة."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 max-h-[70vh] overflow-y-auto py-1">
            {/* Identity fields */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{locale === "en" ? "Code" : "الرمز"} *</Label>
                <Input
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value.toUpperCase() })}
                  className="h-10 font-mono"
                  disabled={formMode === "edit"}
                  placeholder="SUPER_ADMIN"
                />
                <p className="text-[11px] text-muted-foreground">
                  {locale === "en" ? "Uppercase. Cannot be changed after creation." : "أحرف كبيرة. لا يمكن تغييره بعد الإنشاء."}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{locale === "en" ? "Name (English)" : "الاسم (إنجليزي)"} *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="h-10"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{locale === "en" ? "Name (Arabic)" : "الاسم (عربي)"}</Label>
                <Input
                  value={formData.nameAr}
                  onChange={(e) => setFormData({ ...formData, nameAr: e.target.value })}
                  className="h-10"
                  dir="rtl"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">{locale === "en" ? "Description" : "الوصف"}</Label>
                <Input
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="h-10"
                />
              </div>
            </div>

            {/* Permission Matrix */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">
                  {locale === "en" ? "Permission Matrix" : "مصفوفة الصلاحيات"}
                </Label>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={grantAll} className="h-7 text-xs">
                    {locale === "en" ? "Grant All (*)" : "منح الكل (*)"}
                  </Button>
                  <Button size="sm" variant="outline" onClick={clearAll} className="h-7 text-xs">
                    {locale === "en" ? "Clear All" : "مسح الكل"}
                  </Button>
                </div>
              </div>

              <div className="rounded-md border overflow-hidden">
                <ScrollArea className="h-[400px]">
                  <Table>
                    <TableHeader className="sticky top-0 bg-background z-10">
                      <TableRow>
                        <TableHead className="min-w-[180px]">
                          {locale === "en" ? "Module" : "الوحدة"}
                        </TableHead>
                        {ALL_ACTIONS.map((a) => (
                          <TableHead key={a} className="text-center text-xs min-w-[80px]">
                            {ACTION_LABELS[a][locale === "en" ? "en" : "ar"]}
                          </TableHead>
                        ))}
                        <TableHead className="text-center text-xs min-w-[70px]">
                          {locale === "en" ? "All" : "الكل"}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ALL_MODULES.map((mod) => {
                        const applicable = MODULE_APPLICABLE_ACTIONS[mod.key] ?? ["view"];
                        const allOn = applicable.every((a) => isPermissionSet(formData.permissions, mod.key, a));
                        return (
                          <TableRow key={mod.key}>
                            <TableCell className="font-medium text-xs">
                              {locale === "ar" ? mod.labelAr : mod.labelEn}
                              <div className="text-[10px] text-muted-foreground font-mono">{mod.key}</div>
                            </TableCell>
                            {ALL_ACTIONS.map((a) => {
                              const applicableForMod = applicable.includes(a);
                              const checked = applicableForMod && isPermissionSet(formData.permissions, mod.key, a);
                              return (
                                <TableCell key={a} className="text-center p-1">
                                  {applicableForMod ? (
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={() => togglePermission(mod.key, a)}
                                      className="mx-auto"
                                    />
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground/40">—</span>
                                  )}
                                </TableCell>
                              );
                            })}
                            <TableCell className="text-center p-1">
                              <Checkbox
                                checked={allOn}
                                onCheckedChange={() => toggleModuleAll(mod.key)}
                                className="mx-auto"
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="font-mono">
                                  {formData.permissions.size} {locale === "en" ? "entries" : "إدخالات"}
                </Badge>
                {formData.permissions.has("*") && (
                  <Badge variant="outline" className="bg-emerald-50 border-emerald-200 text-emerald-800">
                    {locale === "en" ? "Wildcard (*) — all permissions granted" : "رمز شامل (*) — كل الصلاحيات ممنوحة"}
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={!!actionLoading}>
              {locale === "en" ? "Cancel" : "إلغاء"}
            </Button>
            <Button onClick={submitForm} disabled={!!actionLoading || !canManage}>
              {actionLoading === "form" ? (
                <><Loader2 className="h-4 w-4 me-2 animate-spin" />{locale === "en" ? "Saving..." : "جاري الحفظ..."}</>
              ) : formMode === "create" ? (locale === "en" ? "Create Role" : "إنشاء الدور")
                : formMode === "duplicate" ? (locale === "en" ? "Duplicate Role" : "نسخ الدور")
                : (locale === "en" ? "Save Changes" : "حفظ التغييرات")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              {locale === "en" ? "Delete Role" : "حذف الدور"}
            </DialogTitle>
            <DialogDescription>
              {locale === "en"
                ? `Delete role "${confirmDelete?.name}" (${confirmDelete?.code})? This cannot be undone. Reassign any assigned users first.`
                : `حذف الدور "${confirmDelete?.name}" (${confirmDelete?.code})؟ لا يمكن التراجع. أعد تعيين المستخدمين أولاً.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={!!actionLoading}>
              {locale === "en" ? "Cancel" : "إلغاء"}
            </Button>
            <Button variant="destructive" onClick={confirmDeleteRole} disabled={!!actionLoading}>
              {actionLoading?.endsWith("delete") ? (
                <><Loader2 className="h-4 w-4 me-2 animate-spin" />{locale === "en" ? "Deleting..." : "جاري الحذف..."}</>
              ) : (locale === "en" ? "Delete" : "حذف")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assign Users dialog */}
      <Dialog open={!!assignUsersOpen} onOpenChange={(o) => !o && setAssignUsersOpen(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UsersIcon className="h-5 w-5" />
              {locale === "en" ? "Assign Users to Role" : "تعيين مستخدمين للدور"}
            </DialogTitle>
            <DialogDescription>
              {locale === "en"
                ? `Select users to assign to ${assignUsersOpen?.name} (${assignUsersOpen?.code}). Checked = assigned.`
                : `اختر المستخدمين لتعيينهم إلى ${assignUsersOpen?.name} (${assignUsersOpen?.code}). المؤشر = معيّن.`}
            </DialogDescription>
          </DialogHeader>
          <ScrollArea className="h-[400px] rounded-md border">
            <div className="p-2 space-y-1">
              {assignableUsers.length === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground">
                  {locale === "en" ? "No users available" : "لا يوجد مستخدمون متاحون"}
                </div>
              ) : (
                assignableUsers.map((u) => (
                  <label
                    key={u.id}
                    className="flex items-center gap-3 p-2 rounded-md hover:bg-accent cursor-pointer"
                  >
                    <Checkbox
                      checked={selectedUserIds.has(u.id)}
                      onCheckedChange={() => toggleUserSelect(u.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{u.fullName}</div>
                      <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                    </div>
                  </label>
                ))
              )}
            </div>
          </ScrollArea>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setAssignUsersOpen(null)} disabled={!!actionLoading}>
              {locale === "en" ? "Cancel" : "إلغاء"}
            </Button>
            <Button onClick={saveAssignUsers} disabled={!!actionLoading}>
              {actionLoading === "assign" ? (
                <><Loader2 className="h-4 w-4 me-2 animate-spin" />{locale === "en" ? "Saving..." : "جاري الحفظ..."}</>
              ) : (locale === "en" ? "Save Assignments" : "حفظ التعيينات")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
