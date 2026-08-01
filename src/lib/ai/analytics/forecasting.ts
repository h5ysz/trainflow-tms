// GCCLAB AI Copilot — Phase 3 — Forecasting Engine
// =====================================================================
// Predicts future values based on historical data. Uses simple but
// effective statistical methods:
//   - Linear regression for trend-based predictions (revenue, sessions)
//   - Moving average for stable metrics (pass rate, attendance)
//   - Direct count for known-future events (cert renewals, scheduled sessions)
//
// All forecasts include a confidence score (0-1) and a method label
// for transparency.
import { db } from "@/lib/db";
import type { AnalyticsScope, ForecastSeries, ForecastResult } from "./types";
import { cached, buildKey, getTtl } from "./cache";

function sessionCompanyFilter(scope: AnalyticsScope): Record<string, unknown> {
  if (scope.role === "CONTRACTOR" && scope.companyId) {
    return { enrollments: { some: { companyId: scope.companyId, deletedAt: null } } };
  }
  return {};
}

export async function computeForecast(scope: AnalyticsScope): Promise<ForecastResult> {
  const key = buildKey(scope, "forecast");
  return cached(key, getTtl("FORECAST"), ["forecast", "sessions", "invoices", "certificates"], async () => {
    const [revenue, sessions, trainerUtilization, courseDemand, certRenewals, expectedInvoices, cashFlow, attendance, passRate] = await Promise.all([
      forecastRevenue(scope),
      forecastSessions(scope),
      forecastTrainerUtilization(scope),
      forecastCourseDemand(scope),
      forecastCertRenewals(scope),
      forecastExpectedInvoices(scope),
      forecastCashFlow(scope),
      forecastAttendance(scope),
      forecastPassRate(scope),
    ]);
    const series: ForecastSeries[] = [revenue, sessions, trainerUtilization, courseDemand, certRenewals, expectedInvoices, cashFlow, attendance, passRate].filter((s): s is ForecastSeries => s !== null);
    return { generatedAt: new Date().toISOString(), series };
  });
}

// ─── Helpers ───────────────────────────────────────────────────────────────

interface MonthlyValue { label: string; value: number; }

async function getMonthlyRevenue(scope: AnalyticsScope, months = 12): Promise<MonthlyValue[]> {
  if (!scope.canSeeFinancial) return [];
  const from = new Date();
  from.setMonth(from.getMonth() - (months - 1));
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  const invoices = await db.invoice.findMany({
    where: { deletedAt: null, issueDate: { gte: from } },
    select: { grandTotal: true, issueDate: true },
    take: 5000,
  });
  return aggregateByMonth(invoices, (i) => i.issueDate, (i) => i.grandTotal);
}

async function getMonthlySessions(scope: AnalyticsScope, months = 12): Promise<MonthlyValue[]> {
  const from = new Date();
  from.setMonth(from.getMonth() - (months - 1));
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  const scFilter = sessionCompanyFilter(scope);
  const sessions = await db.trainingSession.findMany({
    where: { deletedAt: null, startDate: { gte: from }, ...scFilter },
    select: { startDate: true },
    take: 5000,
  });
  return aggregateByMonth(sessions, (s) => s.startDate, () => 1);
}

async function getMonthlyAttendance(scope: AnalyticsScope, months = 12): Promise<MonthlyValue[]> {
  const from = new Date();
  from.setMonth(from.getMonth() - (months - 1));
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  const scFilter = sessionCompanyFilter(scope);
  const sessions = await db.trainingSession.findMany({
    where: { deletedAt: null, startDate: { gte: from }, ...scFilter },
    select: { startDate: true, expectedTrainees: true, actualTrainees: true },
    take: 5000,
  });
  const byMonth = new Map<string, { expected: number; actual: number }>();
  for (const s of sessions) {
    const m = s.startDate.toISOString().slice(0, 7);
    const e = byMonth.get(m) ?? { expected: 0, actual: 0 };
    e.expected += s.expectedTrainees;
    e.actual += s.actualTrainees;
    byMonth.set(m, e);
  }
  return Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([label, v]) => ({
    label,
    value: v.expected > 0 ? Math.round((v.actual / v.expected) * 100) : 0,
  }));
}

