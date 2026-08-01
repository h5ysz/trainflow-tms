"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { FormDialog, Field, FormGrid } from "@/components/common/form-dialog";
import { RowActions } from "@/components/common/row-actions";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge } from "@/components/common/status-badge";
import { CalendarClock, Plus, Play, RotateCcw, AlertCircle, Mail, Loader2, Download } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { api, downloadFile } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { useAppStore } from "@/lib/store/app-store";
import { canAccessModule } from "@/lib/auth/permissions";
import { useEntityActions } from "@/hooks/use-entity-actions";

interface Template { code: string; name: string; }

interface Schedule {
  id: string;
  name: string;
  nameAr?: string | null;
  description?: string | null;
  templateCode: string;
  scheduleType: string;
  cronExpression?: string | null;
  executionTime?: string | null;
  dayOfWeek?: number | null;
  dayOfMonth?: number | null;
  exportFormats: string[];
  recipients: string[];
  isActive: boolean;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
}

interface ExecutionFile {
  id: string;
  format: string;
  filename: string;
  sizeBytes: number;
}

interface Execution {
  id: string;
  scheduleId: string;
  templateCode: string;
  status: string;
  triggerType: string;
  rowCount?: number | null;
  emailStatus?: string | null;
  attemptNumber: number;
  startedAt: string;
  /** Stored xlsx/pdf files, downloadable until they expire. */
  files?: ExecutionFile[];
}

const SCHEDULE_TYPES = ["WEEKLY", "MONTHLY", "CUSTOM"];
const EXPORT_FORMATS = ["xlsx", "pdf", "csv"];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

// Timezone is fixed server-side to Asia/Riyadh, so there's no field for it.
const NEW_SCHEDULE = {
  scheduleType: "MONTHLY",
  executionTime: "09:00",
  dayOfMonth: 1,
  exportFormats: ["xlsx"],
  recipients: [] as string[],
  isActive: true,
  maxRetries: 3,
  retryDelayMin: 10,
};

