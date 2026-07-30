"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { DataTable, type Column } from "@/components/common/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  ScrollText, Download, User, Clock, AlertCircle, Globe, Monitor,
  Smartphone, Tablet, Filter, History,
} from "lucide-react";
import { useList } from "@/lib/api/hooks";
import { useAppStore } from "@/lib/store/app-store";

interface AuditRow {
  id: string;
  userName?: string | null;
  userEmail?: string | null;
  userRole?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  entityRef?: string | null;
  description: string;
  descriptionAr?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  browser?: string | null;
  device?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  metadata?: unknown;
  createdAt: string;
}

const ACTIONS = [
  "LOGIN", "LOGOUT", "FAILED_LOGIN", "CREATE", "UPDATE", "DELETE",
  "APPROVE", "REJECT", "ISSUE", "ISSUE_CERT", "RENEW_CERT",
  "REVOKE", "CERTIFICATE_GENERATE", "GENERATE_QR", "VERIFY_QR",
  "QR_REGENERATE", "CREATE_WORKER", "UPDATE_WORKER", "DELETE_WORKER",
  "CREATE_COMPANY", "UPDATE_COMPANY", "COMPLIANCE_CHANGE", "PERMISSION_CHANGE",
  "STATUS_CHANGE", "EXAM_SUBMIT", "EXPORT",
];

const ENTITIES = [
  "COMPANY", "TRAINER", "TRAINEE", "COURSE", "REQUEST", "SESSION",
  "CERTIFICATE", "USER", "ROLE", "SETTING", "EXAM", "ATTENDANCE",
  "EVALUATION", "WORKER_PASSPORT", "COMPLIANCE_RULE", "QR_CODE",
];

const ACTION_STYLES: Record<string, string> = {
  CREATE: "bg-success/10 text-success border-success/20",
  UPDATE: "bg-info/10 text-info border-info/20",
  DELETE: "bg-destructive/10 text-destructive border-destructive/20",
  LOGIN: "bg-primary/10 text-primary border-primary/20",
  LOGOUT: "bg-muted text-muted-foreground border-border",
  FAILED_LOGIN: "bg-destructive/10 text-destructive border-destructive/20",
  APPROVE: "bg-success/10 text-success border-success/20",
  REJECT: "bg-destructive/10 text-destructive border-destructive/20",
  ISSUE: "bg-warning/10 text-warning border-warning/20",
  ISSUE_CERT: "bg-success/10 text-success border-success/20",
  RENEW_CERT: "bg-info/10 text-info border-info/20",
  REVOKE: "bg-destructive/10 text-destructive border-destructive/20",
  CERTIFICATE_GENERATE: "bg-primary/10 text-primary border-primary/20",
  GENERATE_QR: "bg-primary/10 text-primary border-primary/20",
  VERIFY_QR: "bg-info/10 text-info border-info/20",
  QR_REGENERATE: "bg-warning/10 text-warning border-warning/20",
  CREATE_WORKER: "bg-success/10 text-success border-success/20",
  UPDATE_WORKER: "bg-info/10 text-info border-info/20",
  DELETE_WORKER: "bg-destructive/10 text-destructive border-destructive/20",
  CREATE_COMPANY: "bg-success/10 text-success border-success/20",
  UPDATE_COMPANY: "bg-info/10 text-info border-info/20",
  COMPLIANCE_CHANGE: "bg-warning/10 text-warning border-warning/20",
  PERMISSION_CHANGE: "bg-destructive/10 text-destructive border-destructive/20",
  STATUS_CHANGE: "bg-info/10 text-info border-info/20",
  EXAM_SUBMIT: "bg-warning/10 text-warning border-warning/20",
  EXPORT: "bg-muted text-muted-foreground border-border",
};

function DeviceIcon({ device }: { device: string | null }) {
  if (!device) return null;
  if (device === "Desktop") return <Monitor className="h-3 w-3" />;
  if (device === "iPad" || device === "Tablet") return <Tablet className="h-3 w-3" />;
  if (device?.includes("Phone") || device === "Mobile" || device === "Android") return <Smartphone className="h-3 w-3" />;
  return <Monitor className="h-3 w-3" />;
}

