"use client";

import { useState, useEffect, useMemo } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FormGrid } from "@/components/common/form-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/common/empty-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { QrCode as QrIcon, Download, RefreshCw, Printer, CalendarDays, Clock, Loader2, Copy, Check } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { QrImage, qrPngDataUrl } from "@/components/common/qr-image";
import { buildCheckInUrl, buildPreTestUrl, buildFinalTestUrl, buildEvaluationUrl } from "@/lib/qr/urls";
import { trainerName } from "@/lib/i18n/trainer-name";

type QrType = "checkIn" | "preTest" | "finalTest" | "evaluation";

const QR_TABS: { value: QrType; labelKey: Parameters<ReturnType<typeof useI18n>["t"]>[0]; fallback: string; tokenKey: string; build: typeof buildCheckInUrl }[] = [
  { value: "checkIn", labelKey: "qr.title", fallback: "Attendance", tokenKey: "qrCodeToken", build: buildCheckInUrl },
  { value: "preTest", labelKey: "preTest.title", fallback: "Pre-Test", tokenKey: "preTestQrToken", build: buildPreTestUrl },
  { value: "finalTest", labelKey: "finalTest.title", fallback: "Final-Test", tokenKey: "finalTestQrToken", build: buildFinalTestUrl },
  { value: "evaluation", labelKey: "nav.evaluation", fallback: "Evaluation", tokenKey: "evaluationQrToken", build: buildEvaluationUrl },
];

interface SessionOption {
  id: string;
  refNumber: string;
  title: string;
  startDate: string;
  endDate: string;
  courseTitle?: string | null;
  trainerName?: string | null;
  trainer?: { nameEn: string; nameAr?: string | null } | null;
  qrCodeToken?: string | null;
  preTestQrToken?: string | null;
  finalTestQrToken?: string | null;
  evaluationQrToken?: string | null;
}