export function ReportSchedulesRoute() {
  const { t, locale } = useI18n();
  const { toast } = useToast();
  const { user } = useAppStore();

  const canAccess = canAccessModule(user?.permissions ?? [], "report-schedules");

  const schedules = useList<Schedule>("/report-schedules");
  const executions = useList<Execution>("/report-executions");

  const [templates, setTemplates] = useState<Template[]>([]);
  const [recipientsText, setRecipientsText] = useState("");
  const [running, setRunning] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [downloadingFile, setDownloadingFile] = useState<string | null>(null);

  const {
    canCreate, canEdit, canDelete,
    dialogOpen, isEditing, formData, setField, submitting, submit, requireFields,
    openCreate, openEdit, closeDialog,
    deleteTarget, setDeleteTarget, deleting, confirmDelete,
  } = useEntityActions<Schedule>({
    resource: "/report-schedules",
    module: "report-schedules",
    refetch: schedules.refetch,
    fetchOnEdit: true,
  });

  useEffect(() => {
    if (dialogOpen && templates.length === 0) {
      api.get<Template[]>("/report-templates")
        .then((r) => setTemplates(r))
        .catch(() => {});
    }
  }, [dialogOpen, templates.length]);

  // Keep the free-text recipients box in sync when a record is loaded for edit.
  useEffect(() => {
    // Seeds an editable free-text field from the loaded record. It must be a one-time
    // copy rather than derived state, because the user then edits it independently.
    if (dialogOpen) setRecipientsText(((formData.recipients as string[]) ?? []).join(", "));
    // Only when the dialog opens or a different record loads.
  }, [dialogOpen, formData.id]);

  if (!canAccess) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-sm text-muted-foreground">{t("misc.noAccess")}</p>
      </div>
    );
  }

  const commitRecipients = (text: string) => {
    setRecipientsText(text);
    setField("recipients", text.split(",").map((s) => s.trim()).filter(Boolean));
  };

  const toggleFormat = (fmt: string) => {
    const current = (formData.exportFormats as string[]) ?? [];
    setField("exportFormats", current.includes(fmt) ? current.filter((f) => f !== fmt) : [...current, fmt]);
  };

  const handleSubmit = () =>
    void submit(requireFields({
      [t("schedules.name")]: "name",
      [t("schedules.template")]: "templateCode",
      [t("schedules.type")]: "scheduleType",
    }));

  const runNow = async (row: Schedule) => {
    setRunning(row.id);
    try {
      await api.post(`/report-schedules/${row.id}/run`, {});
      toast({ title: t("misc.success"), description: t("schedules.runQueued") });
      schedules.refetch();
      executions.refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setRunning(null);
    }
  };

  const retry = async (row: Execution) => {
    setRetrying(row.id);
    try {
      await api.post(`/report-executions/${row.id}/retry`, {});
      toast({ title: t("misc.success"), description: t("schedules.retryQueued") });
      executions.refetch();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setRetrying(null);
    }
  };

  const scheduleSummary = (r: Schedule) => {
    if (r.scheduleType === "CUSTOM") return r.cronExpression ?? "—";
    if (r.scheduleType === "WEEKLY") {
      const day = new Date(2024, 0, 7 + (r.dayOfWeek ?? 0)).toLocaleDateString(
        locale === "en" ? "en-GB" : "ar-SA", { weekday: "long" }
      );
      return `${day} · ${r.executionTime ?? ""}`;
    }
    return `${t("schedules.dayOfMonth")} ${r.dayOfMonth ?? 1} · ${r.executionTime ?? ""}`;
  };

  const scheduleColumns: Column<Schedule>[] = [
    {
      key: "name",
      header: t("schedules.name"),
      cell: (r) => (
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary shrink-0">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-medium">{locale === "ar" && r.nameAr ? r.nameAr : r.name}</div>
            <div className="text-xs font-mono text-muted-foreground">{r.templateCode}</div>
          </div>
        </div>
      ),
    },
    {
      key: "schedule",
      header: t("schedules.schedule"),
      cell: (r) => (
        <div>
          <div className="text-sm">{scheduleSummary(r)}</div>
          <div className="text-xs text-muted-foreground">{r.scheduleType}</div>
        </div>
      ),
    },
    {
      key: "formats",
      header: t("schedules.formats"),
      cell: (r) => (
        <div className="flex gap-1">
          {(r.exportFormats ?? []).map((f) => (
            <Badge key={f} variant="secondary" className="text-[10px] uppercase">{f}</Badge>
          ))}
        </div>
      ),
    },
    {
      key: "recipients",
      header: t("schedules.recipients"),
      cell: (r) => (
        <div className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Mail className="h-3 w-3" />
          {r.recipients?.length ? `${r.recipients.length}` : "—"}
        </div>
      ),
    },
    {
      key: "active",
      header: t("schedules.active"),
      cell: (r) => <StatusBadge status={r.isActive ? "ACTIVE" : "INACTIVE"} />,
    },
    {
      key: "lastRun",
      header: t("schedules.lastRun"),
      cell: (r) => (
        <span className="text-xs text-muted-foreground">
          {r.lastRunAt ? new Date(r.lastRunAt).toLocaleString() : "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: (row) => (
        <div className="flex justify-end items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            disabled={running === row.id}
            onClick={() => void runNow(row)}
          >
            {running === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            {t("schedules.runNow")}
          </Button>
          <RowActions
            canEdit={canEdit}
            canDelete={canDelete}
            onEdit={() => void openEdit(row)}
            onDelete={() => setDeleteTarget(row)}
          />
        </div>
      ),
    },
  ];

  const handleDownloadFile = async (executionId: string, file: ExecutionFile) => {
    setDownloadingFile(file.id);
    try {
      await downloadFile(
        `/report-executions/${executionId}/files/${file.id}`,
        file.filename,
        { method: "GET" }
      );
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setDownloadingFile(null);
    }
  };

  const executionColumns: Column<Execution>[] = [
    {
      key: "template",
      header: t("schedules.template"),
      cell: (r) => <span className="font-mono text-xs font-semibold">{r.templateCode}</span>,
    },
    { key: "status", header: t("schedules.status"), cell: (r) => <StatusBadge status={r.status} /> },
    {
      key: "trigger",
      header: t("schedules.trigger"),
      cell: (r) => <span className="text-xs text-muted-foreground">{r.triggerType}</span>,
    },
    {
      key: "rows",
      header: t("schedules.rowCount"),
      cell: (r) => <span className="text-sm tabular-nums">{r.rowCount ?? "—"}</span>,
    },
    {
      key: "email",
      header: t("schedules.emailStatus"),
      cell: (r) => <span className="text-xs text-muted-foreground">{r.emailStatus ?? "—"}</span>,
    },
    {
      key: "files",
      header: t("schedules.files"),
      cell: (r) =>
        r.files && r.files.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {r.files.map((f) => (
              <Button
                key={f.id}
                variant="ghost"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                disabled={downloadingFile === f.id}
                title={`${f.filename} · ${formatBytes(f.sizeBytes)}`}
                onClick={() => void handleDownloadFile(r.id, f)}
              >
                {downloadingFile === f.id
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Download className="h-3 w-3" />}
                {f.format.toUpperCase()}
              </Button>
            ))}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">—</span>
        ),
    },
    {
      key: "attempt",
      header: t("schedules.attempt"),
      cell: (r) => <span className="text-xs tabular-nums">{r.attemptNumber}</span>,
    },
    {
      key: "startedAt",
      header: t("schedules.startedAt"),
      cell: (r) => (
        <span className="text-xs text-muted-foreground">{new Date(r.startedAt).toLocaleString()}</span>
      ),
    },
    {
      key: "actions",
      header: t("action.actions"),
      headerClassName: "text-end",
      className: "text-end",
      cell: (row) =>
        row.status === "FAILED" ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            disabled={retrying === row.id}
            onClick={() => void retry(row)}
          >
            {retrying === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            {t("schedules.retry")}
          </Button>
        ) : null,
    },
  ];

  const newButton = canCreate && (
    <Button onClick={() => openCreate(NEW_SCHEDULE)}>
      <Plus className="h-4 w-4 me-1.5" />
      {t("schedules.new")}
    </Button>
  );

  const scheduleType = (formData.scheduleType as string) ?? "MONTHLY";

  return (
    <div className="space-y-5">
      <PageHeader title={t("schedules.title")} subtitle={t("schedules.subtitle")} icon={CalendarClock} />

      <Tabs defaultValue="schedules">
        <TabsList>
          <TabsTrigger value="schedules">{t("schedules.title")}</TabsTrigger>
          <TabsTrigger value="executions">{t("schedules.executions")}</TabsTrigger>
        </TabsList>

        <TabsContent value="schedules" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            {/* Email delivery is stubbed — say so rather than imply mail is sent. */}
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />
              {t("schedules.emailStub")}
            </p>
            {newButton}
          </div>

          {schedules.error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> {schedules.error}
            </div>
          )}

          <DataTable
            columns={scheduleColumns}
            data={schedules.data}
            loading={schedules.loading}
            rowKey={(r) => r.id}
            searchable
            searchValue={schedules.search}
            onSearchChange={schedules.setSearch}
            page={schedules.page}
            total={schedules.pagination?.total ?? 0}
            pageSize={schedules.pagination?.pageSize ?? 10}
            onPageChange={schedules.setPage}
            emptyIcon={CalendarClock}
            emptyTitle={t("schedules.empty.title")}
            emptySubtitle={t("schedules.empty.subtitle")}
            emptyAction={newButton}
          />
        </TabsContent>

        <TabsContent value="executions" className="mt-4">
          {executions.error && (
            <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" /> {executions.error}
            </div>
          )}
          <DataTable
            columns={executionColumns}
            data={executions.data}
            loading={executions.loading}
            rowKey={(r) => r.id}
            page={executions.page}
            total={executions.pagination?.total ?? 0}
            pageSize={executions.pagination?.pageSize ?? 10}
            onPageChange={executions.setPage}
            emptyIcon={CalendarClock}
            emptyTitle={t("schedules.noExecutions")}
            emptySubtitle={t("schedules.noExecutionsSubtitle")}
          />
        </TabsContent>
      </Tabs>

      <FormDialog
        open={dialogOpen}
        onOpenChange={(o) => !o && closeDialog()}
        title={isEditing ? t("schedules.edit") : t("schedules.new")}
        description={t("schedules.subtitle")}
        icon={CalendarClock}
        size="lg"
        onSubmit={handleSubmit}
        isSubmitting={submitting}
      >
        <div className="space-y-5">
          <FormGrid>
            <Field label={t("schedules.name")} required>
              <Input value={(formData.name as string) ?? ""} onChange={(e) => setField("name", e.target.value)} />
            </Field>
            <Field label={t("schedules.nameAr")}>
              <Input dir="rtl" value={(formData.nameAr as string) ?? ""} onChange={(e) => setField("nameAr", e.target.value)} />
            </Field>
            <Field label={t("schedules.template")} required>
              <Select value={(formData.templateCode as string) ?? ""} onValueChange={(v) => setField("templateCode", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {templates.map((tpl) => <SelectItem key={tpl.code} value={tpl.code}>{tpl.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label={t("schedules.type")} required>
              <Select value={scheduleType} onValueChange={(v) => setField("scheduleType", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCHEDULE_TYPES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </FormGrid>

          <Field label={t("schedules.description")}>
            <Textarea rows={2} value={(formData.description as string) ?? ""} onChange={(e) => setField("description", e.target.value)} />
          </Field>

          <div className="border-t pt-4">
            <FormGrid>
              {scheduleType !== "CUSTOM" && (
                <Field label={t("schedules.executionTime")} hint="Asia/Riyadh">
                  <Input type="time" value={(formData.executionTime as string) ?? "09:00"} onChange={(e) => setField("executionTime", e.target.value)} />
                </Field>
              )}
              {scheduleType === "WEEKLY" && (
                <Field label={t("schedules.dayOfWeek")}>
                  <Select
                    value={String((formData.dayOfWeek as number) ?? 0)}
                    onValueChange={(v) => setField("dayOfWeek", parseInt(v, 10))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {new Date(2024, 0, 7 + d).toLocaleDateString(locale === "en" ? "en-GB" : "ar-SA", { weekday: "long" })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              {scheduleType === "MONTHLY" && (
                <Field label={t("schedules.dayOfMonth")}>
                  <Input
                    type="number"
                    min={1}
                    max={31}
                    value={(formData.dayOfMonth as number) ?? 1}
                    onChange={(e) => setField("dayOfMonth", parseInt(e.target.value, 10) || 1)}
                  />
                </Field>
              )}
              {scheduleType === "CUSTOM" && (
                <Field label={t("schedules.cron")} hint="0 9 1 * *">
                  <Input
                    className="font-mono"
                    value={(formData.customCron as string) ?? ""}
                    onChange={(e) => setField("customCron", e.target.value)}
                  />
                </Field>
              )}
            </FormGrid>
          </div>

          <div className="border-t pt-4 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium">{t("schedules.formats")}</label>
              <div className="flex items-center gap-5">
                {EXPORT_FORMATS.map((f) => (
                  <label key={f} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={((formData.exportFormats as string[]) ?? []).includes(f)}
                      onCheckedChange={() => toggleFormat(f)}
                    />
                    <span className="uppercase text-xs font-mono">{f}</span>
                  </label>
                ))}
              </div>
            </div>

            <Field label={t("schedules.recipients")} hint={t("schedules.recipientsHint")}>
              <Input
                value={recipientsText}
                onChange={(e) => commitRecipients(e.target.value)}
                placeholder="ops@gcclab.com, qa@gcclab.com"
              />
            </Field>

            <label className="flex items-center gap-2 text-sm">
              <Switch
                checked={(formData.isActive as boolean) ?? true}
                onCheckedChange={(v) => setField("isActive", v)}
              />
              {t("schedules.active")}
            </label>
          </div>
        </div>
      </FormDialog>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        description={deleteTarget?.name}
        destructive
        loading={deleting}
        onConfirm={() => void confirmDelete()}
      />
    </div>
  );
}

// Human-readable file size for the download button tooltip.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
