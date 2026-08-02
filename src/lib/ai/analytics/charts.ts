// GCCLAB AI Copilot — Phase 3 — Chart dataset builders
// =====================================================================
// Pure functions that produce ChartDataset shapes ready for the frontend
// recharts renderer. All data is scope-aware.
import { db } from "@/lib/db";
import type { AnalyticsScope, TimeRange, ChartDataset, ChartsResult } from "./types";
import { cached, buildKey, getTtl } from "./cache";

// Color palette — consistent across all charts
export const CHART_COLORS = [
  "#7c3aed", "#dc2626", "#2563eb", "#16a34a", "#ea580c",
  "#0891b2", "#ca8a04", "#9333ea", "#db2777", "#65a30d",
];

function sessionCompanyFilter(scope: AnalyticsScope): Record<string, unknown> {
  if (scope.role === "CONTRACTOR" && scope.companyId) {
    return { enrollments: { some: { companyId: scope.companyId, deletedAt: null } } };
  }
  return {};
}

export async function computeCharts(scope: AnalyticsScope, range: TimeRange): Promise<ChartsResult> {
  const key = buildKey(scope, "charts", range.from.toISOString().slice(0, 10), range.to.toISOString().slice(0, 10));
  return cached(key, getTtl("CHART"), ["charts", "sessions", "invoices", "certificates"], async () => {
    const [revenueByMonth, attendanceTrend, passRateTrend, trainerPerformance, contractorRevenue, certStatus, invoiceStatus, paymentTrend] = await Promise.all([
      getRevenueByMonth(scope, range),
      getAttendanceTrend(scope, range),
      getPassRateTrend(scope, range),
      getTrainerPerformance(scope, range),
      getContractorRevenue(scope, range),
      getCertStatusChart(scope, range),
      getInvoiceStatusChart(scope, range),
      getPaymentTrend(scope, range),
    ]);

    const charts: ChartDataset[] = [
      revenueByMonth,
      attendanceTrend,
      passRateTrend,
      trainerPerformance,
      contractorRevenue,
      certStatus,
      invoiceStatus,
      paymentTrend,
    ].filter((c): c is ChartDataset => c !== null);

    return { generatedAt: new Date().toISOString(), charts };
  });
}

// ─── Revenue by month (bar) ────────────────────────────────────────────────
async function getRevenueByMonth(scope: AnalyticsScope, range: TimeRange): Promise<ChartDataset | null> {
  if (!scope.canSeeFinancial) return null;
  const invoices = await db.invoice.findMany({
    where: { deletedAt: null, issueDate: { gte: range.from, lte: range.to } },
    select: { grandTotal: true, issueDate: true, currency: true },
    take: 5000,
  });
  const byMonth = new Map<string, number>();
  for (const inv of invoices) {
    const month = inv.issueDate.toISOString().slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + inv.grandTotal);
  }
  const sortedMonths = Array.from(byMonth.keys()).sort();
  return {
    type: "bar",
    title: "Monthly Revenue",
    titleAr: "الإيرادات الشهرية",
    xLabel: "Month",
    yLabel: "Revenue (SAR)",
    unit: "currency",
    currency: "SAR",
    series: [{
      name: "Revenue",
      nameAr: "الإيرادات",
      color: CHART_COLORS[0],
      data: sortedMonths.map((m) => ({ label: m, value: Math.round(byMonth.get(m) ?? 0) })),
    }],
  };
}

// ─── Attendance trend (line) ───────────────────────────────────────────────
async function getAttendanceTrend(scope: AnalyticsScope, range: TimeRange): Promise<ChartDataset | null> {
  const scFilter = sessionCompanyFilter(scope);
  const sessions = await db.trainingSession.findMany({
    where: { deletedAt: null, startDate: { gte: range.from, lte: range.to }, ...scFilter },
    select: { startDate: true, expectedTrainees: true, actualTrainees: true },
    take: 5000,
  });
  const byMonth = new Map<string, { expected: number; actual: number }>();
  for (const s of sessions) {
    const month = s.startDate.toISOString().slice(0, 7);
    const e = byMonth.get(month) ?? { expected: 0, actual: 0 };
    e.expected += s.expectedTrainees;
    e.actual += s.actualTrainees;
    byMonth.set(month, e);
  }
  const sortedMonths = Array.from(byMonth.keys()).sort();
  return {
    type: "line",
    title: "Attendance Trend",
    titleAr: "اتجاه الحضور",
    xLabel: "Month",
    yLabel: "Trainees",
    unit: "count",
    series: [
      { name: "Expected", nameAr: "المتوقع", color: CHART_COLORS[3], data: sortedMonths.map((m) => ({ label: m, value: byMonth.get(m)?.expected ?? 0 })) },
      { name: "Actual", nameAr: "الفعلي", color: CHART_COLORS[2], data: sortedMonths.map((m) => ({ label: m, value: byMonth.get(m)?.actual ?? 0 })) },
    ],
  };
}