export function AuditLogRoute() {
  const { t, locale } = useI18n();
  const { user } = useAppStore();
  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState<string>("ALL");
  const [entityFilter, setEntityFilter] = useState<string>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [detailRow, setDetailRow] = useState<AuditRow | null>(null);

  const isSuperAdmin = user?.role === "SUPER_ADMIN";

  // Build query string
  const qs = new URLSearchParams();
  if (search) qs.set("search", search);
  if (actionFilter !== "ALL") qs.set("filters.action", actionFilter);
  if (entityFilter !== "ALL") qs.set("filters.entity", entityFilter);
  if (dateFrom) qs.set("dateFrom", dateFrom);
  if (dateTo) qs.set("dateTo", dateTo);

  const { data, pagination, loading, error, page, setPage } = useList<AuditRow>(
    `/audit-log?${qs.toString()}`
  );

  const handleExport = () => {
    const exportQs = new URLSearchParams();
    if (actionFilter !== "ALL") exportQs.set("action", actionFilter);
    if (entityFilter !== "ALL") exportQs.set("entity", entityFilter);
    if (dateFrom) exportQs.set("dateFrom", dateFrom);
    if (dateTo) exportQs.set("dateTo", dateTo);
    window.location.href = `/api/audit-log/export?${exportQs.toString()}`;
  };

  const columns: Column<AuditRow>[] = [
    {
      key: "createdAt",
      header: locale === "en" ? "Date & Time" : "التاريخ والوقت",
      cell: (row) => (
        <div className="text-xs">
          <div>{new Date(row.createdAt).toLocaleDateString("en-GB")}</div>
          <div className="text-muted-foreground">{new Date(row.createdAt).toLocaleTimeString("en-GB")}</div>
        </div>
      ),
    },
    {
      key: "userName",
      header: locale === "en" ? "User" : "المستخدم",
      cell: (row) => (
        <div>
          <div className="text-sm font-medium">{row.userName ?? "System"}</div>
          <div className="text-xs text-muted-foreground">{row.userEmail ?? ""}</div>
        </div>
      ),
    },
    {
      key: "action",
      header: locale === "en" ? "Action" : "الإجراء",
      cell: (row) => (
        <Badge variant="outline" className={`text-xs ${ACTION_STYLES[row.action] ?? ""}`}>
          {row.action}
        </Badge>
      ),
    },
    {
      key: "entity",
      header: locale === "en" ? "Entity" : "الكيان",
      cell: (row) => (
        <div>
          <div className="text-sm">{row.entity}</div>
          {row.entityRef && <div className="text-xs text-muted-foreground font-mono">{row.entityRef}</div>}
        </div>
      ),
    },
    {
      key: "description",
      header: locale === "en" ? "Description" : "الوصف",
      cell: (row) => <span className="text-xs">{row.description}</span>,
    },
    {
      key: "ipAddress",
      header: locale === "en" ? "IP / Device" : "IP / جهاز",
      cell: (row) => (
        <div className="flex items-center gap-1.5 text-xs">
          {row.ipAddress && <Globe className="h-3 w-3 text-muted-foreground" />}
          <span className="font-mono">{row.ipAddress ?? "—"}</span>
          {row.device && (
            <span className="flex items-center gap-0.5 text-muted-foreground">
              <DeviceIcon device={row.device} />
              {row.browser && <span>{row.browser}</span>}
            </span>
          )}
        </div>
      ),
    },
    {
      key: "actions",
      header: "",
      cell: (row) => (
        <Button size="sm" variant="ghost" className="h-8 gap-1 text-xs" onClick={() => setDetailRow(row)}>
          <History className="h-3.5 w-3.5" />
          {locale === "en" ? "Details" : "تفاصيل"}
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title={locale === "en" ? "Audit Trail" : "سجل التدقيق"}
        subtitle={locale === "en" ? "Complete activity log — immutable, exportable" : "سجل كامل للنشاط — غير قابل للتعديل، قابل للتصدير"}
        actions={
          isSuperAdmin ? (
            <Button size="sm" variant="outline" onClick={handleExport} className="gap-1.5">
              <Download className="h-4 w-4" />
              {locale === "en" ? "Export CSV" : "تصدير CSV"}
            </Button>
          ) : undefined
        }
      />

      {/* Security notice */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-center gap-3">
        <AlertCircle className="h-5 w-5 text-amber-600 shrink-0" />
        <div className="text-sm">
          <p className="font-medium text-amber-800">
            {locale === "en" ? "Audit logs are immutable" : "سجلات التدقيق غير قابلة للتعديل"}
          </p>
          <p className="text-xs text-amber-600">
            {locale === "en"
              ? "Only Super Admin can export. Coordinator has read-only access."
              : "فقط المدير العام يمكنه التصدير. المنسق لديه صلاحية قراءة فقط."}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={locale === "en" ? "Search description, user, entity..." : "بحث..."}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 max-w-[200px]"
        />
        <Select value={actionFilter} onValueChange={setActionFilter}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder={locale === "en" ? "All actions" : "كل الإجراءات"} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{locale === "en" ? "All actions" : "كل الإجراءات"}</SelectItem>
            {ACTIONS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={entityFilter} onValueChange={setEntityFilter}>
          <SelectTrigger className="h-9 w-[160px]"><SelectValue placeholder={locale === "en" ? "All entities" : "كل الكيانات"} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{locale === "en" ? "All entities" : "كل الكيانات"}</SelectItem>
            {ENTITIES.map((e) => <SelectItem key={e} value={e}>{e}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-9 max-w-[140px]" />
        <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-9 max-w-[140px]" />
      </div>

      {/* Table */}
      <Card className="p-0">
        <DataTable
          data={data}
          columns={columns}
          loading={loading}
          rowKey={(r) => r.id}
          page={page}
          pageSize={pagination?.pageSize ?? 20}
          total={pagination?.total ?? 0}
          onPageChange={setPage}
          emptyIcon={ScrollText}
          emptyTitle={locale === "en" ? "No audit entries" : "لا توجد سجلات"}
          emptySubtitle={locale === "en" ? "Adjust filters or perform an action" : "اضبط الفلاتر أو قم بإجراء"}
        />
      </Card>

      {/* Detail dialog */}
      <Dialog open={!!detailRow} onOpenChange={(o) => !o && setDetailRow(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              {locale === "en" ? "Audit Entry Details" : "تفاصيل سجل التدقيق"}
            </DialogTitle>
          </DialogHeader>
          {detailRow && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">{locale === "en" ? "Date:" : "التاريخ:"}</span> {new Date(detailRow.createdAt).toLocaleString()}</div>
                <div><span className="text-muted-foreground">{locale === "en" ? "Action:" : "الإجراء:"}</span> <Badge variant="outline" className={`text-xs ${ACTION_STYLES[detailRow.action] ?? ""}`}>{detailRow.action}</Badge></div>
                <div><span className="text-muted-foreground">{locale === "en" ? "User:" : "المستخدم:"}</span> {detailRow.userName ?? "System"}</div>
                <div><span className="text-muted-foreground">{locale === "en" ? "Role:" : "الدور:"}</span> {detailRow.userRole ?? "—"}</div>
                <div><span className="text-muted-foreground">{locale === "en" ? "Entity:" : "الكيان:"}</span> {detailRow.entity}</div>
                <div><span className="text-muted-foreground">{locale === "en" ? "Ref:" : "مرجع:"}</span> <span className="font-mono text-xs">{detailRow.entityRef ?? "—"}</span></div>
                <div><span className="text-muted-foreground">{locale === "en" ? "IP:" : "IP:"}</span> <span className="font-mono text-xs">{detailRow.ipAddress ?? "—"}</span></div>
                <div><span className="text-muted-foreground">{locale === "en" ? "Browser:" : "المتصفح:"}</span> {detailRow.browser ?? "—"}</div>
                <div><span className="text-muted-foreground">{locale === "en" ? "Device:" : "الجهاز:"}</span> {detailRow.device ?? "—"}</div>
                {detailRow.reason && <div><span className="text-muted-foreground">{locale === "en" ? "Reason:" : "السبب:"}</span> {detailRow.reason}</div>}
              </div>
              <div className="border-t pt-2">
                <p className="text-muted-foreground text-xs mb-1">{locale === "en" ? "Description:" : "الوصف:"}</p>
                <p>{detailRow.description}</p>
              </div>
              {detailRow.oldValue != null && (
                <div className="border-t pt-2">
                  <p className="text-muted-foreground text-xs mb-1">{locale === "en" ? "Old Value:" : "القيمة القديمة:"}</p>
                  <pre className="text-xs bg-muted/30 p-2 rounded overflow-x-auto">{JSON.stringify(detailRow.oldValue, null, 2) as string}</pre>
                </div>
              )}
              {detailRow.newValue != null && (
                <div>
                  <p className="text-muted-foreground text-xs mb-1">{locale === "en" ? "New Value:" : "القيمة الجديدة:"}</p>
                  <pre className="text-xs bg-muted/30 p-2 rounded overflow-x-auto">{JSON.stringify(detailRow.newValue, null, 2) as string}</pre>
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDetailRow(null)}>{locale === "en" ? "Close" : "إغلاق"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
