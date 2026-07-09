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
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import {
  Users, Search, AlertCircle, Plus, Pencil, KeyRound, Lock, Unlock,
  Ban, CheckCircle2, Trash2, Download, MoreVertical, Power, RefreshCw,
  ShieldCheck, Loader2,
} from "lucide-react";
import { api } from "@/lib/api/client";
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
  accountStatus: string;
  forcePasswordChange: boolean;
  language: string | null;
  companyName: string | null;
  companyRef: string | null;
  trainerName: string | null;
  trainerRef: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface UserForm {
  id?: string;
  email: string;
  fullName: string;
  role: string;
  password: string;
  language: string;
  isActive: boolean;
  forcePasswordChange: boolean;
}

const ROLE_OPTIONS = [
  { value: "SUPER_ADMIN", labelEn: "Super Admin", labelAr: "مدير عام" },
  { value: "COORDINATOR", labelEn: "Coordinator", labelAr: "منسق" },
  { value: "TRAINER", labelEn: "Trainer", labelAr: "مدرّب" },
  { value: "CONTRACTOR", labelEn: "Contractor", labelAr: "مقاول" },
];

const EMPTY_FORM: UserForm = {
  email: "", fullName: "", role: "CONTRACTOR", password: "",
  language: "en", isActive: true, forcePasswordChange: false,
};