// ─── Pass rate trend (line) ────────────────────────────────────────────────
async function getPassRateTrend(_scope: AnalyticsScope, range: TimeRange): Promise<ChartDataset | null> {
  const testResults = await db.testResult.findMany({
    where: { deletedAt: null, attemptedAt: { gte: range.from, lte: range.to } },
    select: { passed: true, attemptedAt: true },
    take: 5000,
  });
  const byMonth = new Map<string, { passed: number; total: number }>();
  for (const r of testResults) {
    const month = r.attemptedAt.toISOString().slice(0, 7);
    const e = byMonth.get(month) ?? { passed: 0, total: 0 };
    e.total++;
    if (r.passed) e.passed++;
    byMonth.set(month, e);
  }
  const sortedMonths = Array.from(byMonth.keys()).sort();
  return {
    type: "line",
    title: "Pass Rate Trend",
    titleAr: "اتجاه نسبة النجاح",
    xLabel: "Month",
    yLabel: "Pass Rate (%)",
    unit: "percent",
    series: [{
      name: "Pass Rate",
      nameAr: "نسبة النجاح",
      color: CHART_COLORS[3],
      data: sortedMonths.map((m) => {
        const e = byMonth.get(m)!;
        return { label: m, value: e.total > 0 ? Math.round((e.passed / e.total) * 100) : 0 };
      }),
    }],
  };
}

// ─── Trainer performance (bar — top 10 trainers by pass rate) ──────────────
async function getTrainerPerformance(scope: AnalyticsScope, range: TimeRange): Promise<ChartDataset | null> {
  if (!scope.canSeeOperational) return null;
  const testResults = await db.testResult.findMany({
    where: { deletedAt: null, attemptedAt: { gte: range.from, lte: range.to } },
    select: { passed: true, trainingSession: { select: { trainerId: true, trainer: { select: { id: true, fullName: true } } } } },
    take: 5000,
  });
  const byTrainer = new Map<string, { name: string; passed: number; total: number }>();
  for (const r of testResults) {
    const tid = r.trainingSession.trainerId;
    if (!tid) continue;
    const e = byTrainer.get(tid) ?? { name: r.trainingSession.trainer?.fullName ?? "—", passed: 0, total: 0 };
    e.total++;
    if (r.passed) e.passed++;
    byTrainer.set(tid, e);
  }
  const arr = Array.from(byTrainer.entries()).map(([_, e]) => ({
    name: e.name, passRate: e.total > 0 ? Math.round((e.passed / e.total) * 100) : 0, total: e.total,
  })).filter((x) => x.total >= 1).sort((a, b) => b.passRate - a.passRate).slice(0, 10);
  return {
    type: "bar",
    title: "Trainer Performance (Top 10 by Pass Rate)",
    titleAr: "أداء المدربين (أفضل 10 حسب نسبة النجاح)",
    xLabel: "Trainer",
    yLabel: "Pass Rate (%)",
    unit: "percent",
    series: [{
      name: "Pass Rate",
      nameAr: "نسبة النجاح",
      color: CHART_COLORS[3],
      data: arr.map((a) => ({ label: a.name, value: a.passRate })),
    }],
  };
}

