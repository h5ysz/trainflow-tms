"use client";

// GCCLAB AI Copilot — Phase 3 — Executive AI Dashboard
// =====================================================================
// Premium executive dashboard with KPI cards, charts, recommendations,
// risks, forecasts, NL query, and report generation.
//
// Visible for: roles holding ai-dashboard.view — SUPER_ADMIN ("*"), COORDINATOR
// (migrated into the role's DB permissions). The API also enforces this via
// withModuleAction("ai-dashboard", "view") on every /api/copilot endpoint.
// Not visible for: TRAINER, AUDITOR, COMPANY_ADMIN, VIEWER, CONTRACTOR
// (none of these hold ai-dashboard.view, so both the UI and the API deny access).
import { useEffect, useState, useCallback } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sparkles, RefreshCw, Loader2, Download, AlertTriangle, Lightbulb, TrendingUp, FileText, Send } from "lucide-react";
import { api, downloadFile } from "@/lib/api/client";
import { KpiCard } from "@/components/common/ai-dashboard/kpi-card";
import { ChartRenderer, ForecastChart } from "@/components/common/ai-dashboard/chart-renderer";
import { RecommendationCard, RiskCard } from "@/components/common/ai-dashboard/insight-cards";
import type {
  KpiResult, ChartsResult, RecommendationsResult, RisksResult, ForecastResult, NlQueryResult,
  Recommendation,
} from "@/lib/ai/analytics/types";

type RangePreset = "7d" | "30d" | "90d" | "ytd" | "12m" | "all";