async function getMonthlyPassRate(_scope: AnalyticsScope, months = 12): Promise<MonthlyValue[]> {
  const from = new Date();
  from.setMonth(from.getMonth() - (months - 1));
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  const tests = await db.testResult.findMany({
    where: { deletedAt: null, attemptedAt: { gte: from } },
    select: { passed: true, attemptedAt: true },
    take: 5000,
  });
  const byMonth = new Map<string, { passed: number; total: number }>();
  for (const t of tests) {
    const m = t.attemptedAt.toISOString().slice(0, 7);
    const e = byMonth.get(m) ?? { passed: 0, total: 0 };
    e.total++;
    if (t.passed) e.passed++;
    byMonth.set(m, e);
  }
  return Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([label, v]) => ({
    label,
    value: v.total > 0 ? Math.round((v.passed / v.total) * 100) : 0,
  }));
}

function aggregateByMonth<T>(rows: T[], getDate: (r: T) => Date, getValue: (r: T) => number): MonthlyValue[] {
  const byMonth = new Map<string, number>();
  for (const r of rows) {
    const m = getDate(r).toISOString().slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + getValue(r));
  }
  return Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([label, value]) => ({ label, value }));
}

/**
 * Simple linear regression forecast: fit y = a + b*x to historical data,
 * then predict the next `horizon` months. Confidence is R² (0-1).
 */
function linearForecast(history: MonthlyValue[], horizon = 3): { points: ForecastSeries["points"]; confidence: number } {
  if (history.length < 2) {
    return { points: history.map((h) => ({ label: h.label, historical: h.value })), confidence: 0 };
  }
  const n = history.length;
  const xs = history.map((_, i) => i);
  const ys = history.map((h) => h.value);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  const intercept = yMean - slope * xMean;

  // R² for confidence
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    const yPred = intercept + slope * xs[i];
    ssTot += (ys[i] - yMean) ** 2;
    ssRes += (ys[i] - yPred) ** 2;
  }
  const r2 = ssTot === 0 ? 1 : Math.max(0, 1 - ssRes / ssTot);

  // Build forecast points: historical + horizon future months
  const points: ForecastSeries["points"] = history.map((h) => ({ label: h.label, historical: h.value }));

  // Generate future month labels
  const lastMonth = history[history.length - 1].label; // "YYYY-MM"
  const [yearStr, monthStr] = lastMonth.split("-").map(Number);
  let year = yearStr, month = monthStr;
  for (let h = 1; h <= horizon; h++) {
    month++;
    if (month > 12) { month = 1; year++; }
    const label = `${year}-${String(month).padStart(2, "0")}`;
    const x = n + h - 1;
    const forecast = Math.max(0, Math.round(intercept + slope * x));
    // Confidence interval widens with horizon
    const stdDev = Math.sqrt(ssRes / Math.max(1, n - 2));
    const margin = stdDev * (1 + h * 0.2);
    points.push({
      label,
      forecast,
      lower: Math.max(0, Math.round(forecast - margin)),
      upper: Math.round(forecast + margin),
    });
  }
  return { points, confidence: Math.min(1, r2) };
}

/**
 * Moving average forecast: predict next value as average of last N values.
 * Used for stable metrics (pass rate, attendance %).
 */
function movingAverageForecast(history: MonthlyValue[], window = 3, horizon = 3): { points: ForecastSeries["points"]; confidence: number } {
  if (history.length < 2) {
    return { points: history.map((h) => ({ label: h.label, historical: h.value })), confidence: 0 };
  }
  const points: ForecastSeries["points"] = history.map((h) => ({ label: h.label, historical: h.value }));
  const recentValues = history.slice(-window).map((h) => h.value);
  const avg = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;
  // Variance for confidence
  const variance = recentValues.length > 1
    ? recentValues.reduce((s, v) => s + (v - avg) ** 2, 0) / (recentValues.length - 1)
    : 0;
  const stdDev = Math.sqrt(variance);
  // Confidence: low variance → high confidence
  const avgAbs = Math.abs(avg) || 1;
  const confidence = Math.max(0, Math.min(1, 1 - (stdDev / avgAbs)));

  const lastMonth = history[history.length - 1].label;
  const [yearStr, monthStr] = lastMonth.split("-").map(Number);
  let year = yearStr, month = monthStr;
  for (let h = 1; h <= horizon; h++) {
    month++;
    if (month > 12) { month = 1; year++; }
    const label = `${year}-${String(month).padStart(2, "0")}`;
    points.push({
      label,
      forecast: Math.round(avg),
      lower: Math.max(0, Math.round(avg - stdDev)),
      upper: Math.round(avg + stdDev),
    });
  }
  return { points, confidence };
}