export function QrCodeRoute() {
  const { t, dir, locale } = useI18n();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const selected = sessions.find((s) => s.id === selectedId) ?? null;
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState<QrType | null>(null);
  const [copied, setCopied] = useState(false);
  const [qrTab, setQrTab] = useState<QrType>("checkIn");

  const currentTab = useMemo(() => QR_TABS.find((tab) => tab.value === qrTab)!, [qrTab]);
  const currentToken = selected ? (selected as unknown as Record<string, string | null | undefined>)[currentTab.tokenKey] : null;

  const qrUrl = useMemo(() => {
    if (!currentToken || typeof window === "undefined") return "";
    return currentTab.build(window.location.origin, currentToken);
  }, [currentToken, currentTab]);

  const copyLink = async () => {
    if (!qrUrl) return;
    try {
      await navigator.clipboard.writeText(qrUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: t("misc.error"), description: t("qr.copyFailed"), variant: "destructive" });
    }
  };

  const downloadQr = async () => {
    if (!qrUrl || !selected) return;
    try {
      const dataUrl = await qrPngDataUrl(qrUrl, 1024);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `qr-${qrTab}-${selected.refNumber || selected.id}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    }
  };

  const printQr = () => {
    if (!qrUrl || !selected) return;
    const win = window.open("", "_blank", "width=720,height=900");
    if (!win) {
      toast({ title: t("misc.error"), description: t("qr.popupBlocked"), variant: "destructive" });
      return;
    }
    void qrPngDataUrl(qrUrl, 1024).then((dataUrl) => {
      win.document.write(`<!doctype html><html dir="${dir}" lang="${dir === "rtl" ? "ar" : "en"}"><head><meta charset="utf-8"><title>${escapeHtml(selected.title)}</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;padding:32px;margin:0}
h1{font-size:20px;margin:0 0 4px}h2{font-size:14px;font-weight:400;color:#555;margin:0 0 20px}
img{width:340px;height:340px}p{font-size:12px;color:#666;margin:6px 0}
.token{font-family:ui-monospace,monospace;font-size:11px;color:#999;word-break:break-all}</style></head>
<body><h1>${escapeHtml(selected.title)}</h1><h2>${escapeHtml(selected.courseTitle ?? "")}</h2>
<img src="${dataUrl}" alt="QR"><p>${escapeHtml(t("qr.scanInstructions"))}</p>
<p class="token">${escapeHtml(qrUrl)}</p></body></html>`);
      win.document.close();
      win.focus();
      win.print();
    });
  };

  useEffect(() => {
    api.getList<SessionOption>("/sessions", { pageSize: 500 })
      .then((r) => setSessions(r.rows ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const regenerate = async (type: QrType) => {
    if (!selectedId) return;
    setRegenerating(type);
    try {
      const res = await api.post<{ qrCodeToken?: string; preTestQrToken?: string; finalTestQrToken?: string; evaluationQrToken?: string }>(
        `/sessions/${selectedId}/qr`,
        { tokenType: type === "checkIn" ? "checkIn" : type },
      );
      const tokenField = QR_TABS.find((tab) => tab.value === type)?.tokenKey;
      const newToken = tokenField ? (res as Record<string, string | undefined>)[tokenField] : undefined;
      setSessions((prev) =>
        prev.map((s) => (s.id === selectedId && tokenField && newToken ? { ...s, [tokenField]: newToken } : s))
      );
      toast({ title: t("misc.success"), description: t("qr.regenerate") });
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setRegenerating(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("qr.title")} subtitle={t("qr.subtitle")} icon={QrIcon} />

      <Card className="p-5">
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : sessions.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4">{t("qr.selectSession")}</div>
        ) : (
          <FormGrid cols={2}>
            <Field label={t("attendance.session")} required>
              <Select value={selectedId} onValueChange={setSelectedId}>
                <SelectTrigger><SelectValue placeholder={t("qr.selectSession")} /></SelectTrigger>
                <SelectContent>
                  {sessions.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      <span className="font-mono text-xs">{s.refNumber}</span> · {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </FormGrid>
        )}
      </Card>

      {selectedId && selected ? (
        <Card className="p-6">
          <Tabs value={qrTab} onValueChange={(v) => setQrTab(v as QrType)}>
            <TabsList className="mb-4">
              {QR_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {t(tab.labelKey) || tab.fallback}
                </TabsTrigger>
              ))}
            </TabsList>

            {QR_TABS.map((tab) => (
              <TabsContent key={tab.value} value={tab.value}>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="flex flex-col items-center justify-center text-center py-6">
                    {qrUrl ? (
                      <QrImage value={qrUrl} size={256} label={t(tab.labelKey) || tab.fallback} className="border" />
                    ) : (
                      <div className="h-64 w-64 rounded-xl border-2 border-dashed border-muted-foreground/30 bg-muted/20 flex flex-col items-center justify-center gap-2 text-center p-6">
                        <QrIcon className="h-8 w-8 text-muted-foreground/40" />
                        <span className="text-xs text-muted-foreground">{t("qr.noToken")}</span>
                      </div>
                    )}
                    {qrUrl && (
                      <button
                        type="button"
                        onClick={() => void copyLink()}
                        className="mt-3 inline-flex max-w-full items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted/50"
                        title={qrUrl}
                      >
                        {copied ? <Check className="h-3.5 w-3.5 text-success shrink-0" /> : <Copy className="h-3.5 w-3.5 shrink-0" />}
                        <span className="truncate font-mono">{qrUrl}</span>
                      </button>
                    )}
                    <div className="mt-2 text-xs font-mono text-muted-foreground">{currentToken ?? "—"}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{t("qr.token")}</div>
                  </div>

                  <div className="flex flex-col justify-center space-y-4">
                    <div>
                      <h3 className="text-base font-semibold mb-1">{t(tab.labelKey) || tab.fallback}</h3>
                      <p className="text-sm text-muted-foreground">{selected.title}</p>
                      {selected.courseTitle && <p className="text-xs text-muted-foreground mt-1">{selected.courseTitle}</p>}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button variant="outline" className="gap-2" disabled={!qrUrl} onClick={() => void downloadQr()}>
                        <Download className="h-4 w-4" /> {t("qr.download")}
                      </Button>
                      <Button variant="outline" className="gap-2" disabled={!qrUrl} onClick={printQr}>
                        <Printer className="h-4 w-4" /> {t("qr.print")}
                      </Button>
                      <Button variant="outline" className="gap-2 col-span-2" onClick={() => void regenerate(tab.value)} disabled={regenerating !== null}>
                        {regenerating === tab.value ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {t("qr.regenerate")}
                      </Button>
                    </div>
                    <div className="border-t pt-4 space-y-2 text-sm">
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <CalendarDays className="h-4 w-4" /> {t("sessions.startDate")}: {new Date(selected.startDate).toLocaleString()}
                      </div>
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Clock className="h-4 w-4" /> {t("sessions.endDate")}: {new Date(selected.endDate).toLocaleString()}
                      </div>
                      {selected.trainerName && (
                        <div className="flex items-center gap-2 text-muted-foreground">
                          <CalendarDays className="h-4 w-4" /> {t("sessions.trainer")}: {selected.trainer ? trainerName(selected.trainer, locale) : selected.trainerName}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </TabsContent>
            ))}
          </Tabs>
        </Card>
      ) : (
        <EmptyState icon={QrIcon} title={t("qr.selectSession")} subtitle={t("qr.subtitle")} className="py-12" />
      )}
    </div>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
