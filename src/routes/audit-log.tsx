"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Field, FormGrid } from "@/components/common/form-dialog";
import { ScrollText, Download, User, Clock, AlertCircle } from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { useAppStore } from "@/lib/store/app-store";

interface AuditRow {
  id: string;
  userName?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  description: string;
  ipAddress?: string | null;
  createdAt: string;
}

const ACTIONS = ["CREATE", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "APPROVE", "REJECT", "ISSUE", "REVOKE"];
const ENTITIES = ["COMPANY", "TRAINER", "COURSE", "REQUEST", "SESSION", "CERTIFICATE", "USER", "SETTING"];

const ACTION_STYLES: Record<string, string> = {
  CREATE: "bg-success/10 text-success border-success/20",
  UPDATE: "bg-info/10 text-info border-info/20",
  DELETE: "bg-destructive/10 text-destructive border-destructive/20",
  LOGIN: "bg-primary/10 text-primary border-primary/20",
  LOGOUT: "bg-muted text-muted-foreground border-border",
  APPROVE: "bg-success/10 text-success border-success/20",
  REJECT: "bg-destructive/10 text-destructive border-destructive/20",
  ISSUE: "bg-warning/10 text-warning border-warning/20",
  REVOKE: "bg-destructive/10 text-destructive border-destructive/20",
};

export function AuditLogRoute() {
  const { t } = useI18n();
  const { user } = useAppStore();
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");

  const extra: Record<string, string | undefined> = {};
  if (action) extra.action = action;
  if (entity) extra.entity = entity;

  const { data, pagination, loading, error, page, setPage, search, setSearch } =
    useList<AuditRow>("/audit-log", { extraParams: extra });

  const columns: Column<AuditRow>[] = [
    {
      key: "timestamp",
      header: t("audit.timestamp"),
      cell: (r) => <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Clock className="h-3 w-3" />{new Date(r.createdAt).toLocaleString()}</div>,
    },
    {
      key: "user",
      header: t("audit.user"),
      cell: (r) => <div className="flex items-center gap-2 text-sm"><User className="h-3.5 w-3.5 text-muted-foreground" />{r.userName || "—"}</div>,
    },
    {
      key: "action",
      header: t("audit.action"),
      cell: (r) => (
        <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium ${ACTION_STYLES[r.action] ?? ACTION_STYLES.UPDATE}`}>
          {r.action}
        </span>
      ),
    },
    {
      key: "entity",
      header: t("audit.entity"),
      cell: (r) => (
        <div className="text-sm">
          <div className="font-medium">{r.entity}</div>
          <div className="text-xs text-muted-foreground font-mono">{r.entityId || "—"}</div>
        </div>
      ),
    },
    { key: "description", header: t("audit.description"), cell: (r) => <span className="text-xs text-muted-foreground">{r.description}</span> },
    { key: "ip", header: t("audit.ipAddress"), cell: (r) => <span className="text-xs text-muted-foreground font-mono">{r.ipAddress || "—"}</span> },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("audit.title")}
        subtitle={t("audit.subtitle")}
        icon={ScrollText}
        actions={<Button variant="outline"><Download className="h-4 w-4 me-1.5" />{t("action.export")}</Button>}
      />

      <Card className="p-4">
        <FormGrid cols={3}>
          <Field label={t("audit.action")}>
            <Select value={action || "ALL"} onValueChange={(v) => setAction(v === "ALL" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("misc.all")}</SelectItem>
                {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("audit.entity")}>
            <Select value={entity || "ALL"} onValueChange={(v) => setEntity(v === "ALL" ? "" : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">{t("misc.all")}</SelectItem>
                {ENTITIES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("action.search")}>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("audit.description")} />
          </Field>
        </FormGrid>
      </Card>

      {error && (
        <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        rowKey={(r) => r.id}
        page={page}
        total={pagination?.total ?? 0}
        pageSize={pagination?.pageSize ?? 10}
        onPageChange={setPage}
        emptyIcon={ScrollText}
        emptyTitle={t("audit.empty.title")}
        emptySubtitle={t("audit.empty.subtitle")}
      />
    </div>
  );
}
