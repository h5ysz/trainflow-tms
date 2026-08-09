"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DataTable, type Column } from "@/components/common/data-table";
import { EmptyState } from "@/components/common/empty-state";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { RowActions } from "@/components/common/row-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Users, AlertCircle, Plus, KeyRound, Lock, Unlock, CheckCircle2, XCircle } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useList } from "@/lib/api/hooks";
import { useAppStore } from "@/lib/store/app-store";
import { canAccessModule } from "@/lib/auth/permissions";
import { useEntityActions } from "@/hooks/use-entity-actions";
import { REGIONS, REGION_LABELS } from "@/lib/regions";
import { cn } from "@/lib/utils";

interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: string;
  roleId: string | null;
  isActive: boolean;
  language: string | null;
  region: string | null;
  regionsCovered: string | null;
  companyName: string | null;
  companyRef: string | null;
  trainerName: string | null;
  trainerRef: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

interface LoginRow {
  id: string;
  email: string;
  success: boolean;
  failureReason: string | null;
  ipAddress: string | null;
  attemptedAt: string;
}

interface RoleRow {
  id: string;
  code: string;
  name: string;
  nameAr: string | null;
  isSystem: boolean;
}

const MIN_PASSWORD = 8;

function parseCoverage(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((r): r is string => typeof r === "string") : [];
  } catch {
    return [];
  }
}

function regionLabel(code: string | null | undefined, locale: string): string {
  if (!code) return locale === "en" ? "—" : "—";
  const l = REGION_LABELS[code as keyof typeof REGION_LABELS];
  return l ? (locale === "ar" ? l.ar : l.en) : code;
}

