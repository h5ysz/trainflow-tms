"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { useAppStore } from "@/lib/store/app-store";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormGrid } from "@/components/common/form-dialog";
import { DataTable, type Column } from "@/components/common/data-table";
import { RoleBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { Settings as SettingsIcon, Save, Plus, ShieldCheck, Lock } from "lucide-react";
import { canAccessModule } from "@/lib/auth/permissions";

interface UserRow {
  id: string;
  fullName: string;
  email: string;
  role: string;
  isActive: boolean;
  lastLoginAt: string;
}

export function SettingsRoute() {
  const { t } = useI18n();
  const { user } = useAppStore();
  const [tab, setTab] = useState("general");
  const users: UserRow[] = [];

  // RBAC: Settings is only accessible to SUPER_ADMIN
  const canAccess = user && canAccessModule(user.role, "settings");

  if (!canAccess) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} icon={SettingsIcon} />
        <Card>
          <EmptyState
            icon={Lock}
            title={t("misc.noAccess")}
            subtitle={t("role.SUPER_ADMIN.desc")}
            className="py-16"
          />
        </Card>
      </div>
    );
  }

  const userColumns: Column<UserRow>[] = [
    {
      key: "user",
      header: t("table.column.name"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary text-xs font-semibold shrink-0">
            {r.fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
          </div>
          <div>
            <div className="text-sm font-medium">{r.fullName}</div>
            <div className="text-xs text-muted-foreground">{r.email}</div>
          </div>
        </div>
      ),
    },
    {
      key: "role",
      header: "Role",
      cell: (r) => <RoleBadge role={r.role} icon={ShieldCheck} />,
    },
    {
      key: "active",
      header: t("status.ACTIVE"),
      cell: (r) => (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${r.isActive ? "bg-success/10 text-success border-success/20" : "bg-muted text-muted-foreground border-border"}`}>
          {r.isActive ? t("status.ACTIVE") : t("status.INACTIVE")}
        </span>
      ),
    },
    {
      key: "lastLogin",
      header: t("audit.timestamp"),
      cell: (r) => <span className="text-xs text-muted-foreground">{r.lastLoginAt || "—"}</span>,
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: () => <Button variant="ghost" size="sm" className="h-8">{t("action.edit")}</Button>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
        icon={SettingsIcon}
        actions={<Button><Save className="h-4 w-4 me-1.5" />{t("settings.save")}</Button>}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="general">{t("settings.tab.general")}</TabsTrigger>
          <TabsTrigger value="branding">{t("settings.tab.branding")}</TabsTrigger>
          <TabsTrigger value="notifications">{t("settings.tab.notifications")}</TabsTrigger>
          <TabsTrigger value="security">{t("settings.tab.security")}</TabsTrigger>
          <TabsTrigger value="email">{t("settings.tab.email")}</TabsTrigger>
          <TabsTrigger value="users">{t("settings.tab.users")}</TabsTrigger>
        </TabsList>

        {/* General */}
        <TabsContent value="general" className="mt-4">
          <Card className="p-6 max-w-2xl">
            <FormGrid>
              <Field label={t("settings.systemName")}>
                <Input defaultValue="TrainFlow TMS" />
              </Field>
              <Field label={t("settings.defaultLanguage")}>
                <Select defaultValue="en"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                  <SelectItem value="en">English</SelectItem>
                  <SelectItem value="ar">العربية</SelectItem>
                </SelectContent></Select>
              </Field>
              <Field label={t("settings.timezone")}>
                <Select defaultValue="Asia/Riyadh"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                  <SelectItem value="Asia/Riyadh">Asia/Riyadh (GMT+3)</SelectItem>
                  <SelectItem value="Asia/Dubai">Asia/Dubai (GMT+4)</SelectItem>
                  <SelectItem value="UTC">UTC</SelectItem>
                </SelectContent></Select>
              </Field>
              <Field label={t("settings.dateFormat")}>
                <Select defaultValue="YYYY-MM-DD"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>
                  <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                  <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                  <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                </SelectContent></Select>
              </Field>
            </FormGrid>
          </Card>
        </TabsContent>

        {/* Branding */}
        <TabsContent value="branding" className="mt-4">
          <Card className="p-6 max-w-2xl">
            <FormGrid>
              <Field label={t("settings.logoUrl")}>
                <Input placeholder="https://..." />
              </Field>
              <Field label={t("settings.primaryColor")}>
                <div className="flex items-center gap-2">
                  <Input type="color" defaultValue="#0d9488" className="h-9 w-16 p-1" />
                  <Input defaultValue="#0d9488" className="font-mono" />
                </div>
              </Field>
            </FormGrid>
          </Card>
        </TabsContent>

        {/* Notifications */}
        <TabsContent value="notifications" className="mt-4">
          <Card className="p-6 max-w-2xl space-y-4">
            {[
              "New training request",
              "Session scheduled",
              "Certificate issued",
              "Trainer qualification expiring",
              "Low attendance alert",
            ].map((label) => (
              <div key={label} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                <div>
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">Email + in-app</div>
                </div>
                <Switch defaultChecked />
              </div>
            ))}
          </Card>
        </TabsContent>

        {/* Security */}
        <TabsContent value="security" className="mt-4">
          <Card className="p-6 max-w-2xl space-y-5">
            <div>
              <h3 className="text-sm font-semibold mb-3">{t("settings.passwordPolicy")}</h3>
              <FormGrid cols={3}>
                <Field label={t("settings.minLength")}>
                  <Input type="number" defaultValue={8} min={6} />
                </Field>
              </FormGrid>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex items-center gap-2 text-sm"><Switch defaultChecked /> {t("settings.requireUppercase")}</label>
                <label className="flex items-center gap-2 text-sm"><Switch defaultChecked /> {t("settings.requireNumbers")}</label>
                <label className="flex items-center gap-2 text-sm"><Switch /> {t("settings.requireSymbols")}</label>
              </div>
            </div>
            <div className="border-t pt-4">
              <FormGrid>
                <Field label={t("settings.sessionTimeout")}>
                  <Input type="number" defaultValue={30} min={5} />
                </Field>
              </FormGrid>
            </div>
            <div className="border-t pt-4">
              <label className="flex items-center gap-2 text-sm"><Switch /> {t("settings.twoFactor")}</label>
            </div>
          </Card>
        </TabsContent>

        {/* Email */}
        <TabsContent value="email" className="mt-4">
          <Card className="p-6 max-w-2xl">
            <FormGrid>
              <Field label={t("settings.smtpHost")}>
                <Input placeholder="smtp.gmail.com" />
              </Field>
              <Field label={t("settings.smtpPort")}>
                <Input type="number" defaultValue={587} />
              </Field>
              <Field label={t("settings.smtpUser")}>
                <Input placeholder="noreply@trainflow.io" />
              </Field>
              <Field label={t("settings.smtpFrom")}>
                <Input type="email" placeholder="noreply@trainflow.io" />
              </Field>
            </FormGrid>
          </Card>
        </TabsContent>

        {/* Users */}
        <TabsContent value="users" className="mt-4">
          <DataTable
            columns={userColumns}
            data={users}
            rowKey={(r) => r.id}
            emptyIcon={ShieldCheck}
            emptyTitle={t("settings.users.empty.title")}
            emptySubtitle={t("settings.users.empty.subtitle")}
            emptyAction={<Button><Plus className="h-4 w-4 me-1.5" />{t("settings.users.new")}</Button>}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
