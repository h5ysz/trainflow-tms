"use client";

import * as React from "react";
import { useI18n } from "@/lib/i18n/context";
import { useToast } from "@/hooks/use-toast";
import { api, ApiError } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Upload, Download, FileSpreadsheet, Archive, Eye, Loader2,
  FileText, FileArchive, FileDown, History,
} from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────────

interface ArchiveRequest {
  id: string;
  refNumber: string;
  courseTitle: string | null;
  createdAt: string;
  traineeCount: number;
  status: string;
  hasAttachments: boolean;
  updatedAt?: string;
  attachmentCount?: number;
  courseCount?: number;
}

interface ImportExportLogEntry {
  id: string;
  type: string;
  source: string;
  requestRef: string | null;
  courseName: string | null;
  itemCount: number;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

// ─── Shared: Recent Operations component ────────────────────────────────────

function RecentOperations({ logs, loading }: { logs: ImportExportLogEntry[]; loading: boolean }) {
  const { t } = useI18n();
  if (loading) {
    return (
      <div className="flex items-center justify-center py-3 gap-2 text-[10px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> {t("misc.loading") || "Loading..."}
      </div>
    );
  }
  if (logs.length === 0) {
    return (
      <div className="text-center py-3 text-[10px] text-muted-foreground">
        {t("requests.noRecentOps")}
      </div>
    );
  }
  return (
    <div className="space-y-1 max-h-32 overflow-y-auto">
      {logs.slice(0, 10).map((log) => (
        <div key={log.id} className="flex items-center gap-2 text-[10px] py-1 px-2 rounded hover:bg-muted/40">
          {log.type === "IMPORT" ? (
            <Upload className="h-3 w-3 text-primary shrink-0" />
          ) : (
            <Download className="h-3 w-3 text-primary shrink-0" />
          )}
          <span className="font-medium shrink-0">{log.type}</span>
          {log.requestRef && <span className="font-mono text-muted-foreground">{log.requestRef}</span>}
          {log.courseName && <span className="text-muted-foreground truncate">· {log.courseName}</span>}
          <span className="text-muted-foreground ms-auto shrink-0">
            {new Date(log.createdAt).toLocaleString()}
          </span>
          {log.status === "FAILED" ? (
            <Badge variant="destructive" className="text-[8px] h-3.5 px-1">{t("misc.error") || "Failed"}</Badge>
          ) : (
            <Badge variant="outline" className="text-[8px] h-3.5 px-1 text-emerald-600">{t("misc.success") || "OK"}</Badge>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Hook: load + refresh logs ──────────────────────────────────────────────

function useRecentLogs() {
  const [logs, setLogs] = React.useState<ImportExportLogEntry[]>([]);
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<ImportExportLogEntry[]>("/import-export-logs");
      setLogs(data);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  const addLog = React.useCallback(async (entry: {
    type: string; source: string; requestRef?: string; courseName?: string;
    itemCount?: number; status?: string; errorMessage?: string;
  }) => {
    try {
      await api.post("/import-export-logs", entry);
      await refresh();
    } catch { /* ignore */ }
  }, [refresh]);

  React.useEffect(() => { refresh(); }, [refresh]);

  return { logs, loading, refresh, addLog };
}

// ─── Import Dialog ──────────────────────────────────────────────────────────

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeviceImport: (file: File) => void;
  companyId?: string | null;
  onImportFromArchive?: (requestId: string, items: string[]) => Promise<void>;
}

export function ImportDialog({
  open, onOpenChange, onDeviceImport, onImportFromArchive,
}: ImportDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { logs, loading: logsLoading, addLog } = useRecentLogs();
  const [tab, setTab] = React.useState<"device" | "archive">("device");
  const [archive, setArchive] = React.useState<ArchiveRequest[]>([]);
  const [loadingArchive, setLoadingArchive] = React.useState(false);
  const [selectedRequest, setSelectedRequest] = React.useState<string>("");
  const [importItems, setImportItems] = React.useState<Set<string>>(new Set(["trainees"]));
  const [importing, setImporting] = React.useState(false);
  const [previewTarget, setPreviewTarget] = React.useState<ArchiveRequest | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const GRANULAR_ITEMS = [
    { key: "course_info", label: t("requests.itemCourseInfo") },
    { key: "trainees", label: t("requests.itemTrainees") },
    { key: "attachments", label: t("requests.itemAttachments") },
    { key: "schedule", label: t("requests.itemSchedule") },
    { key: "notes", label: t("requests.itemNotes") },
    { key: "trainer", label: t("requests.itemTrainer") },
    { key: "company_data", label: t("requests.itemCompanyData") },
  ];

  React.useEffect(() => {
    if (tab === "archive" && open && archive.length === 0) {
      setLoadingArchive(true);
      api.getList<ArchiveRequest>("/requests/company-archive", { pageSize: 100 })
        .then((r) => setArchive(r.rows))
        .catch(() => {})
        .finally(() => setLoadingArchive(false));
    }
  }, [tab, open, archive.length]);

  function toggleItem(key: string) {
    setImportItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleArchiveImport() {
    if (!selectedRequest || importItems.size === 0 || !onImportFromArchive) return;
    const selectedArchive = archive.find(a => a.id === selectedRequest);
    setImporting(true);
    try {
      await onImportFromArchive(selectedRequest, Array.from(importItems));
      toast({ title: t("misc.success"), description: t("requests.importedFromArchive") });
      await addLog({
        type: "IMPORT", source: "ARCHIVE",
        requestRef: selectedArchive?.refNumber,
        courseName: selectedArchive?.courseTitle ?? undefined,
        itemCount: selectedArchive?.traineeCount ?? 0,
        status: "SUCCESS",
      });
      onOpenChange(false);
      setSelectedRequest("");
      setImportItems(new Set(["trainees"]));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("requests.importFailed");
      toast({ title: t("misc.error"), description: msg, variant: "destructive" });
      await addLog({
        type: "IMPORT", source: "ARCHIVE",
        requestRef: selectedArchive?.refNumber,
        courseName: selectedArchive?.courseTitle ?? undefined,
        status: "FAILED", errorMessage: msg,
      });
    } finally {
      setImporting(false);
    }
  }

  function handleDeviceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      onDeviceImport(file);
      addLog({ type: "IMPORT", source: "DEVICE", itemCount: 1, status: "SUCCESS" });
      onOpenChange(false);
    }
    e.target.value = "";
  }

  const selectedArchive = archive.find(a => a.id === selectedRequest);
  const previewSummary = selectedArchive ? {
    trainees: selectedArchive.traineeCount,
    attachments: selectedArchive.attachmentCount ?? (selectedArchive.hasAttachments ? 1 : 0),
    courses: selectedArchive.courseCount ?? 1,
    createdDate: new Date(selectedArchive.createdAt).toLocaleDateString(),
    updatedDate: selectedArchive.updatedAt ? new Date(selectedArchive.updatedAt).toLocaleDateString() : "—",
    estSize: `${Math.round((selectedArchive.traineeCount * 0.5 + (selectedArchive.hasAttachments ? 2 : 0)) * 10) / 10} KB`,
  } : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden p-0 gap-0 flex flex-col">
        <DialogHeader className="p-5 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            {t("requests.import")}
          </DialogTitle>
          <DialogDescription className="text-xs">{t("requests.importDesc")}</DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as "device" | "archive")} className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <TabsList className="mx-5 mt-4 w-fit shrink-0">
            <TabsTrigger value="device" className="gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {t("requests.importFromDevice")}
            </TabsTrigger>
            <TabsTrigger value="archive" className="gap-1.5">
              <Archive className="h-3.5 w-3.5" />
              {t("requests.importFromArchive")}
            </TabsTrigger>
          </TabsList>

          {/* ─── Device Tab ─── */}
          <TabsContent value="device" className="m-0 p-5 overflow-y-auto flex-1 min-h-0">
            <div
              className="flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-muted-foreground/30 p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">{t("requests.dropExcel")}</div>
                <div className="text-xs text-muted-foreground mt-1">{t("requests.excelFormat")}</div>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={handleDeviceFile} />
            </div>
          </TabsContent>

          {/* ─── Archive Tab ─── */}
          <TabsContent value="archive" className="m-0 p-5 overflow-y-auto flex-1 min-h-0">
            {loadingArchive ? (
              <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> {t("misc.loading") || "Loading..."}
              </div>
            ) : archive.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">{t("requests.noArchiveRequests")}</div>
            ) : (
              <>
                <div className="space-y-2 mb-4">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    {t("requests.selectRequest")}
                  </div>
                  {archive.map((req) => (
                    <label
                      key={req.id}
                      className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                        selectedRequest === req.id ? "border-primary bg-primary/5" : "hover:bg-muted/30"
                      }`}
                    >
                      <input type="radio" name="archive-request" checked={selectedRequest === req.id}
                        onChange={() => setSelectedRequest(req.id)} className="accent-primary" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-primary">{req.refNumber}</span>
                          <Badge variant="outline" className="text-[9px] h-4">{req.status}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {req.courseTitle ?? "—"} · {new Date(req.createdAt).toLocaleDateString()} · {req.traineeCount} {t("requests.previewTrainees")}
                        </div>
                      </div>
                      {req.hasAttachments && <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                      <Button type="button" variant="ghost" size="sm" className="h-7 px-2"
                        onClick={(e) => { e.preventDefault(); setPreviewTarget(req); }}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </label>
                  ))}
                </div>

                {/* Preview Summary */}
                {previewSummary && (
                  <div className="rounded-md border bg-muted/20 p-3 mb-4">
                    <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                      <Eye className="h-3.5 w-3.5" /> {t("requests.importPreviewSummary")}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="flex flex-col"><span className="text-muted-foreground text-[10px]">{t("requests.previewTrainees")}</span><span className="font-semibold">{previewSummary.trainees}</span></div>
                      <div className="flex flex-col"><span className="text-muted-foreground text-[10px]">{t("requests.previewAttachments")}</span><span className="font-semibold">{previewSummary.attachments}</span></div>
                      <div className="flex flex-col"><span className="text-muted-foreground text-[10px]">{t("requests.previewCourses")}</span><span className="font-semibold">{previewSummary.courses}</span></div>
                      <div className="flex flex-col"><span className="text-muted-foreground text-[10px]">{t("requests.previewEstSize")}</span><span className="font-semibold">{previewSummary.estSize}</span></div>
                      <div className="flex flex-col"><span className="text-muted-foreground text-[10px]">{t("requests.previewCreated")}</span><span className="font-semibold">{previewSummary.createdDate}</span></div>
                      <div className="flex flex-col"><span className="text-muted-foreground text-[10px]">{t("requests.previewUpdated")}</span><span className="font-semibold">{previewSummary.updatedDate}</span></div>
                    </div>
                  </div>
                )}

                {/* Granular Options */}
                {selectedRequest && (
                  <div className="space-y-2 mb-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("requests.whatToImport")}</div>
                      <div className="flex gap-1">
                        <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setImportItems(new Set(GRANULAR_ITEMS.map(i => i.key)))}>{t("requests.selectAll")}</Button>
                        <Button type="button" variant="ghost" size="sm" className="h-6 text-[10px] px-2" onClick={() => setImportItems(new Set())}>{t("requests.clear")}</Button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {GRANULAR_ITEMS.map((item) => (
                        <label key={item.key} className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/30">
                          <Checkbox checked={importItems.has(item.key)} onCheckedChange={() => toggleItem(item.key)} />
                          <span className="text-xs">{item.label}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Recent Operations */}
        <div className="border-t px-5 py-2 shrink-0">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
            <History className="h-3 w-3" /> {t("requests.recentOperations")}
          </div>
          <RecentOperations logs={logs} loading={logsLoading} />
        </div>

        <DialogFooter className="p-4 border-t bg-muted/30 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("action.cancel")}</Button>
          {tab === "archive" && (
            <Button onClick={handleArchiveImport} disabled={!selectedRequest || importItems.size === 0 || importing}>
              {importing ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <Archive className="h-4 w-4 me-1.5" />}
              {t("requests.importFromArchiveBtn")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Preview sub-dialog */}
      <Dialog open={previewTarget !== null} onOpenChange={(o) => !o && setPreviewTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Eye className="h-4 w-4" /> {t("requests.archivePreview")}</DialogTitle>
          </DialogHeader>
          {previewTarget && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">{t("requests.requestNumber")}</span><span className="font-mono font-semibold text-primary">{previewTarget.refNumber}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("requests.course")}</span><span>{previewTarget.courseTitle ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("requests.created")}</span><span>{new Date(previewTarget.createdAt).toLocaleDateString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("requests.previewTrainees")}</span><span>{previewTarget.traineeCount}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("requests.status")}</span><Badge variant="outline">{previewTarget.status}</Badge></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t("requests.attachments")}</span><span>{previewTarget.hasAttachments ? t("requests.yes") : t("requests.no")}</span></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

// ─── Export Dialog ──────────────────────────────────────────────────────────

export interface ExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExportDialog({ open, onOpenChange }: ExportDialogProps) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { logs, loading: logsLoading, addLog } = useRecentLogs();
  const [scope, setScope] = React.useState<"last" | "specific_request" | "specific_course" | "date_range" | "all">("last");
  const [items, setItems] = React.useState<Set<string>>(new Set(["requests", "trainees"]));
  const [format, setFormat] = React.useState<"excel" | "pdf" | "zip">("excel");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const [progress, setProgress] = React.useState(0);

  const EXPORT_ITEMS = [
    { key: "requests", label: t("requests.itemRequests") },
    { key: "trainees", label: t("requests.itemTrainees") },
    { key: "attendance", label: t("requests.itemAttendance") },
    { key: "results", label: t("requests.itemResults") },
    { key: "evaluations", label: t("requests.itemEvaluations") },
    { key: "certificates", label: t("requests.itemCertificates") },
    { key: "invoices", label: t("requests.itemInvoices") },
    { key: "attachments", label: t("requests.itemAttachments") },
  ];

  const scopeOptions = [
    { value: "last", label: t("requests.scopeLast") },
    { value: "specific_request", label: t("requests.scopeSpecificRequest") },
    { value: "specific_course", label: t("requests.scopeSpecificCourse") },
    { value: "date_range", label: t("requests.scopeDateRange") },
    { value: "all", label: t("requests.scopeAll") },
  ] as const;

  function toggleItem(key: string) {
    setItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleExport() {
    if (items.size === 0) {
      toast({ title: t("misc.error"), description: t("requests.selectAtLeastOne"), variant: "destructive" });
      return;
    }
    setExporting(true);
    setProgress(10);
    try {
      const params = new URLSearchParams({ scope, format, items: Array.from(items).join(",") });
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      setProgress(50);
      window.open(`/api/export/company-data?${params.toString()}`, "_blank");
      setProgress(100);
      toast({ title: t("misc.success"), description: t("requests.exportStarted") });
      await addLog({ type: "EXPORT", source: "EXPORT", itemCount: items.size, status: "SUCCESS" });
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : t("requests.exportFailed");
      toast({ title: t("misc.error"), description: msg, variant: "destructive" });
      await addLog({ type: "EXPORT", source: "EXPORT", status: "FAILED", errorMessage: msg });
    } finally {
      setExporting(false);
      setProgress(0);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden p-0 gap-0 flex flex-col">
        <DialogHeader className="p-5 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            {t("requests.export")}
          </DialogTitle>
          <DialogDescription className="text-xs">{t("requests.exportDesc")}</DialogDescription>
        </DialogHeader>

        <div className="p-5 overflow-y-auto flex-1 min-h-0 space-y-5">
          {/* Scope */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("requests.scope")}</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {scopeOptions.map((opt) => (
                <label key={opt.value}
                  className={`flex items-center gap-2 rounded-md border p-2 cursor-pointer text-xs transition-colors ${
                    scope === opt.value ? "border-primary bg-primary/5" : "hover:bg-muted/30"
                  }`}>
                  <input type="radio" name="export-scope" checked={scope === opt.value} onChange={() => setScope(opt.value)} className="accent-primary" />
                  {opt.label}
                </label>
              ))}
            </div>
            {scope === "date_range" && (
              <div className="flex gap-2 mt-2">
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="text-xs" />
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="text-xs" />
              </div>
            )}
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("requests.itemsToExport")}</div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" className="text-xs h-7" onClick={() => setItems(new Set(EXPORT_ITEMS.map(i => i.key)))}>{t("requests.selectAll")}</Button>
                <Button type="button" variant="ghost" size="sm" className="text-xs h-7" onClick={() => setItems(new Set())}>{t("requests.clear")}</Button>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {EXPORT_ITEMS.map((item) => (
                <label key={item.key} className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/30">
                  <Checkbox checked={items.has(item.key)} onCheckedChange={() => toggleItem(item.key)} />
                  <span className="text-xs">{item.label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Format */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{t("requests.format")}</div>
            <div className="flex gap-2">
              {([
                { value: "excel", label: "Excel", icon: FileSpreadsheet },
                { value: "pdf", label: "PDF", icon: FileText },
                { value: "zip", label: t("requests.zipWithAttachments"), icon: FileArchive },
              ] as const).map((opt) => (
                <label key={opt.value}
                  className={`flex items-center gap-2 rounded-md border p-2.5 cursor-pointer text-xs transition-colors ${
                    format === opt.value ? "border-primary bg-primary/5" : "hover:bg-muted/30"
                  }`}>
                  <input type="radio" name="export-format" checked={format === opt.value} onChange={() => setFormat(opt.value)} className="accent-primary" />
                  <opt.icon className="h-3.5 w-3.5" />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {exporting && (
            <div className="space-y-1">
              <Progress value={progress} className="h-1.5" />
              <div className="text-[10px] text-muted-foreground text-center">{t("requests.preparingExport")}</div>
            </div>
          )}
        </div>

        {/* Recent Operations */}
        <div className="border-t px-5 py-2 shrink-0">
          <div className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1 flex items-center gap-1">
            <History className="h-3 w-3" /> {t("requests.recentOperations")}
          </div>
          <RecentOperations logs={logs} loading={logsLoading} />
        </div>

        <DialogFooter className="p-4 border-t bg-muted/30 shrink-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("action.cancel")}</Button>
          <Button onClick={handleExport} disabled={exporting || items.size === 0}>
            {exporting ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <FileDown className="h-4 w-4 me-1.5" />}
            {t("requests.exportBtn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
