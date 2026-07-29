"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field, FormGrid } from "@/components/common/form-dialog";
import { DataTable, type Column } from "@/components/common/data-table";
import { RoleBadge } from "@/components/common/status-badge";
import { EmptyState } from "@/components/common/empty-state";
import { Settings as SettingsIcon, Save, Plus, ShieldCheck, Lock, Loader2, CheckCircle2, AlertCircle, Send, MailWarning } from "lucide-react";
import { canAccessModule } from "@/lib/auth/permissions";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useList } from "@/lib/api/hooks";
import { useAppStore } from "@/lib/store/app-store";

interface SettingView {
  value: string;
  category: string;
  isSecret?: boolean;
  isSet?: boolean;
}

interface EmailTestResult {
  status: "SENT" | "SIMULATED" | "FAILED" | "SKIPPED";
  message?: string;
  error?: string;
  to?: string;
}

interface UserRow {
  id: string;
  fullName: string;
  email: string;
  role: string;
  isActive: boolean;
  companyName?: string | null;
  lastLoginAt?: string | null;
  createdAt: string;
}

function bool(v?: string) { return v === "true" || v === "1"; }

export function SettingsRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();
  const [tab, setTab] = useState("general");
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which secret keys already have a value stored, so the field can show
  // "configured" without ever receiving the secret itself.
  const [secretsSet, setSecretsSet] = useState<Record<string, boolean>>({});
  const [testingEmail, setTestingEmail] = useState(false);
  const [emailTestResult, setEmailTestResult] = useState<EmailTestResult | null>(null);
  const usersList = useList<UserRow>("/users");

  useEffect(() => {
    api.get<Record<string, SettingView>>("/settings")
      .then((data) => {
        const flat: Record<string, string> = {};
        const secretState: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(data)) {
          flat[k] = v.value;
          // Secret values are never sent to the browser; only whether one is stored.
          if (v.isSecret) secretState[k] = Boolean(v.isSet);
        }
        setSettings(flat);
        setSecretsSet(secretState);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  const setSetting = (key: string, value: string) => setSettings((p) => ({ ...p, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.put("/settings", { settings });
      toast({ title: t("misc.success"), description: t("settings.saved"), action: <CheckCircle2 className="h-4 w-4 text-success" /> });
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTestEmail = async () => {
    setTestingEmail(true);
    setEmailTestResult(null);
    try {
      // Save first: testing settings the server has not seen would be misleading.
      await api.put("/settings", { settings });
      const res = await api.post<EmailTestResult>("/settings/email/test", {});
      setEmailTestResult(res);
      if (res.status === "SENT") setSecretsSet((p) => ({ ...p, "email.smtpPassword": true }));
      // The password is written once and then cleared from the form, so a later save
      // does not resend it.
      if (settings["email.smtpPassword"]) setSetting("email.smtpPassword", "");
    } catch (e) {
      setEmailTestResult({ status: "FAILED", error: (e as Error).message });
    } finally {
      setTestingEmail(false);
    }
  };

  const canAccess = canAccessModule(user?.permissions ?? [], "settings");

  if (!canAccess) {
    return (
      <div className="space-y-5">
        <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} icon={SettingsIcon} />
        <Card>
          <EmptyState icon={Lock} title={t("misc.noAccess")} subtitle={t("role.SUPER_ADMIN.desc")} className="py-16" />
        </Card>
      </div>
    );
  }

  const userColumns: Column<UserRow>[] = [
    {
      key: "user", header: t("table.column.name"),
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
      key: "company", header: t("companies.title"),
      cell: (r) => <span className="text-sm text-muted-foreground">{r.companyName || "—"}</span>,
    },
    { key: "role", header: "Role", cell: (r) => <RoleBadge role={r.role} icon={ShieldCheck} /> },
    {
      key: "active", header: t("status.ACTIVE"),
      cell: (r) => (
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${r.isActive ? "bg-success/10 text-success border-success/20" : "bg-muted text-muted-foreground border-border"}`}>
          {r.isActive ? t("status.ACTIVE") : t("status.INACTIVE")}
        </span>
      ),
    },
    { key: "lastLogin", header: t("audit.timestamp"), cell: (r) => <span className="text-xs text-muted-foreground">{r.lastLoginAt ? new Date(r.lastLoginAt).toLocaleString() : "—"}</span> },
    { key: "actions", header: t("action.actions"), headerClassName: "text-end", className: "text-end",
      cell: () => <Button variant="ghost" size="sm" className="h-8">{t("action.edit")}</Button>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("settings.title")}
        subtitle={t("settings.subtitle")}
        icon={SettingsIcon}
        actions={<Button onClick={handleSave} disabled={saving || loading}>{saving ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <Save className="h-4 w-4 me-1.5" />}{t("settings.save")}</Button>}
      />

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="general">{t("settings.tab.general")}</TabsTrigger>
          <TabsTrigger value="branding">{t("settings.tab.branding")}</TabsTrigger>
          <TabsTrigger value="notifications">{t("settings.tab.notifications")}</TabsTrigger>
          <TabsTrigger value="security">{t("settings.tab.security")}</TabsTrigger>
          <TabsTrigger value="email">{t("settings.tab.email")}</TabsTrigger>
          <TabsTrigger value="users">{t("settings.tab.users")}</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <Card className="p-6 max-w-2xl">
            {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
              <FormGrid>
                <Field label={t("settings.systemName")}>
                  <Input value={settings["system.name"] ?? ""} onChange={(e) => setSetting("system.name", e.target.value)} />
                </Field>
                <Field label={t("settings.defaultLanguage")}>
                  <Select value={settings["system.defaultLanguage"] ?? "en"} onValueChange={(v) => setSetting("system.defaultLanguage", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="ar">العربية</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("settings.timezone")}>
                  <Select value={settings["system.timezone"] ?? "Asia/Riyadh"} onValueChange={(v) => setSetting("system.timezone", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Asia/Riyadh">Asia/Riyadh (GMT+3)</SelectItem>
                      <SelectItem value="Asia/Dubai">Asia/Dubai (GMT+4)</SelectItem>
                      <SelectItem value="UTC">UTC</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={t("settings.dateFormat")}>
                  <Select value={settings["system.dateFormat"] ?? "YYYY-MM-DD"} onValueChange={(v) => setSetting("system.dateFormat", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="YYYY-MM-DD">YYYY-MM-DD</SelectItem>
                      <SelectItem value="DD/MM/YYYY">DD/MM/YYYY</SelectItem>
                      <SelectItem value="MM/DD/YYYY">MM/DD/YYYY</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
              </FormGrid>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="branding" className="mt-4">
          <Card className="p-6 max-w-2xl">
            {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
              <FormGrid>
                <Field label={t("settings.logoUrl")}>
                  <Input value={settings["branding.logoUrl"] ?? ""} onChange={(e) => setSetting("branding.logoUrl", e.target.value)} />
                </Field>
                <Field label={t("settings.primaryColor")}>
                  <div className="flex items-center gap-2">
                    <Input type="color" value={settings["branding.primaryColor"] ?? "#0d9488"} onChange={(e) => setSetting("branding.primaryColor", e.target.value)} className="h-9 w-16 p-1" />
                    <Input value={settings["branding.primaryColor"] ?? "#0d9488"} onChange={(e) => setSetting("branding.primaryColor", e.target.value)} className="font-mono" />
                  </div>
                </Field>
              </FormGrid>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          <Card className="p-6 max-w-2xl space-y-4">
            {[
              { key: "notif.newRequest", label: "New training request" },
              { key: "notif.sessionScheduled", label: "Session scheduled" },
              { key: "notif.certIssued", label: "Certificate issued" },
              { key: "notif.qualExpiring", label: "Trainer qualification expiring" },
              { key: "notif.lowAttendance", label: "Low attendance alert" },
            ].map((s) => (
              <div key={s.key} className="flex items-center justify-between border-b pb-3 last:border-0 last:pb-0">
                <div>
                  <div className="text-sm font-medium">{s.label}</div>
                  <div className="text-xs text-muted-foreground">Email + in-app</div>
                </div>
                <Switch checked={bool(settings[s.key])} onCheckedChange={(v) => setSetting(s.key, String(v))} />
              </div>
            ))}
          </Card>
        </TabsContent>

        <TabsContent value="security" className="mt-4">
          <Card className="p-6 max-w-2xl space-y-5">
            <div>
              <h3 className="text-sm font-semibold mb-3">{t("settings.passwordPolicy")}</h3>
              <FormGrid cols={3}>
                <Field label={t("settings.minLength")}>
                  <Input type="number" min={6} value={settings["security.passwordMinLength"] ?? "8"} onChange={(e) => setSetting("security.passwordMinLength", e.target.value)} />
                </Field>
              </FormGrid>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex items-center gap-2 text-sm"><Switch checked={bool(settings["security.requireUppercase"])} onCheckedChange={(v) => setSetting("security.requireUppercase", String(v))} /> {t("settings.requireUppercase")}</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={bool(settings["security.requireNumbers"])} onCheckedChange={(v) => setSetting("security.requireNumbers", String(v))} /> {t("settings.requireNumbers")}</label>
                <label className="flex items-center gap-2 text-sm"><Switch checked={bool(settings["security.requireSymbols"])} onCheckedChange={(v) => setSetting("security.requireSymbols", String(v))} /> {t("settings.requireSymbols")}</label>
              </div>
            </div>
            <div className="border-t pt-4">
              <Field label={t("settings.sessionTimeout")}>
                <Input type="number" min={5} value={settings["security.sessionTimeoutMinutes"] ?? "30"} onChange={(e) => setSetting("security.sessionTimeoutMinutes", e.target.value)} />
              </Field>
            </div>
            <div className="border-t pt-4">
              <label className="flex items-center gap-2 text-sm"><Switch checked={bool(settings["security.twoFactorEnabled"])} onCheckedChange={(v) => setSetting("security.twoFactorEnabled", String(v))} /> {t("settings.twoFactor")}</label>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="email" className="mt-4">
          <Card className="p-6 max-w-2xl space-y-5">
            {loading ? <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /> : (
              <>
                <FormGrid>
                  <Field label={t("settings.smtpHost")}>
                    <Input value={settings["email.smtpHost"] ?? ""} onChange={(e) => setSetting("email.smtpHost", e.target.value)} placeholder="smtp.gmail.com" />
                  </Field>
                  <Field label={t("settings.smtpPort")}>
                    <Input type="number" value={settings["email.smtpPort"] ?? "587"} onChange={(e) => setSetting("email.smtpPort", e.target.value)} />
                  </Field>
                  <Field label={t("settings.smtpUser")}>
                    <Input value={settings["email.smtpUser"] ?? ""} onChange={(e) => setSetting("email.smtpUser", e.target.value)} placeholder="noreply@gcclab.com" />
                  </Field>
                  <Field label={t("settings.smtpPassword")}>
                    {/* Left empty means "keep the stored password" — saving the form
                        without retyping it must not wipe the secret. */}
                    <Input
                      type="password"
                      autoComplete="new-password"
                      value={settings["email.smtpPassword"] ?? ""}
                      onChange={(e) => setSetting("email.smtpPassword", e.target.value)}
                      placeholder={secretsSet["email.smtpPassword"] ? t("settings.smtpPasswordSet") : ""}
                    />
                  </Field>
                  <Field label={t("settings.smtpFrom")}>
                    <Input type="email" value={settings["email.smtpFrom"] ?? ""} onChange={(e) => setSetting("email.smtpFrom", e.target.value)} placeholder="noreply@gcclab.com" />
                  </Field>
                  <Field label={t("settings.replyTo")}>
                    <Input type="email" value={settings["email.replyTo"] ?? ""} onChange={(e) => setSetting("email.replyTo", e.target.value)} />
                  </Field>
                </FormGrid>

                <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
                  <div>
                    <div className="text-sm font-medium">{t("settings.smtpSecure")}</div>
                    <div className="text-xs text-muted-foreground">{t("settings.smtpSecureHint")}</div>
                  </div>
                  <Switch
                    checked={settings["email.smtpSecure"] === "true"}
                    onCheckedChange={(v) => setSetting("email.smtpSecure", v ? "true" : "false")}
                  />
                </div>

                <div className="border-t pt-4 space-y-3">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <p className="text-xs text-muted-foreground max-w-sm">{t("settings.emailTestHint")}</p>
                    <Button variant="outline" size="sm" disabled={testingEmail} onClick={() => void handleTestEmail()}>
                      {testingEmail ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <Send className="h-4 w-4 me-1.5" />}
                      {t("settings.sendTest")}
                    </Button>
                  </div>

                  {emailTestResult && (
                    <div
                      className={
                        emailTestResult.status === "SENT"
                          ? "flex items-start gap-2 rounded-md border border-success/30 bg-success/5 p-3 text-xs"
                          : emailTestResult.status === "SIMULATED"
                            ? "flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs"
                            : "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive"
                      }
                    >
                      {emailTestResult.status === "SENT" ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> : <MailWarning className="h-4 w-4 shrink-0" />}
                      <span>
                        {emailTestResult.status === "SENT"
                          ? t("settings.testSent", { to: emailTestResult.to ?? "" })
                          : emailTestResult.status === "SIMULATED"
                            ? (emailTestResult.message ?? t("settings.testSimulated"))
                            : (emailTestResult.error ?? t("settings.testFailed"))}
                      </span>
                    </div>
                  )}
                </div>
              </>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          {usersList.error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive mb-3">
              <AlertCircle className="h-4 w-4" /> {usersList.error}
            </div>
          )}
          <DataTable
            columns={userColumns}
            data={usersList.data}
            loading={usersList.loading}
            rowKey={(r) => r.id}
            searchable
            searchValue={usersList.search}
            onSearchChange={usersList.setSearch}
            page={usersList.page}
            total={usersList.pagination?.total ?? 0}
            pageSize={usersList.pagination?.pageSize ?? 10}
            onPageChange={usersList.setPage}
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