export function UserManagementRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();

  const canAccess = canAccessModule(user?.permissions ?? [], "user-management");
  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  const users = useList<UserRow>("/users");
  const logins = useList<LoginRow>("/login-history");
  const roles = useList<RoleRow>("/roles", { pageSize: 100 });

  const [pwTarget, setPwTarget] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [lockTarget, setLockTarget] = useState<UserRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const {
    dialogOpen, isEditing, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<UserRow>({
    resource: "/users",
    module: "user-management",
    refetch: users.refetch,
    fetchOnEdit: true,
    toForm: (r) => ({
      email: r.email,
      fullName: r.fullName,
      roleId: r.roleId,
      isActive: r.isActive,
      language: r.language ?? "en",
      region: r.region ?? "",
      regionsCovered: parseCoverage(r.regionsCovered),
    }),
  });

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("misc.noAccess")}</p>
      </div>
    );
  }

  const handleSubmit = () =>
    void submit(() => {
      const missing = requireFields({
        [t("users.email")]: "email",
        [t("users.fullName")]: "fullName",
        [t("users.role")]: "roleId",
      })();
      if (missing) return missing;
      // Password is only set at creation; the reset action changes it later.
      if (!isEditing) {
        const pw = (formData.password as string) ?? "";
        if (pw.length < MIN_PASSWORD) return t("users.weakPassword");
      }
      return null;
    });

  const resetPassword = async () => {
    if (!pwTarget) return;
    if (newPassword.length < MIN_PASSWORD) {
      toast({ title: t("misc.error"), description: t("users.weakPassword"), variant: "destructive" });
      return;
    }
    setBusy("pw");
    try {
      await api.post(`/users/${pwTarget.id}/reset-password`, { newPassword, forceChange: true });
      toast({ title: t("misc.success"), description: t("users.passwordReset") });
      setPwTarget(null);
      setNewPassword("");
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const toggleLock = async () => {
    if (!lockTarget) return;
    setBusy("lock");
    try {
      await api.post(`/users/${lockTarget.id}/lock`, { lock: lockTarget.isActive });
      toast({ title: t("misc.success"), description: t("misc.updateSuccess") });
      setLockTarget(null);
      users.refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

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
      cell: (row) => {
        const assigned = roles.data.find((r) => r.id === row.roleId);
        return <Badge variant="outline" className="font-mono text-xs">{assigned?.code ?? row.role}</Badge>;
      },
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
      key: "region",
      header: t("users.region"),
      cell: (row) => {
        const coverage = parseCoverage(row.regionsCovered);
        if (!row.region && coverage.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
        return (
          <div className="space-y-1">
            {row.region && (
              <Badge variant="outline" className="text-xs font-mono">
                {regionLabel(row.region, locale)}
              </Badge>
            )}
            {coverage.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {coverage.map((r) => (
                  <Badge key={r} variant="secondary" className="text-[10px] font-mono text-muted-foreground">
                    +{regionLabel(r, locale)}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        );
      },
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
          {row.isActive ? (locale === "en" ? "Active" : "نشط") : (locale === "en" ? "Inactive" : "غير نشط")}
        </Badge>
      ),
    },
    {
      key: "lastLoginAt",
      header: locale === "en" ? "Last Login" : "آخر دخول",
      cell: (row) =>
        row.lastLoginAt ? (
          <span className="text-xs text-muted-foreground">
            {new Date(row.lastLoginAt).toLocaleDateString(locale === "en" ? "en-GB" : "ar-SA", {
              year: "numeric", month: "short", day: "numeric",
            })}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: (row) => {
        // The API refuses to delete your own account.
        const isSelf = row.id === user?.id;
        return (
          <RowActions
            canEdit={isSuperAdmin}
            canDelete={isSuperAdmin && !isSelf}
            onEdit={() => void openEdit(row)}
            onDelete={() => setDeleteTarget(row)}
            extraItems={
              isSuperAdmin ? (
                <>
                  <DropdownMenuItem onSelect={() => { setNewPassword(""); setPwTarget(row); }}>
                    <KeyRound className="h-3.5 w-3.5 me-2" />
                    {t("users.resetPassword")}
                  </DropdownMenuItem>
                  {!isSelf && (
                    <DropdownMenuItem onSelect={() => setLockTarget(row)}>
                      {row.isActive
                        ? <><Lock className="h-3.5 w-3.5 me-2" />{t("users.lock")}</>
                        : <><Unlock className="h-3.5 w-3.5 me-2" />{t("users.unlock")}</>}
                    </DropdownMenuItem>
                  )}
                </>
              ) : null
            }
          />
        );
      },
    },
  ];

  const loginColumns: Column<LoginRow>[] = [
    { key: "email", header: t("users.email"), cell: (r) => <span className="text-sm">{r.email}</span> },
    {
      key: "success",
      header: locale === "en" ? "Result" : "النتيجة",
      cell: (r) =>
        r.success ? (
          <span className="inline-flex items-center gap-1.5 text-success text-xs font-medium">
            <CheckCircle2 className="h-3.5 w-3.5" />{t("users.loginSuccess")}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-destructive text-xs font-medium">
            <XCircle className="h-3.5 w-3.5" />{r.failureReason ?? t("users.loginFailed")}
          </span>
        ),
    },
    {
      key: "ip",
      header: locale === "en" ? "IP Address" : "عنوان IP",
      cell: (r) => <span className="text-xs font-mono text-muted-foreground">{r.ipAddress ?? "—"}</span>,
    },
    {
      key: "attemptedAt",
      header: locale === "en" ? "When" : "الوقت",
      cell: (r) => <span className="text-xs text-muted-foreground">{new Date(r.attemptedAt).toLocaleString()}</span>,
    },
  ];

  const defaultRoleId = roles.data[0]?.id ?? "";
  const newButton = isSuperAdmin && (
    <Button onClick={() => openCreate({ roleId: defaultRoleId, language: "en", isActive: true })}>
      <Plus className="h-4 w-4 me-1.5" />
      {t("users.new")}
    </Button>
  );

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("nav.userManagement")}
        subtitle={
          locale === "en"
            ? "Manage all system users, their roles, and access"
            : "إدارة جميع مستخدمي النظام وأدوارهم وصلاحياتهم"
        }
        actions={newButton}
      />

      <Tabs defaultValue="users">
        <TabsList>
          <TabsTrigger value="users">{t("nav.userManagement")}</TabsTrigger>
          <TabsTrigger value="logins">{t("users.loginHistory")}</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="mt-4">
          <Card className="p-0">
            {users.error ? (
              <div className="p-6">
                <EmptyState icon={AlertCircle} title={t("misc.error")} subtitle={users.error} />
              </div>
            ) : (
              <DataTable
                data={users.data}
                columns={columns}
                loading={users.loading}
                rowKey={(r) => r.id}
                searchable
                searchValue={users.search}
                onSearchChange={users.setSearch}
                page={users.page}
                total={users.pagination?.total ?? 0}
                pageSize={users.pagination?.pageSize ?? 10}
                onPageChange={users.setPage}
                emptyIcon={Users}
                emptyTitle={locale === "en" ? "No users found" : "لا يوجد مستخدمون"}
                emptySubtitle={locale === "en" ? "System users will appear here" : "ستظهر مستخدمو النظام هنا"}
              />
            )}
          </Card>
        </TabsContent>

        <TabsContent value="logins" className="mt-4">
          <Card className="p-0">
            {logins.error ? (
              <div className="p-6">
                <EmptyState icon={AlertCircle} title={t("misc.error")} subtitle={logins.error} />
              </div>
            ) : (
              <DataTable
                data={logins.data}
                columns={loginColumns}
                loading={logins.loading}
                rowKey={(r) => r.id}
                searchable
                searchValue={logins.search}
                onSearchChange={logins.setSearch}
                page={logins.page}
                total={logins.pagination?.total ?? 0}
                pageSize={logins.pagination?.pageSize ?? 10}
                onPageChange={logins.setPage}
                emptyIcon={Users}
                emptyTitle={t("users.noLogins")}
                emptySubtitle={t("users.noLoginsSubtitle")}
              />
            )}
          </Card>
        </TabsContent>
      </Tabs>

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={isEditing ? t("users.edit") : t("users.new")}
        icon={Users}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("users.fullName")} required>
              <Input value={(formData.fullName as string) ?? ""} onChange={(e) => setField("fullName", e.target.value)} />
            </Field>
            <Field label={t("users.email")} required>
              <Input type="email" value={(formData.email as string) ?? ""} onChange={(e) => setField("email", e.target.value)} />
            </Field>
            {!isEditing && (
              <Field label={t("users.password")} required hint={t("users.weakPassword")}>
                <PasswordInput
                  value={(formData.password as string) ?? ""}
                  onChange={(e) => setField("password", e.target.value)}
                />
              </Field>
            )}
            <Field label={t("users.role")} required>
              <Select value={(formData.roleId as string) ?? ""} onValueChange={(v) => setField("roleId", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.data.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.code} — {locale === "ar" && r.nameAr ? r.nameAr : r.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={t("users.region")}
              hint={t("users.regionHint")}
            >
              <Select
                value={(formData.region as string) ?? ""}
                onValueChange={(v) => setField("region", v === "__none__" ? null : v)}
              >
                <SelectTrigger><SelectValue placeholder={t("misc.none")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("misc.none")}</SelectItem>
                  {REGIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r} — {REGION_LABELS[r][locale === "ar" ? "ar" : "en"]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={t("users.coverage")}
              hint={t("users.coverageHint")}
            >
              <div className="flex flex-wrap gap-1.5">
                {REGIONS.map((r) => {
                  const checked = ((formData.regionsCovered as string[]) ?? []).includes(r);
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => {
                        const cur = (formData.regionsCovered as string[]) ?? [];
                        setField(
                          "regionsCovered",
                          checked ? cur.filter((x) => x !== r) : [...cur, r]
                        );
                      }}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-xs transition-colors",
                        checked
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-input text-muted-foreground hover:bg-muted"
                      )}
                    >
                      {REGION_LABELS[r][locale === "ar" ? "ar" : "en"]}
                    </button>
                  );
                })}
              </div>
            </Field>
            <Field label={t("settings.defaultLanguage")}>
              <Select value={(formData.language as string) ?? "en"} onValueChange={(v) => setField("language", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </FormGrid>

          <label className="flex items-center gap-2 text-sm border-t pt-4">
            <Switch
              checked={(formData.isActive as boolean) ?? true}
              onCheckedChange={(v) => setField("isActive", v)}
            />
            {locale === "en" ? "Active" : "نشط"}
          </label>
        </div>
      </FormDialog>

      <FormDialog
        open={pwTarget !== null}
        onOpenChange={(o) => !o && setPwTarget(null)}
        title={t("users.resetPassword")}
        description={pwTarget?.email}
        icon={KeyRound}
        size="sm"
        isSubmitting={busy === "pw"}
        onSubmit={() => void resetPassword()}
      >
        {/* Email is stubbed, so the admin sets the password and passes it on directly. */}
        <Field label={t("users.newPassword")} required hint={t("users.weakPassword")}>
          <PasswordInput value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </Field>
      </FormDialog>

      <ConfirmDialog
        open={lockTarget !== null}
        onOpenChange={(o) => !o && setLockTarget(null)}
        title={lockTarget?.isActive ? t("users.lock") : t("users.unlock")}
        description={lockTarget?.email}
        confirmLabel={lockTarget?.isActive ? t("users.lock") : t("users.unlock")}
        destructive={lockTarget?.isActive}
        loading={busy === "lock"}
        onConfirm={() => void toggleLock()}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        description={deleteTarget?.email}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}
