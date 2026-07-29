"use client";

import { useState, useEffect } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Field, FormGrid } from "@/components/common/form-dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BarChart3, FileText, Download, FileSpreadsheet, TrendingUp,
  Building2, BookOpen, GraduationCap, CalendarRange, ShieldCheck, UserCheck, Award,
  AlertCircle, AlertTriangle, Loader2, Users, CalendarDays,
  type LucideIcon,
} from "lucide-react";
import { api, downloadFile } from "@/lib/api/client";
import { useToast } from "@/hooks/use-toast";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend } from "recharts";

interface ExportTemplate {
  code: string;
  name: string;
  nameAr: string;
  description: string;
  supportedFormats: string[];
}

interface ReportCard {
  key: string;
  title: string;
  desc: string;
  icon: LucideIcon;
  accent: string;
}

const PIE_COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "#94a3b8"];

export function ReportsRoute() {
  const { t } = useI18n();
  const { toast } = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${new Date().getFullYear()}-01-01`;
  const [reportType, setReportType] = useState("summary");
  const [from, setFrom] = useState(yearStart);
  const [to, setTo] = useState(today);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The two Export buttons used to have no onClick at all. They now drive
  // POST /api/reports/generate, which builds the xlsx/pdf and had no caller anywhere.
  const [templates, setTemplates] = useState<ExportTemplate[]>([]);
  const [exporting, setExporting] = useState<"xlsx" | "pdf" | null>(null);

  const reports: ReportCard[] = [
    { key: "summary", title: t("reports.summary"), desc: "", icon: TrendingUp, accent: "bg-primary/10 text-primary" },
    { key: "byCompany", title: t("reports.byCompany"), desc: "", icon: Building2, accent: "bg-info/10 text-info" },
    { key: "byCourse", title: t("reports.byCourse"), desc: "", icon: BookOpen, accent: "bg-success/10 text-success" },
    { key: "byTrainer", title: t("reports.byTrainer"), desc: "", icon: GraduationCap, accent: "bg-warning/10 text-warning" },
    { key: "byPeriod", title: t("reports.byPeriod"), desc: "", icon: CalendarRange, accent: "bg-primary/10 text-primary" },
    { key: "compliance", title: t("reports.compliance"), desc: "", icon: ShieldCheck, accent: "bg-destructive/10 text-destructive" },
    { key: "attendance", title: t("reports.attendance"), desc: "", icon: UserCheck, accent: "bg-info/10 text-info" },
    { key: "scores", title: t("reports.scores"), desc: "", icon: Award, accent: "bg-success/10 text-success" },
    // Sprint 2 new report types
    { key: "trainees", title: t("dashboard.kpi.trainees"), desc: "", icon: Users, accent: "bg-success/10 text-success" },
    { key: "conflicts", title: t("dashboard.kpi.trainerConflicts"), desc: "", icon: AlertTriangle, accent: "bg-destructive/10 text-destructive" },
    { key: "todaySessions", title: t("dashboard.kpi.todaySessions"), desc: "", icon: CalendarDays, accent: "bg-info/10 text-info" },
  ];

  useEffect(() => {
    let cancelled = false;
    // Defer the loading flag set to a microtask to avoid synchronous setState in effect
    Promise.resolve().then(() => {
      if (cancelled) return;
      setLoading(true);
      setError(null);
    });
    api.get<any>(`/reports/${reportType}`, { from, to })
      .then((res) => {
        if (cancelled) return;
        setData(res);
      })
      .catch((e) => {
        if (cancelled) return;
        setError((e as Error).message);
        setData(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [reportType, from, to, reloadKey]);

  useEffect(() => {
    let cancelled = false;
    api.get<ExportTemplate[]>("/report-templates")
      .then((rows) => { if (!cancelled) setTemplates(rows); })
      .catch(() => { /* export stays disabled; the page itself still works */ });
    return () => { cancelled = true; };
  }, []);

  // Pick the first template that can produce the requested format.
  const exportTemplate = templates[0] ?? null;

  const handleExport = async (format: "xlsx" | "pdf") => {
    const template = templates.find((tpl) => tpl.supportedFormats.includes(format));
    if (!template) {
      toast({ title: t("misc.error"), description: t("reports.exportUnavailable"), variant: "destructive" });
      return;
    }
    setExporting(format);
    try {
      await downloadFile(
        "/reports/generate",
        `${template.code}.${format}`,
        { method: "POST", body: { template: template.code, format, filter: { dateFrom: from, dateTo: to } } }
      );
    } catch (e) {
      toast({ title: t("misc.error"), description: (e as Error).message, variant: "destructive" });
    } finally {
      setExporting(null);
    }
  };

  const renderReport = () => {
    if (!data) return null;
    if (loading) return <div className="py-12 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

    if (data.metrics) {
      return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Object.entries(data.metrics).map(([k, v]) => (
            <Card key={k} className="p-4">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide truncate">{k.replace(/([A-Z])/g, " $1").trim()}</div>
              <div className="mt-1.5 text-2xl font-bold text-foreground tabular-nums">{v === null ? "—" : String(v)}</div>
            </Card>
          ))}
        </div>
      );
    }

    if (data.rows && data.rows.length > 0) {
      const labelKey = Object.keys(data.rows[0]).find((k) => k !== "count" && k !== "month");
      if (!labelKey) return null;

      // Pie chart for category-type reports (byCompany, byCourse, byTrainer)
      const isPie = ["byCompany", "byCourse", "byTrainer"].includes(reportType);
      if (isPie) {
        return (
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={data.rows} dataKey="count" nameKey={labelKey} cx="50%" cy="50%" outerRadius={110} label={(e: any) => `${e[labelKey]}: ${e.count}`}>
                {data.rows.map((_: unknown, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        );
      }

      // Bar chart for byPeriod
      return (
        <ResponsiveContainer width="100%" height={320}>
          <BarChart data={data.rows}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey={labelKey} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
            <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} allowDecimals={false} />
            <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 6, fontSize: 12 }} />
            <Bar dataKey="count" fill="var(--primary)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }

    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        <BarChart3 className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
        {t("reports.empty.subtitle")}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("reports.title")}
        subtitle={t("reports.subtitle")}
        icon={BarChart3}
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={!exportTemplate || exporting !== null}
              onClick={() => void handleExport("pdf")}
              title={exportTemplate?.name}
            >
              {exporting === "pdf"
                ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" />
                : <FileText className="h-4 w-4 me-1.5" />}
              {t("reports.exportPdf")}
            </Button>
            <Button
              variant="outline"
              disabled={!exportTemplate || exporting !== null}
              onClick={() => void handleExport("xlsx")}
              title={exportTemplate?.name}
            >
              {exporting === "xlsx"
                ? <Loader2 className="h-4 w-4 me-1.5 animate-spin" />
                : <FileSpreadsheet className="h-4 w-4 me-1.5" />}
              {t("reports.exportExcel")}
            </Button>
          </div>
        }
      />

      <Card className="p-4">
        <FormGrid cols={3}>
          <Field label={t("reports.from")}>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label={t("reports.to")}>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label={t("reports.title")}>
            <Select value={reportType} onValueChange={setReportType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {reports.map((r) => <SelectItem key={r.key} value={r.key}>{r.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </FormGrid>
      </Card>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {reports.map((r) => (
          <Card key={r.key} className={`p-4 tf-card-hover ${reportType === r.key ? "border-primary shadow-sm" : ""}`}>
            <div className={`flex h-9 w-9 items-center justify-center rounded-md mb-3 ${r.accent}`}>
              <r.icon className="h-4 w-4" />
            </div>
            <div className="text-sm font-semibold mb-1">{r.title}</div>
            <div className="text-xs text-muted-foreground line-clamp-2">{r.desc}</div>
          </Card>
        ))}
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold">{reports.find((r) => r.key === reportType)?.title}</h3>
          <Button size="sm" onClick={() => setReloadKey((k) => k + 1)} disabled={loading}>{t("reports.generate")}</Button>
        </div>
        {error && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive mb-3">
            <AlertCircle className="h-4 w-4" /> {error}
          </div>
        )}
        {renderReport()}
      </Card>
    </div>
  );
}