export function UserManagementRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user: currentUser } = useAppStore();
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [formOpen, setFormOpen] = useState(false);
  const [formData, setFormData] = useState<UserForm>(EMPTY_FORM);
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const [pwDialog, setPwDialog] = useState<{ userId: string; email: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [forceChange, setForceChange] = useState(true);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);

  const canAccess = canAccessModule(currentUser?.role ?? "CONTRACTOR", "user-management");

  // Build query string
  const qs = new URLSearchParams();
  if (search) qs.set("search", search);
  if (roleFilter !== "ALL") qs.set("filters.role", roleFilter);
  if (statusFilter !== "ALL") qs.set("filters.isActive", statusFilter);
  const queryString = qs.toString();

  const { data, loading, error, refetch } = useList<UserRow>(
    `/users${queryString ? `?${queryString}` : ""}`
  );

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("misc.noAccess")}</p>
      </div>
    );
  }

  // ── Handlers ─────────────────────────────────────────────────────────────
  const openCreate = () => {
    setFormMode("create");
    setFormData(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = async (row: UserRow) => {
    try {
      const detail = await api.get<UserRow & { forcePasswordChange: boolean }>(`/users/${row.id}`);
      setFormMode("edit");
      setFormData({
        id: detail.id,
        email: detail.email,
        fullName: detail.fullName,
        role: detail.role,
        password: "",
        language: detail.language ?? "en",
        isActive: detail.isActive,
        forcePasswordChange: detail.forcePasswordChange ?? false,
      });
      setFormOpen(true);
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };

  const submitForm = async () => {
    if (!formData.email || !formData.fullName) {
      toast({ title: t("misc.error"), description: locale === "en" ? "Email and full name are required" : "البريد والاسم مطلوبان", variant: "destructive" });
      return;
    }
    setActionLoading("form");
    try {
      if (formMode === "create") {
        if (!formData.password || formData.password.length < 8) {
          toast({ title: t("misc.error"), description: locale === "en" ? "Password must be at least 8 chars" : "كلمة المرور 8 أحرف على الأقل", variant: "destructive" });
          setActionLoading(null);
          return;
        }
        await api.post("/users", {
          email: formData.email, fullName: formData.fullName, password: formData.password,
          role: formData.role, language: formData.language, isActive: formData.isActive,
        });
        toast({ title: t("misc.success"), description: locale === "en" ? "User created" : "تم إنشاء المستخدم" });
      } else if (formData.id) {
        const patch: Record<string, unknown> = {
          email: formData.email, fullName: formData.fullName, role: formData.role,
          language: formData.language, isActive: formData.isActive,
          forcePasswordChange: formData.forcePasswordChange,
        };
        if (formData.password) patch.password = formData.password;
        await api.put(`/users/${formData.id}`, patch);
        toast({ title: t("misc.success"), description: locale === "en" ? "User updated" : "تم تحديث المستخدم" });
      }
      setFormOpen(false);
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const handleResetPassword = async () => {
    if (!pwDialog) return;
    if (!newPassword || newPassword.length < 8) {
      toast({ title: t("misc.error"), description: locale === "en" ? "Password must be at least 8 chars" : "كلمة المرور 8 أحرف على الأقل", variant: "destructive" });
      return;
    }
    setActionLoading("pw");
    try {
      await api.post(`/users/${pwDialog.userId}/reset-password`, {
        newPassword, forceChange,
      });
      toast({ title: t("misc.success"), description: locale === "en" ? "Password reset" : "تمت إعادة تعيين كلمة المرور" });
      setPwDialog(null);
      setNewPassword("");
      setForceChange(true);
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const toggleActive = async (row: UserRow) => {
    setActionLoading(row.id + "toggle");
    try {
      await api.put(`/users/${row.id}`, { isActive: !row.isActive });
      toast({ title: t("misc.success"), description: !row.isActive ? (locale === "en" ? "Activated" : "تم التفعيل") : (locale === "en" ? "Deactivated" : "تم الإلغاء") });
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const toggleLock = async (row: UserRow, lock: boolean) => {
    setActionLoading(row.id + "lock");
    try {
      await api.post(`/users/${row.id}/lock`, { lock });
      toast({ title: t("misc.success"), description: lock ? (locale === "en" ? "Locked" : "تم القفل") : (locale === "en" ? "Unlocked" : "تم إلغاء القفل") });
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const toggleForceChange = async (row: UserRow) => {
    setActionLoading(row.id + "force");
    try {
      await api.put(`/users/${row.id}`, { forcePasswordChange: !row.forcePasswordChange });
      toast({ title: t("misc.success"), description: locale === "en" ? "Updated" : "تم التحديث" });
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const confirmSoftDelete = async () => {
    if (!confirmDelete) return;
    setActionLoading(confirmDelete.id + "delete");
    try {
      await api.delete(`/users/${confirmDelete.id}`);
      toast({ title: t("misc.success"), description: locale === "en" ? "User deleted" : "تم حذف المستخدم" });
      setConfirmDelete(null);
      refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setActionLoading(null);
    }
  };

  const exportCsv = () => {
    // Direct browser download — bypasses api wrapper to get the file
    const url = `/api/users/export${queryString ? `?${queryString}` : ""}`;
    window.location.href = url;
  };

  // ── Columns ──────────────────────────────────────────────────────────────
  const columns: Column<UserRow>[] = [
    {
      key: "fullName",
      header: locale === "en" ? "User" : "المستخدم",
      cell: (row) => (
        <div>
          <div className="font-medium flex items-center gap-1.5">
            {row.fullName}
            {row.forcePasswordChange && (
              <Badge variant="outline" className="text-[10px] bg-amber-50 border-amber-200 text-amber-800 gap-0.5">
                <KeyRound className="h-2.5 w-2.5" />
                {locale === "en" ? "Force change" : "إلزام تغيير"}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground">{row.email}</div>
        </div>
      ),
    },
    {
      key: "role",
      header: locale === "en" ? "Role" : "الدور",
      cell: (row) => (
        <Badge variant="outline" className="font-mono text-xs">
          {ROLE_OPTIONS.find((r) => r.value === row.role)?.[locale === "en" ? "labelEn" : "labelAr"] ?? row.role}
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
            {row.companyRef && <div className="text-xs text-muted-foreground">{row.companyRef}</div>}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "isActive",
      header: locale === "en" ? "Status" : "الحالة",
      cell: (row) => {
        const isLocked = row.accountStatus === "LOCKED";
        return (
          <Badge
            variant="outline"
            className={
              isLocked
                ? "bg-red-100 text-red-800 border-red-200"
                : row.isActive
                ? "bg-emerald-100 text-emerald-800 border-emerald-200"
                : "bg-gray-100 text-gray-700 border-gray-200"
            }
          >
            {isLocked
              ? locale === "en" ? "Locked" : "مقفل"
              : row.isActive
              ? locale === "en" ? "Active" : "نشط"
              : locale === "en" ? "Inactive" : "غير نشط"}
          </Badge>
        );
      },
    },
    {
      key: "lastLoginAt",
      header: locale === "en" ? "Last Login" : "آخر دخول",
      cell: (row) =>
        row.lastLoginAt ? (
          <span className="text-xs text-muted-foreground">
            {new Date(row.lastLoginAt).toLocaleDateString(locale === "en" ? "en-GB" : "ar-SA", { year: "numeric", month: "short", day: "numeric" })}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "actions",
      header: locale === "en" ? "Actions" : "إجراءات",
      cell: (row) => {
        const isSelf = row.id === currentUser?.id;
        const isLocked = row.accountStatus === "LOCKED";
        return (
          <div className="flex items-center gap-1 flex-wrap">
            <Button
              size="sm" variant="ghost" className="h-8 w-8 p-0"
              disabled={actionLoading === row.id + "edit" || isSelf}
              onClick={() => openEdit(row)}
              title={locale === "en" ? "Edit" : "تعديل"}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm" variant="ghost" className="h-8 w-8 p-0"
              disabled={!!actionLoading || isSelf}
              onClick={() => { setPwDialog({ userId: row.id, email: row.email }); setNewPassword(""); setForceChange(true); }}
              title={locale === "en" ? "Reset Password" : "إعادة تعيين كلمة المرور"}
            >
              <KeyRound className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm" variant="ghost" className="h-8 w-8 p-0"
              disabled={!!actionLoading || isSelf}
              onClick={() => toggleActive(row)}
              title={row.isActive ? (locale === "en" ? "Deactivate" : "إلغاء التفعيل") : (locale === "en" ? "Activate" : "تفعيل")}
            >
              {row.isActive ? <Power className="h-3.5 w-3.5 text-amber-600" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />}
            </Button>
            <Button
              size="sm" variant="ghost" className="h-8 w-8 p-0"
              disabled={!!actionLoading || isSelf}
              onClick={() => toggleLock(row, !isLocked)}
              title={isLocked ? (locale === "en" ? "Unlock" : "إلغاء القفل") : (locale === "en" ? "Lock" : "قفل")}
            >
              {isLocked ? <Unlock className="h-3.5 w-3.5 text-emerald-600" /> : <Lock className="h-3.5 w-3.5 text-red-600" />}
            </Button>
            <Button
              size="sm" variant="ghost" className="h-8 w-8 p-0"
              disabled={!!actionLoading || isSelf}
              onClick={() => toggleForceChange(row)}
              title={locale === "en" ? "Toggle Force Password Change" : "تبديل إلزام تغيير كلمة المرور"}
            >
              <ShieldCheck className={`h-3.5 w-3.5 ${row.forcePasswordChange ? "text-amber-600" : "text-muted-foreground"}`} />
            </Button>
            <Button
              size="sm" variant="ghost" className="h-8 w-8 p-0 text-destructive hover:text-destructive"
              disabled={!!actionLoading || isSelf}
              onClick={() => setConfirmDelete(row)}
              title={locale === "en" ? "Delete" : "حذف"}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.userManagement")}
        subtitle={locale === "en"
          ? "Manage all system users, their roles, and access"
          : "إدارة جميع مستخدمي النظام وأدوارهم وصلاحياتهم"}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={exportCsv} className="gap-1.5">
              <Download className="h-4 w-4" />
              {locale === "en" ? "Export" : "تصدير"}
            </Button>
            <Button size="sm" onClick={openCreate} className="gap-1.5">
              <Plus className="h-4 w-4" />
              {locale === "en" ? "New User" : "مستخدم جديد"}
            </Button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={locale === "en" ? "Search by name or email..." : "بحث بالاسم أو البريد..."}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="ps-9 h-10"
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className="w-[180px] h-10">
            <SelectValue placeholder={locale === "en" ? "All roles" : "كل الأدوار"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{locale === "en" ? "All roles" : "كل الأدوار"}</SelectItem>
            {ROLE_OPTIONS.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {locale === "en" ? r.labelEn : r.labelAr}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px] h-10">
            <SelectValue placeholder={locale === "en" ? "All status" : "كل الحالات"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{locale === "en" ? "All status" : "كل الحالات"}</SelectItem>
            <SelectItem value="true">{locale === "en" ? "Active" : "نشط"}</SelectItem>
            <SelectItem value="false">{locale === "en" ? "Inactive" : "غير نشط"}</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={refetch} className="h-10 px-3">
          <RefreshCw className="h-4 w-4" />
        </Button>
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
            emptySubtitle={locale === "en" ? "Adjust filters or create a new user" : "عدّل الفلاتر أو أنشئ مستخدم جديد"}
          />
        )}
      </Card>

      {/* Create / Edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {formMode === "create"
                ? locale === "en" ? "Create New User" : "إنشاء مستخدم جديد"
                : locale === "en" ? "Edit User" : "تعديل المستخدم"}
            </DialogTitle>
            <DialogDescription>
              {formMode === "create"
                ? locale === "en" ? "Add a new system user with login access."
                  : "أضف مستخدم نظام جديد مع صلاحية الدخول."
                : locale === "en" ? "Update user details. Leave password blank to keep current."
                  : "حدّث بيانات المستخدم. اترك كلمة المرور فارغة للإبقاء على الحالية."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 max-h-[60vh] overflow-y-auto py-1">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "Full Name" : "الاسم الكامل"} *</Label>
              <Input value={formData.fullName} onChange={(e) => setFormData({ ...formData, fullName: e.target.value })} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "Email" : "البريد الإلكتروني"} *</Label>
              <Input type="email" value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} className="h-10" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "Role" : "الدور"} *</Label>
              <Select value={formData.role} onValueChange={(v) => setFormData({ ...formData, role: v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {locale === "en" ? r.labelEn : r.labelAr}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">
                {locale === "en" ? "Password" : "كلمة المرور"}
                {formMode === "edit" && <span className="text-muted-foreground ms-1 text-xs">({locale === "en" ? "leave blank to keep" : "اتركها فارغة للإبقاء"})</span>}
                {formMode === "create" && <span className="text-destructive ms-1">*</span>}
              </Label>
              <Input type="password" value={formData.password} onChange={(e) => setFormData({ ...formData, password: e.target.value })} className="h-10" placeholder="••••••••" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "Language" : "اللغة"}</Label>
              <Select value={formData.language} onValueChange={(v) => setFormData({ ...formData, language: v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Checkbox id="ua-active" checked={formData.isActive} onCheckedChange={(v) => setFormData({ ...formData, isActive: v === true })} />
              <Label htmlFor="ua-active" className="text-sm cursor-pointer">
                {locale === "en" ? "Active (can sign in)" : "نشط (يمكنه الدخول)"}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="ua-force" checked={formData.forcePasswordChange} onCheckedChange={(v) => setFormData({ ...formData, forcePasswordChange: v === true })} />
              <Label htmlFor="ua-force" className="text-sm cursor-pointer">
                {locale === "en" ? "Force password change on next login" : "إلزام تغيير كلمة المرور عند الدخول التالي"}
              </Label>
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={!!actionLoading}>
              {locale === "en" ? "Cancel" : "إلغاء"}
            </Button>
            <Button onClick={submitForm} disabled={!!actionLoading}>
              {actionLoading === "form" ? (
                <><Loader2 className="h-4 w-4 me-2 animate-spin" />{locale === "en" ? "Saving..." : "جاري الحفظ..."}</>
              ) : formMode === "create" ? (locale === "en" ? "Create" : "إنشاء") : (locale === "en" ? "Save" : "حفظ")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!pwDialog} onOpenChange={(o) => !o && setPwDialog(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              {locale === "en" ? "Reset Password" : "إعادة تعيين كلمة المرور"}
            </DialogTitle>
            <DialogDescription>
              {locale === "en" ? `Set a new password for ${pwDialog?.email}` : `تعيين كلمة مرور جديدة لـ ${pwDialog?.email}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">{locale === "en" ? "New Password" : "كلمة المرور الجديدة"} *</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="h-10" placeholder="••••••••" />
              <p className="text-[11px] text-muted-foreground">
                {locale === "en" ? "Min 8 chars, with uppercase, lowercase, and a number." : "٨ أحرف على الأقل، مع حرف كبير وصغير ورقم."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="pw-force" checked={forceChange} onCheckedChange={(v) => setForceChange(v === true)} />
              <Label htmlFor="pw-force" className="text-sm cursor-pointer">
                {locale === "en" ? "Force password change on next login" : "إلزام تغيير كلمة المرور عند الدخول التالي"}
              </Label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setPwDialog(null)} disabled={!!actionLoading}>
              {locale === "en" ? "Cancel" : "إلغاء"}
            </Button>
            <Button onClick={handleResetPassword} disabled={!!actionLoading}>
              {actionLoading === "pw" ? (
                <><Loader2 className="h-4 w-4 me-2 animate-spin" />{locale === "en" ? "Resetting..." : "جاري الإعادة..."}</>
              ) : (locale === "en" ? "Reset Password" : "إعادة التعيين")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm delete dialog */}
      <Dialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-5 w-5" />
              {locale === "en" ? "Confirm Delete" : "تأكيد الحذف"}
            </DialogTitle>
            <DialogDescription>
              {locale === "en"
                ? `Soft-delete ${confirmDelete?.fullName} (${confirmDelete?.email})? The user will be deactivated and hidden from lists. This action can be reversed by an admin.`
                : `حذف ${confirmDelete?.fullName} (${confirmDelete?.email})؟ سيتم إلغاء تفعيل المستخدم وإخفاؤه من القوائم. يمكن التراجع عن هذا الإجراء من قبل المدير.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={!!actionLoading}>
              {locale === "en" ? "Cancel" : "إلغاء"}
            </Button>
            <Button variant="destructive" onClick={confirmSoftDelete} disabled={!!actionLoading}>
              {actionLoading?.endsWith("delete") ? (
                <><Loader2 className="h-4 w-4 me-2 animate-spin" />{locale === "en" ? "Deleting..." : "جاري الحذف..."}</>
              ) : (locale === "en" ? "Delete" : "حذف")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