// ─── Contractor revenue (bar — top 10 contractors by revenue) ──────────────
async function getContractorRevenue(scope: AnalyticsScope, range: TimeRange): Promise<ChartDataset | null> {
  if (!scope.canSeeFinancial) return null;
  const invoices = await db.invoice.findMany({
    where: { deletedAt: null, issueDate: { gte: range.from, lte: range.to } },
    select: { grandTotal: true, companyId: true },
    take: 5000,
  });
  const byCompany = new Map<string, number>();
  for (const inv of invoices) {
    byCompany.set(inv.companyId, (byCompany.get(inv.companyId) ?? 0) + inv.grandTotal);
  }
  const top = Array.from(byCompany.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10);
  if (top.length === 0) return null;
  const companies = await db.company.findMany({
    where: { id: { in: top.map((t) => t[0]) } },
    select: { id: true, name: true },
  });
  const nameMap = new Map(companies.map((c) => [c.id, c.name]));
  return {
    type: "bar",
    title: "Top 10 Contractors by Revenue",
    titleAr: "أفضل 10 مقاولين حسب الإيرادات",
    xLabel: "Contractor",
    yLabel: "Revenue (SAR)",
    unit: "currency",
    currency: "SAR",
    series: [{
      name: "Revenue",
      nameAr: "الإيرادات",
      color: CHART_COLORS[0],
      data: top.map(([id, total]) => ({ label: nameMap.get(id) ?? "—", value: Math.round(total) })),
    }],
  };
}

// ─── Certificate status (pie) ──────────────────────────────────────────────
async function getCertStatusChart(scope: AnalyticsScope, _range: TimeRange): Promise<ChartDataset | null> {
  const where = scope.role === "CONTRACTOR" && scope.companyId ? { companyId: scope.companyId } : {};
  const stats = await db.certificate.groupBy({
    by: ["status"],
    where: { deletedAt: null, ...where },
    _count: true,
  });
  return {
    type: "pie",
    title: "Certificates by Status",
    titleAr: "الشهادات حسب الحالة",
    unit: "count",
    series: [{
      name: "Certificates",
      nameAr: "الشهادات",
      data: stats.map((s, i) => ({ label: s.status, value: s._count, color: CHART_COLORS[i % CHART_COLORS.length] })),
    }],
  };
}

// ─── Invoice status (pie) ──────────────────────────────────────────────────
async function getInvoiceStatusChart(scope: AnalyticsScope, _range: TimeRange): Promise<ChartDataset | null> {
  if (!scope.canSeeFinancial) return null;
  const where = scope.role === "CONTRACTOR" && scope.companyId ? { companyId: scope.companyId } : {};
  const stats = await db.invoice.groupBy({
    by: ["status"],
    where: { deletedAt: null, ...where },
    _count: true,
  });
  return {
    type: "pie",
    title: "Invoices by Status",
    titleAr: "الفواتير حسب الحالة",
    unit: "count",
    series: [{
      name: "Invoices",
      nameAr: "الفواتير",
      data: stats.map((s, i) => ({ label: s.status, value: s._count, color: CHART_COLORS[i % CHART_COLORS.length] })),
    }],
  };
}

// ─── Payment trend (line — paid vs pending) ────────────────────────────────
async function getPaymentTrend(scope: AnalyticsScope, range: TimeRange): Promise<ChartDataset | null> {
  if (!scope.canSeeFinancial) return null;
  const payments = await db.payment.findMany({
    where: { deletedAt: null, paymentDate: { gte: range.from, lte: range.to } },
    select: { amount: true, status: true, paymentDate: true },
    take: 5000,
  });
  const byMonth = new Map<string, { paid: number; pending: number }>();
  for (const p of payments) {
    const month = p.paymentDate.toISOString().slice(0, 7);
    const e = byMonth.get(month) ?? { paid: 0, pending: 0 };
    if (p.status === "PAID") e.paid += p.amount;
    else if (p.status === "PENDING") e.pending += p.amount;
    byMonth.set(month, e);
  }
  const sortedMonths = Array.from(byMonth.keys()).sort();
  return {
    type: "line",
    title: "Payments Trend (Paid vs Pending)",
    titleAr: "اتجاه المدفوعات (مدفوع مقابل معلق)",
    xLabel: "Month",
    yLabel: "Amount (SAR)",
    unit: "currency",
    currency: "SAR",
    series: [
      { name: "Paid", nameAr: "مدفوع", color: CHART_COLORS[3], data: sortedMonths.map((m) => ({ label: m, value: Math.round(byMonth.get(m)?.paid ?? 0) })) },
      { name: "Pending", nameAr: "معلق", color: CHART_COLORS[1], data: sortedMonths.map((m) => ({ label: m, value: Math.round(byMonth.get(m)?.pending ?? 0) })) },
    ],
  };
}