export function AiDashboardRoute() {
  const { t, locale } = useI18n();
  const [range, setRange] = useState<RangePreset>("30d");
  const [activeTab, setActiveTab] = useState("kpis");
  const [loading, setLoading] = useState(false);

  const [kpis, setKpis] = useState<KpiResult | null>(null);
  const [charts, setCharts] = useState<ChartsResult | null>(null);
  const [recommendations, setRecommendations] = useState<RecommendationsResult | null>(null);
  const [risks, setRisks] = useState<RisksResult | null>(null);
  const [forecast, setForecast] = useState<ForecastResult | null>(null);

  // NL query state
  const [nlQuestion, setNlQuestion] = useState("");
  const [nlResult, setNlResult] = useState<NlQueryResult | null>(null);
  const [nlLoading, setNlLoading] = useState(false);

  // Report generation state
  const [reportType, setReportType] = useState<string>("monthly");
  const [reportFormat, setReportFormat] = useState<string>("pdf");
  const [reportLoading, setReportLoading] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [k, c, r, rk, f] = await Promise.all([
        api.get<KpiResult>("/copilot/analytics/kpis", { range }),
        api.get<ChartsResult>("/copilot/analytics/charts", { range }),
        api.get<RecommendationsResult>("/copilot/analytics/recommendations", { range }),
        api.get<RisksResult>("/copilot/analytics/risks"),
        api.get<ForecastResult>("/copilot/analytics/forecast"),
      ]);
      setKpis(k); setCharts(c); setRecommendations(r); setRisks(rk); setForecast(f);
    } catch (e) {
      console.error("Failed to load AI dashboard:", e);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    // Defer to avoid synchronous setState-in-effect lint warning
    const handle = setTimeout(() => { void loadAll(); }, 0);
    return () => clearTimeout(handle);
  }, [loadAll]);

  const askQuestion = async (question?: string) => {
    const q = (question ?? nlQuestion).trim();
    if (!q) return;
    setNlQuestion(q);
    setNlLoading(true);
    try {
      const res = await api.post<NlQueryResult>("/copilot/analytics/query", { question: q });
      setNlResult(res);
    } catch (e) {
      console.error("NL query failed:", e);
    } finally {
      setNlLoading(false);
    }
  };

  const generateReport = async () => {
    setReportLoading(true);
    try {
      await downloadFile(
        "/copilot/analytics/reports",
        `gcclab-${reportType}-report.${reportFormat}`,
        { method: "POST", body: { type: reportType, format: reportFormat, range } }
      );
    } catch (e) {
      console.error("Report generation failed:", e);
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title={t("aiDashboard.title")}
        subtitle={t("aiDashboard.subtitle")}
        icon={Sparkles}
        actions={
          <div className="flex items-center gap-2">
            <Select value={range} onValueChange={(v) => setRange(v as RangePreset)}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="7d">{t("aiDashboard.range.7d")}</SelectItem>
                <SelectItem value="30d">{t("aiDashboard.range.30d")}</SelectItem>
                <SelectItem value="90d">{t("aiDashboard.range.90d")}</SelectItem>
                <SelectItem value="ytd">{t("aiDashboard.range.ytd")}</SelectItem>
                <SelectItem value="12m">{t("aiDashboard.range.12m")}</SelectItem>
                <SelectItem value="all">{t("aiDashboard.range.all")}</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="icon" onClick={() => void loadAll()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 md:grid-cols-7">
          <TabsTrigger value="kpis">{t("aiDashboard.tab.kpis")}</TabsTrigger>
          <TabsTrigger value="charts">{t("aiDashboard.tab.charts")}</TabsTrigger>
          <TabsTrigger value="recommendations">{t("aiDashboard.tab.recommendations")}</TabsTrigger>
          <TabsTrigger value="risks">{t("aiDashboard.tab.risks")}</TabsTrigger>
          <TabsTrigger value="forecast">{t("aiDashboard.tab.forecast")}</TabsTrigger>
          <TabsTrigger value="query">{t("aiDashboard.tab.query")}</TabsTrigger>
          <TabsTrigger value="reports">{t("aiDashboard.tab.reports")}</TabsTrigger>
        </TabsList>

        {/* KPIs Tab */}
        <TabsContent value="kpis" className="space-y-6">
          {loading && !kpis ? (
            <LoadingState locale={locale} />
          ) : kpis ? (
            kpis.groups.map((group) => (
              <div key={group.group} className="space-y-3">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  {locale === "ar" ? group.labelAr : group.label}
                </h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {group.cards.map((card) => {
                    const { key: _key, ...cardProps } = card;
                    return <KpiCard key={card.key} {...cardProps} locale={locale} />;
                  })}
                </div>
              </div>
            ))
          ) : null}
        </TabsContent>

        {/* Charts Tab */}
        <TabsContent value="charts" className="space-y-4">
          {loading && !charts ? (
            <LoadingState locale={locale} />
          ) : charts && charts.charts.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {charts.charts.map((c, i) => (
                <Card key={i} className="p-4">
                  <ChartRenderer dataset={c} />
                </Card>
              ))}
            </div>
          ) : (
            <EmptyState text={locale === "ar" ? "لا توجد بيانات للرسوم البيانية" : "No chart data available"} />
          )}
        </TabsContent>

        {/* Recommendations Tab */}
        <TabsContent value="recommendations" className="space-y-3">
          {loading && !recommendations ? (
            <LoadingState locale={locale} />
          ) : recommendations && recommendations.recommendations.length > 0 ? (
            <>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Lightbulb className="h-4 w-4" />
                <span>{recommendations.recommendations.length} {locale === "ar" ? "توصية" : "recommendations"}</span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {recommendations.recommendations.map((rec) => (
                  <RecommendationCard key={rec.id} rec={rec} locale={locale} />
                ))}
              </div>
            </>
          ) : (
            <EmptyState text={t("aiDashboard.recommendations.empty")} icon={<Lightbulb className="h-8 w-8 text-green-500" />} />
          )}
        </TabsContent>

        {/* Risks Tab */}
        <TabsContent value="risks" className="space-y-3">
          {loading && !risks ? (
            <LoadingState locale={locale} />
          ) : risks && risks.risks.length > 0 ? (
            <>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4" />
                <span>{risks.risks.length} {locale === "ar" ? "خطر" : "risks"}</span>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {risks.risks.map((risk) => (
                  <RiskCard key={risk.id} risk={risk} locale={locale} />
                ))}
              </div>
            </>
          ) : (
            <EmptyState text={t("aiDashboard.risks.empty")} icon={<TrendingUp className="h-8 w-8 text-green-500" />} />
          )}
        </TabsContent>

        {/* Forecast Tab */}
        <TabsContent value="forecast" className="space-y-4">
          {loading && !forecast ? (
            <LoadingState locale={locale} />
          ) : forecast && forecast.series.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {forecast.series.map((s) => (
                <ForecastChart key={s.key} series={s} />
              ))}
            </div>
          ) : (
            <EmptyState text={locale === "ar" ? "لا توجد بيانات كافية للتنبؤ" : "Not enough data for forecasting"} />
          )}
        </TabsContent>

        {/* NL Query Tab */}
        <TabsContent value="query" className="space-y-4">
          <Card className="p-4 space-y-3">
            <div className="flex gap-2">
              <Input
                value={nlQuestion}
                onChange={(e) => setNlQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void askQuestion(); }}
                placeholder={t("aiDashboard.query.placeholder")}
                disabled={nlLoading}
              />
              <Button onClick={() => void askQuestion()} disabled={nlLoading || !nlQuestion.trim()}>
                {nlLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                <span className="ms-2">{t("aiDashboard.query.ask")}</span>
              </Button>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">{t("aiDashboard.query.examples")}</div>
              <div className="flex flex-wrap gap-2">
                {(["example1", "example2", "example3", "example4", "example5", "example6"] as const).map((ex) => (
                  <button
                    key={ex}
                    onClick={() => void askQuestion(t(`aiDashboard.query.${ex}` as never))}
                    className="text-xs px-2 py-1 rounded-md border bg-muted/50 hover:bg-muted transition-colors"
                  >
                    {t(`aiDashboard.query.${ex}` as never)}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {nlResult && (
            <Card className="p-4 space-y-3">
              {nlResult.intent && (
                <Badge variant="secondary" className="text-xs">{locale === "ar" ? nlResult.intentAr : nlResult.intent}</Badge>
              )}
              {nlResult.answer && (
                <p className="text-sm">{locale === "ar" && nlResult.answerAr ? nlResult.answerAr : nlResult.answer}</p>
              )}
              {nlResult.kpis && nlResult.kpis.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {nlResult.kpis.map((k, i) => {
                    const { key: _k, ...kProps } = k;
                    return <KpiCard key={i} {...kProps} locale={locale} />;
                  })}
                </div>
              )}
              {nlResult.chart && (
                <ChartRenderer dataset={nlResult.chart} height={320} />
              )}
              {nlResult.table && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        {nlResult.table.columns.map((c) => (
                          <th key={c.key} className="text-start py-2 px-3 font-semibold">{locale === "ar" && c.labelAr ? c.labelAr : c.label}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {nlResult.table.rows.slice(0, 50).map((row, i) => (
                        <tr key={i} className="border-b last:border-0">
                          {nlResult.table!.columns.map((c) => (
                            <td key={c.key} className="py-2 px-3">{formatCell(row[c.key], c.format)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {nlResult.recommendations && nlResult.recommendations.length > 0 && (
                <div className="space-y-2 pt-2 border-t">
                  <div className="text-xs font-semibold text-muted-foreground">{t("aiDashboard.tab.recommendations")}</div>
                  {nlResult.recommendations.map((rec) => (
                    <RecommendationCard key={rec.id} rec={rec} locale={locale} />
                  ))}
                </div>
              )}
            </Card>
          )}
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports" className="space-y-4">
          <Card className="p-6 space-y-4">
            <div className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" />
              <h3 className="text-base font-semibold">{t("aiDashboard.reports.title")}</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">{t("aiDashboard.reports.type")}</label>
                <Select value={reportType} onValueChange={setReportType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">{locale === "ar" ? "تقرير شهري" : "Monthly Report"}</SelectItem>
                    <SelectItem value="quarterly">{locale === "ar" ? "تقرير ربع سنوي" : "Quarterly Report"}</SelectItem>
                    <SelectItem value="yearly">{locale === "ar" ? "تقرير سنوي" : "Yearly Report"}</SelectItem>
                    <SelectItem value="trainer">{locale === "ar" ? "تقرير المدرب" : "Trainer Report"}</SelectItem>
                    <SelectItem value="contractor">{locale === "ar" ? "تقرير المقاول" : "Contractor Report"}</SelectItem>
                    <SelectItem value="financial">{locale === "ar" ? "تقرير مالي" : "Financial Report"}</SelectItem>
                    <SelectItem value="operational">{locale === "ar" ? "تقرير تشغيلي" : "Operational Report"}</SelectItem>
                    <SelectItem value="attendance">{locale === "ar" ? "تقرير الحضور" : "Attendance Report"}</SelectItem>
                    <SelectItem value="exam">{locale === "ar" ? "تقرير الامتحانات" : "Exam Report"}</SelectItem>
                    <SelectItem value="certificate">{locale === "ar" ? "تقرير الشهادات" : "Certificate Report"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground">{t("aiDashboard.reports.format")}</label>
                <Select value={reportFormat} onValueChange={setReportFormat}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                    <SelectItem value="docx">Word (.docx)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={() => void generateReport()} disabled={reportLoading} className="w-full md:w-auto">
              {reportLoading ? <Loader2 className="h-4 w-4 animate-spin me-2" /> : <Download className="h-4 w-4 me-2" />}
              {reportLoading ? t("aiDashboard.reports.generating") : t("aiDashboard.reports.generate")}
            </Button>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function LoadingState({ locale }: { locale: "en" | "ar" }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
      <p className="text-sm text-muted-foreground">{locale === "ar" ? "جاري تحميل رؤى الذكاء الاصطناعي..." : "Loading AI insights..."}</p>
    </div>
  );
}

function EmptyState({ text, icon }: { text: string; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon ?? <Sparkles className="h-8 w-8 text-muted-foreground mb-3" />}
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

function formatCell(value: unknown, format?: string): string {
  if (value === null || value === undefined) return "—";
  if (format === "currency") return typeof value === "number" ? `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} SAR` : String(value);
  if (format === "percentage") return typeof value === "number" ? `${value}%` : String(value);
  if (format === "number") return typeof value === "number" ? value.toLocaleString() : String(value);
  if (format === "date" && typeof value === "string") {
    try { return new Date(value).toLocaleDateString(); } catch { /* ignore */ }
  }
  return String(value);
}