// ─── Forecast series builders ──────────────────────────────────────────────

async function forecastRevenue(scope: AnalyticsScope): Promise<ForecastSeries | null> {
  if (!scope.canSeeFinancial) return null;
  const history = await getMonthlyRevenue(scope, 12);
  const { points, confidence } = linearForecast(history, 3);
  return {
    key: "revenue",
    label: "Revenue Forecast (next 3 months)",
    labelAr: "توقعات الإيرادات (3 أشهر قادمة)",
    unit: "currency",
    currency: "SAR",
    points,
    method: "Linear regression on 12 months of historical data",
    methodAr: "انحدار خطي على 12 شهراً من البيانات التاريخية",
    confidence,
  };
}

async function forecastSessions(scope: AnalyticsScope): Promise<ForecastSeries | null> {
  const history = await getMonthlySessions(scope, 12);
  const { points, confidence } = linearForecast(history, 3);
  return {
    key: "sessions",
    label: "Sessions Forecast (next 3 months)",
    labelAr: "توقعات الجلسات (3 أشهر قادمة)",
    unit: "count",
    points,
    method: "Linear regression on 12 months of historical data",
    methodAr: "انحدار خطي على 12 شهراً من البيانات التاريخية",
    confidence,
  };
}

async function forecastTrainerUtilization(scope: AnalyticsScope): Promise<ForecastSeries | null> {
  if (!scope.canSeeOperational) return null;
  // Compute trainer utilization per month for the last 12 months
  const from = new Date();
  from.setMonth(from.getMonth() - 11);
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  const totalTrainers = await db.trainer.count({ where: { deletedAt: null, status: "ACTIVE" } });
  if (totalTrainers === 0) return null;
  const sessions = await db.trainingSession.findMany({
    where: { deletedAt: null, startDate: { gte: from }, trainerId: { not: null } },
    select: { trainerId: true, startDate: true },
    take: 5000,
  });
  const byMonth = new Map<string, Set<string>>();
  for (const s of sessions) {
    const m = s.startDate.toISOString().slice(0, 7);
    if (!s.trainerId) continue;
    const set = byMonth.get(m) ?? new Set<string>();
    set.add(s.trainerId);
    byMonth.set(m, set);
  }
  const history: MonthlyValue[] = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([label, set]) => ({
    label,
    value: Math.round((set.size / totalTrainers) * 100),
  }));
  const { points, confidence } = movingAverageForecast(history, 3, 3);
  return {
    key: "trainer_utilization",
    label: "Trainer Utilization Forecast (next 3 months)",
    labelAr: "توقعات استغلال المدربين (3 أشهر قادمة)",
    unit: "percent",
    points,
    method: "3-month moving average",
    methodAr: "متوسط متحرك لـ 3 أشهر",
    confidence,
  };
}

async function forecastCourseDemand(scope: AnalyticsScope): Promise<ForecastSeries | null> {
  // Aggregate session count by month — same as forecastSessions but with different label
  const history = await getMonthlySessions(scope, 12);
  const { points, confidence } = linearForecast(history, 3);
  return {
    key: "course_demand",
    label: "Course Demand Forecast (next 3 months)",
    labelAr: "توقعات الطلب على الدورات (3 أشهر قادمة)",
    unit: "count",
    points,
    method: "Linear regression on 12 months of historical data",
    methodAr: "انحدار خطي على 12 شهراً من البيانات التاريخية",
    confidence,
  };
}

async function forecastCertRenewals(scope: AnalyticsScope): Promise<ForecastSeries | null> {
  // Count certificates expiring each month for the next 6 months (known future)
  const now = new Date();
  const where = scope.role === "CONTRACTOR" && scope.companyId ? { companyId: scope.companyId } : {};
  const certs = await db.certificate.findMany({
    where: { deletedAt: null, status: "VALID", validUntil: { gte: now, lte: new Date(now.getTime() + 180 * 86400000) }, ...where },
    select: { validUntil: true },
    take: 5000,
  });
  const byMonth = new Map<string, number>();
  for (const c of certs) {
    const m = c.validUntil.toISOString().slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1);
  }
  const sorted = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const points: ForecastSeries["points"] = sorted.map(([label, value]) => ({ label, forecast: value }));
  return {
    key: "cert_renewals",
    label: "Certificate Renewals (next 6 months)",
    labelAr: "تجديدات الشهادات (6 أشهر قادمة)",
    unit: "count",
    points,
    method: "Direct count of certificates with known expiry dates",
    methodAr: "عدد مباشر للشهادات بتواريخ انتهاء معروفة",
    confidence: 1.0, // these are scheduled, not predicted
  };
}

