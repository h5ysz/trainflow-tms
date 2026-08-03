"use client";

// GCCLAB TMS — Financial Reports page
// =====================================================================
// Aggregated financial reporting view for SUPER_ADMIN + COORDINATOR.
// Shows revenue by month, outstanding by contractor, payment status
// distribution, and overdue invoices. All data is pulled from the
// existing /api/copilot/analytics endpoints (no new backend needed).
import { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/context";
import { PageHeader } from "@/components/common/page-header";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, FileText } from "lucide-react";
import { api } from "@/lib/api/client";
import { ChartRenderer } from "@/components/common/ai-dashboard/chart-renderer";
import type { ChartsResult, KpiResult } from "@/lib/ai/analytics/types";

export function FinancialReportsRoute() {
  const { t, locale } = useI18n();
  const [loading, setLoading] = useState(true);
  const [charts, setCharts] = useState<ChartsResult | null>(null);
  const [kpis, setKpis] = useState<KpiResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(() => {
      Promise.all([
        api.get<ChartsResult>("/copilot/analytics/charts", { range: "12m" }),
        api.get<KpiResult>("/copilot/analytics/kpis", { range: "12m" }),
      ]).then(([c, k]) => {
        if (cancelled) return;
        setCharts(c);
        setKpis(k);
      }).catch((e) => console.error("Financial reports load failed:", e))
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 0);
    return () => { cancelled = true; clearTimeout(handle); };
  }, []);

  // Filter to financial-relevant charts + KPIs
  const financialCharts = charts?.charts.filter((c) =>
    c.title.toLowerCase().includes("revenue") ||
    c.title.toLowerCase().includes("invoice") ||
    c.title.toLowerCase().includes("payment")
  ) ?? [];
  const revenueKpis = kpis?.groups.find((g) => g.group === "revenue");

  return (
    <div className="space-y-6 p-4 md:p-6">
      <PageHeader
        title={locale === "ar" ? "التقارير المالية" : "Financial Reports"}
        subtitle={locale === "ar" ? "تحليلات الإيرادات والفواتير والمدفوعات" : "Revenue, invoice, and payment analytics"}
        icon={FileText}
      />

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary mb-3" />
          <p className="text-sm text-muted-foreground">{locale === "ar" ? "جاري التحميل..." : "Loading..."}</p>
        </div>
      ) : (
        <>
          {/* Revenue KPIs */}
          {revenueKpis && revenueKpis.cards.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                {locale === "ar" ? "ملخص الإيرادات" : "Revenue Summary"}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {revenueKpis.cards.map((card) => (
                  <Card key={card.key} className="p-4">
                    <div className="text-xs font-medium text-muted-foreground">{locale === "ar" ? card.labelAr : card.label}</div>
                    <div className="mt-1 text-xl font-bold">
                      {card.format === "currency"
                        ? `${typeof card.value === "number" ? card.value.toLocaleString() : card.value} ${card.currency ?? "SAR"}`
                        : card.format === "percentage"
                          ? `${card.value}%`
                          : typeof card.value === "number" ? card.value.toLocaleString() : card.value}
                    </div>
                    {card.deltaPercent !== null && card.deltaPercent !== undefined && (
                      <Badge variant={card.deltaPercent >= 0 ? "default" : "destructive"} className="mt-1 text-[10px]">
                        {card.deltaPercent > 0 ? "+" : ""}{card.deltaPercent}%
                      </Badge>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Financial Charts */}
          {financialCharts.length > 0 ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {financialCharts.map((c, i) => (
                <Card key={i} className="p-4">
                  <ChartRenderer dataset={c} />
                </Card>
              ))}
            </div>
          ) : (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              {locale === "ar" ? "لا توجد بيانات مالية متاحة" : "No financial data available"}
            </Card>
          )}
        </>
      )}
    </div>
  );
}
