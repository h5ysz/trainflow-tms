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
  Upload, Download, FileSpreadsheet, Archive, Eye, Loader2, CheckCircle2,
  FileText, FileArchive, FileDown,
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
}

type ImportSource = "device" | "archive";
type ExportScope = "last" | "specific_request" | "specific_course" | "date_range" | "all";
type ExportFormat = "excel" | "pdf" | "zip";

const EXPORT_ITEMS = [
  { key: "requests", label: "Training Requests", labelAr: "طلبات التدريب" },
  { key: "trainees", label: "Trainees", labelAr: "المتدربون" },
  { key: "attendance", label: "Attendance", labelAr: "الحضور" },
  { key: "results", label: "Assessment Results", labelAr: "نتائج التقييم" },
  { key: "evaluations", label: "Evaluations", labelAr: "التقييمات" },
  { key: "certificates", label: "Certificates", labelAr: "الشهادات" },
  { key: "invoices", label: "Invoices", labelAr: "الفواتير" },
  { key: "attachments", label: "Attachments", labelAr: "المرفقات" },
] as const;

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
  const [tab, setTab] = React.useState<ImportSource>("device");
  const [archive, setArchive] = React.useState<ArchiveRequest[]>([]);
  const [loadingArchive, setLoadingArchive] = React.useState(false);
  const [selectedRequest, setSelectedRequest] = React.useState<string>("");
  const [importItems, setImportItems] = React.useState<Set<string>>(new Set(["trainees"]));
  const [importing, setImporting] = React.useState(false);
  const [previewTarget, setPreviewTarget] = React.useState<ArchiveRequest | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  // Load archive when tab switches
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
    setImporting(true);
    try {
      await onImportFromArchive(selectedRequest, Array.from(importItems));
      toast({ title: t("misc.success"), description: "Imported from archive" });
      onOpenChange(false);
      setSelectedRequest("");
      setImportItems(new Set(["trainees"]));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Import failed";
      toast({ title: t("misc.error"), description: msg, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  }

  function handleDeviceFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) {
      onDeviceImport(file);
      onOpenChange(false);
    }
    e.target.value = "";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden p-0 gap-0">
        <DialogHeader className="p-5 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            {t("requests.import")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("requests.importDesc") || "Import training data from your device or from your company's system archive."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as ImportSource)} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="mx-5 mt-4 w-fit">
            <TabsTrigger value="device" className="gap-1.5">
              <FileSpreadsheet className="h-3.5 w-3.5" />
              {t("requests.importFromDevice") || "From Device"}
            </TabsTrigger>
            <TabsTrigger value="archive" className="gap-1.5">
              <Archive className="h-3.5 w-3.5" />
              {t("requests.importFromArchive") || "From System Archive"}
            </TabsTrigger>
          </TabsList>

          {/* ─── Device Tab ─── */}
          <TabsContent value="device" className="m-0 p-5 overflow-y-auto">
            <div
              className="flex flex-col items-center justify-center gap-3 rounded-md border-2 border-dashed border-muted-foreground/30 p-10 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/20 transition-colors"
              onClick={() => fileRef.current?.click()}
            >
              <FileSpreadsheet className="h-10 w-10 text-muted-foreground" />
              <div>
                <div className="text-sm font-medium">Drop an Excel file or click to browse</div>
                <div className="text-xs text-muted-foreground mt-1">.xlsx — smart header mapping</div>
              </div>
              <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={handleDeviceFile} />
            </div>
          </TabsContent>

          {/* ─── Archive Tab ─── */}
          <TabsContent value="archive" className="m-0 p-5 overflow-y-auto flex-1 min-h-0">
            {loadingArchive ? (
              <div className="flex items-center justify-center py-8 gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin" /> Loading archive...
              </div>
            ) : archive.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No previous requests found in your company archive.
              </div>
            ) : (
              <>
                {/* Request list */}
                <div className="space-y-2 mb-4">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Select a request to import from
                  </div>
                  {archive.map((req) => (
                    <label
                      key={req.id}
                      className={`flex items-center gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                        selectedRequest === req.id ? "border-primary bg-primary/5" : "hover:bg-muted/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="archive-request"
                        checked={selectedRequest === req.id}
                        onChange={() => setSelectedRequest(req.id)}
                        className="accent-primary"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-semibold text-primary">{req.refNumber}</span>
                          <Badge variant="outline" className="text-[9px] h-4">{req.status}</Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {req.courseTitle ?? "—"} · {new Date(req.createdAt).toLocaleDateString()} · {req.traineeCount} trainees
                        </div>
                      </div>
                      {req.hasAttachments && <FileText className="h-3.5 w-3.5 text-muted-foreground" />}
                      <Button
                        type="button" variant="ghost" size="sm" className="h-7 px-2"
                        onClick={(e) => { e.preventDefault(); setPreviewTarget(req); }}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </label>
                  ))}
                </div>

                {/* Import items */}
                {selectedRequest && (
                  <div className="space-y-2 mb-4">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      What to import
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { key: "trainees", label: "Trainees", labelAr: "المتدربون" },
                        { key: "attachments", label: "Attachments", labelAr: "المرفقات" },
                        { key: "course_info", label: "Course Information", labelAr: "معلومات الدورة" },
                      ].map((item) => (
                        <label key={item.key} className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/30">
                          <Checkbox
                            checked={importItems.has(item.key)}
                            onCheckedChange={() => toggleItem(item.key)}
                          />
                          <span className="text-xs">{item.label}</span>
                        </label>
                      ))}
                    </div>
                    <Button
                      type="button" variant="ghost" size="sm" className="text-xs"
                      onClick={() => setImportItems(new Set(["trainees", "attachments", "course_info"]))}
                    >
                      Select All
                    </Button>
                  </div>
                )}
              </>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter className="p-4 border-t bg-muted/30">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {tab === "archive" && (
            <Button
              onClick={handleArchiveImport}
              disabled={!selectedRequest || importItems.size === 0 || importing}
            >
              {importing ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <Archive className="h-4 w-4 me-1.5" />}
              Import from Archive
            </Button>
          )}
        </DialogFooter>
      </DialogContent>

      {/* Preview sub-dialog */}
      <Dialog open={previewTarget !== null} onOpenChange={(o) => !o && setPreviewTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Eye className="h-4 w-4" /> Archive Preview
            </DialogTitle>
          </DialogHeader>
          {previewTarget && (
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Request #</span><span className="font-mono font-semibold text-primary">{previewTarget.refNumber}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Course</span><span>{previewTarget.courseTitle ?? "—"}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Created</span><span>{new Date(previewTarget.createdAt).toLocaleDateString()}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Trainees</span><span>{previewTarget.traineeCount}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Status</span><Badge variant="outline">{previewTarget.status}</Badge></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Attachments</span><span>{previewTarget.hasAttachments ? "Yes" : "No"}</span></div>
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
  const [scope, setScope] = React.useState<ExportScope>("last");
  const [items, setItems] = React.useState<Set<string>>(new Set(["requests", "trainees"]));
  const [format, setFormat] = React.useState<ExportFormat>("excel");
  const [specificId, setSpecificId] = React.useState("");
  const [dateFrom, setDateFrom] = React.useState("");
  const [dateTo, setDateTo] = React.useState("");
  const [exporting, setExporting] = React.useState(false);
  const [progress, setProgress] = React.useState(0);

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
      toast({ title: t("misc.error"), description: "Select at least one item to export", variant: "destructive" });
      return;
    }
    setExporting(true);
    setProgress(10);
    try {
      const params = new URLSearchParams({
        scope,
        format,
        items: Array.from(items).join(","),
      });
      if (specificId) params.set("specificId", specificId);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);

      setProgress(50);
      // Trigger download via window.open (the API returns a file)
      window.open(`/api/export/company-data?${params.toString()}`, "_blank");
      setProgress(100);

      toast({ title: t("misc.success"), description: "Export started — check your downloads" });
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Export failed";
      toast({ title: t("misc.error"), description: msg, variant: "destructive" });
    } finally {
      setExporting(false);
      setProgress(0);
    }
  }

  const scopeOptions: { value: ExportScope; label: string; labelAr: string }[] = [
    { value: "last", label: "Last Request", labelAr: "آخر طلب" },
    { value: "specific_request", label: "Specific Request", labelAr: "طلب محدد" },
    { value: "specific_course", label: "Specific Course", labelAr: "دورة محددة" },
    { value: "date_range", label: "Date Range", labelAr: "نطاق تاريخ" },
    { value: "all", label: "All Company Data", labelAr: "كل بيانات الشركة" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden p-0 gap-0">
        <DialogHeader className="p-5 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Download className="h-5 w-5 text-primary" />
            {t("requests.export")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("requests.exportDesc") || "Export your company's data from the system. Choose scope, items, and format."}
          </DialogDescription>
        </DialogHeader>

        <div className="p-5 overflow-y-auto space-y-5">
          {/* Scope */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Scope</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {scopeOptions.map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-2 rounded-md border p-2 cursor-pointer text-xs transition-colors ${
                    scope === opt.value ? "border-primary bg-primary/5" : "hover:bg-muted/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="export-scope"
                    checked={scope === opt.value}
                    onChange={() => setScope(opt.value)}
                    className="accent-primary"
                  />
                  {opt.label}
                </label>
              ))}
            </div>
            {/* Conditional inputs */}
            {scope === "date_range" && (
              <div className="flex gap-2 mt-2">
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="text-xs" />
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="text-xs" />
              </div>
            )}
          </div>

          {/* Items */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Items to Export</div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {EXPORT_ITEMS.map((item) => (
                <label key={item.key} className="flex items-center gap-2 rounded-md border p-2 cursor-pointer hover:bg-muted/30">
                  <Checkbox
                    checked={items.has(item.key)}
                    onCheckedChange={() => toggleItem(item.key)}
                  />
                  <span className="text-xs">{item.label}</span>
                </label>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <Button type="button" variant="ghost" size="sm" className="text-xs h-7" onClick={() => setItems(new Set(EXPORT_ITEMS.map(i => i.key)))}>
                Select All
              </Button>
              <Button type="button" variant="ghost" size="sm" className="text-xs h-7" onClick={() => setItems(new Set())}>
                Clear
              </Button>
            </div>
          </div>

          {/* Format */}
          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Format</div>
            <div className="flex gap-2">
              {([
                { value: "excel", label: "Excel", icon: FileSpreadsheet },
                { value: "pdf", label: "PDF", icon: FileText },
                { value: "zip", label: "ZIP (with attachments)", icon: FileArchive },
              ] as const).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-2 rounded-md border p-2.5 cursor-pointer text-xs transition-colors ${
                    format === opt.value ? "border-primary bg-primary/5" : "hover:bg-muted/30"
                  }`}
                >
                  <input
                    type="radio"
                    name="export-format"
                    checked={format === opt.value}
                    onChange={() => setFormat(opt.value)}
                    className="accent-primary"
                  />
                  <opt.icon className="h-3.5 w-3.5" />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>

          {/* Progress */}
          {exporting && (
            <div className="space-y-1">
              <Progress value={progress} className="h-1.5" />
              <div className="text-[10px] text-muted-foreground text-center">Preparing export...</div>
            </div>
          )}
        </div>

        <DialogFooter className="p-4 border-t bg-muted/30">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleExport} disabled={exporting || items.size === 0}>
            {exporting ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" /> : <FileDown className="h-4 w-4 me-1.5" />}
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
