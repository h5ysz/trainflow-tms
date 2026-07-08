"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FormGrid } from "@/components/common/form-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/common/empty-state";
import { QrCode as QrIcon, Download, RefreshCw, Printer, CalendarDays, Clock, Loader2, AlertCircle } from "lucide-react";
import { api } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";

interface SessionOption {
  id: string;
  sessionCode: string;
  title: string;
  startDate: string;
  endDate: string;
  courseTitle?: string | null;
  trainerName?: string | null;
  qrCodeToken?: string | null;
}

export function QrCodeRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [selected, setSelected] = useState<SessionOption | null>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  useEffect(() => {
    api.getList<SessionOption>("/sessions", { pageSize: 100, status: "SCHEDULED" })
      .then((r) => setSessions(r.rows ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    setSelected(sessions.find((s) => s.id === selectedId) ?? null);
  }, [selectedId, sessions]);

  const regenerate = async () => {
    if (!selectedId) return;
    setRegenerating(true);
    try {
      const res = await api.post<{ qrCodeToken: string; checkInUrl: string }>(`/sessions/${selectedId}/qr`);
      const updated = sessions.map((s) => s.id === selectedId ? { ...s, qrCodeToken: res.qrCodeToken } : s);
      setSessions(updated);
      setSelected(updated.find((s) => s.id === selectedId) ?? null);
      toast({ title: t("misc.success"), description: t("qr.regenerate") });
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setRegenerating(false);
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
                      <span className="font-mono text-xs">{s.sessionCode}</span> · {s.title}
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
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="flex flex-col items-center justify-center text-center py-6">
              <div className="relative h-64 w-64 rounded-xl border-2 border-dashed border-primary/40 bg-primary/5 flex items-center justify-center">
                {/* Visual QR placeholder — a real QR lib can be plugged in here */}
                <div className="grid grid-cols-12 gap-0.5 p-4">
                  {Array.from({ length: 144 }).map((_, i) => {
                    // Deterministic pattern from token chars
                    const seed = (selected.qrCodeToken?.charCodeAt(i % (selected.qrCodeToken?.length ?? 1)) ?? 0) + i;
                    return <div key={i} className="h-3 w-3" style={{ background: seed % 2 === 0 ? "var(--primary)" : "transparent" }} />;
                  })}
                </div>
                <QrIcon className="absolute h-8 w-8 text-primary/40" />
              </div>
              <div className="mt-4 text-sm font-mono font-semibold text-primary">{selected.qrCodeToken ?? "—"}</div>
              <div className="mt-1 text-xs text-muted-foreground">{t("qr.token")}</div>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                {t("qr.expiresIn")}
              </div>
            </div>

            <div className="flex flex-col justify-center space-y-4">
              <div>
                <h3 className="text-base font-semibold mb-1">{t("qr.scanInstructions")}</h3>
                <p className="text-sm text-muted-foreground">{selected.title}</p>
                {selected.courseTitle && <p className="text-xs text-muted-foreground mt-1">{selected.courseTitle}</p>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="gap-2" disabled>
                  <Download className="h-4 w-4" /> {t("qr.download")}
                </Button>
                <Button variant="outline" className="gap-2" disabled>
                  <Printer className="h-4 w-4" /> {t("qr.print")}
                </Button>
                <Button variant="outline" className="gap-2 col-span-2" onClick={regenerate} disabled={regenerating}>
                  {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />} {t("qr.regenerate")}
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
                    <CalendarDays className="h-4 w-4" /> {t("sessions.trainer")}: {selected.trainerName}
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
      ) : (
        <EmptyState icon={QrIcon} title={t("qr.selectSession")} subtitle={t("qr.subtitle")} className="py-12" />
      )}
    </div>
  );
}