async function forecastExpectedInvoices(scope: AnalyticsScope): Promise<ForecastSeries | null> {
  if (!scope.canSeeFinancial) return null;
  // Forecast: pending + partially paid invoices expected to be paid in next 3 months (based on dueDate)
  const now = new Date();
  const threeMonths = new Date(now.getTime() + 90 * 86400000);
  const invoices = await db.invoice.findMany({
    where: { deletedAt: null, status: { in: ["PENDING_PAYMENT", "PARTIALLY_PAID", "OVERDUE"] }, dueDate: { gte: now, lte: threeMonths } },
    select: { outstandingBalance: true, dueDate: true },
    take: 2000,
  });
  const byMonth = new Map<string, number>();
  for (const i of invoices) {
    if (!i.dueDate) continue;
    const m = i.dueDate.toISOString().slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + i.outstandingBalance);
  }
  const sorted = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const points: ForecastSeries["points"] = sorted.map(([label, value]) => ({ label, forecast: Math.round(value) }));
  return {
    key: "expected_invoices",
    label: "Expected Invoice Payments (next 3 months)",
    labelAr: "المدفوعات المتوقعة للفواتير (3 أشهر قادمة)",
    unit: "currency",
    currency: "SAR",
    points,
    method: "Direct sum of outstanding invoices by due date",
    methodAr: "مجموع مباشر للفواتير المستحقة حسب تاريخ الاستحقاق",
    confidence: 0.9,
  };
}

async function forecastCashFlow(scope: AnalyticsScope): Promise<ForecastSeries | null> {
  if (!scope.canSeeFinancial) return null;
  // Cash flow = expected payments - refunds. Approximate as expected invoices.
  const now = new Date();
  const threeMonths = new Date(now.getTime() + 90 * 86400000);
  const invoices = await db.invoice.findMany({
    where: { deletedAt: null, dueDate: { gte: now, lte: threeMonths } },
    select: { outstandingBalance: true, dueDate: true, status: true },
    take: 2000,
  });
  const byMonth = new Map<string, number>();
  for (const i of invoices) {
    if (!i.dueDate || i.status === "PAID" || i.status === "CANCELLED") continue;
    const m = i.dueDate.toISOString().slice(0, 7);
    byMonth.set(m, (byMonth.get(m) ?? 0) + i.outstandingBalance);
  }
  const sorted = Array.from(byMonth.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const points: ForecastSeries["points"] = sorted.map(([label, value]) => ({ label, forecast: Math.round(value) }));
  return {
    key: "cash_flow",
    label: "Projected Cash Flow (next 3 months)",
    labelAr: "التدفق النقدي المتوقع (3 أشهر قادمة)",
    unit: "currency",
    currency: "SAR",
    points,
    method: "Sum of outstanding invoice amounts by due date",
    methodAr: "مجموع مبالغ الفواتير المستحقة حسب تاريخ الاستحقاق",
    confidence: 0.85,
  };
}

async function forecastAttendance(scope: AnalyticsScope): Promise<ForecastSeries | null> {
  const history = await getMonthlyAttendance(scope, 12);
  const { points, confidence } = movingAverageForecast(history, 3, 3);
  return {
    key: "attendance",
    label: "Attendance % Forecast (next 3 months)",
    labelAr: "توقعات نسبة الحضور (3 أشهر قادمة)",
    unit: "percent",
    points,
    method: "3-month moving average",
    methodAr: "متوسط متحرك لـ 3 أشهر",
    confidence,
  };
}

async function forecastPassRate(scope: AnalyticsScope): Promise<ForecastSeries | null> {
  const history = await getMonthlyPassRate(scope, 12);
  const { points, confidence } = movingAverageForecast(history, 3, 3);
  return {
    key: "pass_rate",
    label: "Pass Rate Forecast (next 3 months)",
    labelAr: "توقعات نسبة النجاح (3 أشهر قادمة)",
    unit: "percent",
    points,
    method: "3-month moving average",
    methodAr: "متوسط متحرك لـ 3 أشهر",
    confidence,
  };
}
