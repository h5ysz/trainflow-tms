// GCCLAB AI Copilot — Phase 3 — KPI Engine
// =====================================================================
// Pure functions that compute KPIs from the live database. Every query is
// scoped via AnalyticsScope so contractors only see their own data.
//
// All KPIs are computed in a single batch of parallel Prisma aggregates
// to minimize round-trips. Cached for 1 minute per user-scope.
import { db } from "@/lib/db";
import type { AnalyticsScope, TimeRange, KpiCard, KpiGroup, KpiResult } from "./types";
import { cached, buildKey, getTtl } from "./cache";

// ─── Scope helpers ────────────────────────────────────────────────────────
function sessionCompanyFilter(scope: AnalyticsScope): Record<string, unknown> {
  if (scope.role === "CONTRACTOR" && scope.companyId) {
    return { enrollments: { some: { companyId: scope.companyId, deletedAt: null } } };
  }
  return {};
}

function invoiceFilter(scope: AnalyticsScope, range: TimeRange): Record<string, unknown> {
  const base: Record<string, unknown> = {
    deletedAt: null,
    issueDate: { gte: range.from, lte: range.to },
  };
  if (scope.role === "CONTRACTOR" && scope.companyId) {
    base.companyId = scope.companyId;
  }
  return base;
}

// ─── Growth % helper ──────────────────────────────────────────────────────
function growthPercent(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

// ─── Main KPI computation ─────────────────────────────────────────────────
export async function computeKpis(scope: AnalyticsScope, range: TimeRange): Promise<KpiResult> {
  const key = buildKey(scope, "kpis", range.from.toISOString().slice(0, 10), range.to.toISOString().slice(0, 10));
  return cached(key, getTtl("KPI"), ["kpis", "sessions", "invoices", "certificates"], async () => {
    // Previous period for delta calculations (same length as `range`)
    const rangeMs = range.to.getTime() - range.from.getTime();
    const prevFrom = new Date(range.from.getTime() - rangeMs);
    const prevTo = range.from;

    const scFilter = sessionCompanyFilter(scope);
    const invFilter = invoiceFilter(scope, range);
    const prevInvFilter = invoiceFilter(scope, { from: prevFrom, to: prevTo });

    // ── Parallel aggregate queries ────────────────────────────────────────
    const [
      // Revenue
      revenueAgg, prevRevenueAgg, outstandingAgg, lateInvoicesCount,
      // Training
      sessionsTotal, sessionsByStatus, attendanceStats, certsIssued, reExamCount, avgTraineesPerSession, capacityUtilization,
      // Trainers
      topTrainersBySessions, trainerPassRates, trainerUtilization, idleTrainers,
      // Contractors
      topContractorsByActivity, topContractorsBySpend, topContractorsByFailureRate,
      // Certificates
      certExpiryBuckets, certStatusCounts,
    ] = await Promise.all([
      // Revenue
      db.invoice.aggregate({ where: invFilter as Record<string, never>, _sum: { grandTotal: true }, _count: true }),
      db.invoice.aggregate({ where: prevInvFilter as Record<string, never>, _sum: { grandTotal: true } }),
      db.invoice.aggregate({
        where: { deletedAt: null, status: { in: ["PENDING_PAYMENT", "PARTIALLY_PAID", "OVERDUE"] }, ...(scope.role === "CONTRACTOR" && scope.companyId ? { companyId: scope.companyId } : {}) },
        _sum: { outstandingBalance: true },
      }),
      db.invoice.count({
        where: { deletedAt: null, status: "OVERDUE", ...(scope.role === "CONTRACTOR" && scope.companyId ? { companyId: scope.companyId } : {}) },
      }),
      // Training
      db.trainingSession.count({ where: { deletedAt: null, ...scFilter } }),
      db.trainingSession.groupBy({ by: ["status"], where: { deletedAt: null, ...scFilter }, _count: true }),
      getAttendanceStats(scope, range),
      db.certificate.count({ where: { deletedAt: null, issuedAt: { gte: range.from, lte: range.to }, ...(scope.role === "CONTRACTOR" && scope.companyId ? { companyId: scope.companyId } : {}) } }),
      db.sessionEnrollment.count({ where: { deletedAt: null, isReExam: true, ...(scope.role === "CONTRACTOR" && scope.companyId ? { companyId: scope.companyId } : {}) } }),
      getAvgTraineesPerSession(scope, range),
      getCapacityUtilization(scope, range),
      // Trainers
      getTopTrainersBySessions(scope, range),
      getTrainerPassRates(scope, range),
      getTrainerUtilization(scope, range),
      getIdleTrainers(scope, range),
      // Contractors
      getTopContractorsByActivity(scope, range),
      getTopContractorsBySpend(scope, range),
      getTopContractorsByFailureRate(scope, range),
      // Certificates
      getCertExpiryBuckets(scope),
      db.certificate.groupBy({ by: ["status"], where: { deletedAt: null, ...(scope.role === "CONTRACTOR" && scope.companyId ? { companyId: scope.companyId } : {}) }, _count: true }),
    ]);

    // ── Build KPI cards ───────────────────────────────────────────────────
    const revenue = revenueAgg._sum.grandTotal ?? 0;
    const prevRevenue = prevRevenueAgg._sum.grandTotal ?? 0;
    const revenueGrowth = growthPercent(revenue, prevRevenue);
    const outstanding = outstandingAgg._sum.outstandingBalance ?? 0;
    const avgInvoice = revenueAgg._count > 0 ? revenue / revenueAgg._count : 0;

    const sessionsByStatusMap = new Map(sessionsByStatus.map((s) => [s.status, s._count]));
    const completedSessions = sessionsByStatusMap.get("COMPLETED") ?? 0;
    const runningSessions = sessionsByStatusMap.get("IN_PROGRESS") ?? 0;
    const upcomingSessions = sessionsByStatusMap.get("SCHEDULED") ?? 0;
    const cancelledSessions = sessionsByStatusMap.get("CANCELLED") ?? 0;

    const passRate = attendanceStats.passRate;
    const attendancePct = attendanceStats.attendancePct;

    const certByStatusMap = new Map(certStatusCounts.map((c) => [c.status, c._count]));
    const validCerts = certByStatusMap.get("VALID") ?? 0;
    const expiredCerts = certByStatusMap.get("EXPIRED") ?? 0;
    const revokedCerts = certByStatusMap.get("REVOKED") ?? 0;

    const groups: KpiGroup[] = [];

    // ── Revenue group (only for SUPER_ADMIN + COORDINATOR) ────────────────
    if (scope.canSeeFinancial) {
      groups.push({
        group: "revenue",
        label: "Revenue",
        labelAr: "الإيرادات",
        cards: [
          {
            key: "revenue_total",
            label: "Total Revenue",
            labelAr: "إجمالي الإيرادات",
            value: revenue,
            format: "currency",
            currency: "SAR",
            deltaPercent: revenueGrowth,
            deltaLabel: revenueGrowth !== null ? `${revenueGrowth > 0 ? "+" : ""}${revenueGrowth}% vs previous period` : undefined,
            deltaLabelAr: revenueGrowth !== null ? `${revenueGrowth > 0 ? "+" : ""}${revenueGrowth}% عن الفترة السابقة` : undefined,
            tone: revenueGrowth === null ? "default" : revenueGrowth >= 0 ? "positive" : "negative",
            icon: "TrendingUp",
            group: "revenue",
          },
          {
            key: "revenue_outstanding",
            label: "Outstanding Invoices",
            labelAr: "الفواتير المستحقة",
            value: outstanding,
            format: "currency",
            currency: "SAR",
            tone: outstanding > 0 ? "warning" : "positive",
            icon: "FileText",
            group: "revenue",
          },
          {
            key: "revenue_avg_invoice",
            label: "Average Invoice",
            labelAr: "متوسط الفاتورة",
            value: avgInvoice,
            format: "currency",
            currency: "SAR",
            tone: "info",
            icon: "Receipt",
            group: "revenue",
          },
          {
            key: "revenue_late",
            label: "Late Payments",
            labelAr: "المدفوعات المتأخرة",
            value: lateInvoicesCount,
            format: "number",
            tone: lateInvoicesCount > 0 ? "negative" : "positive",
            icon: "AlertTriangle",
            group: "revenue",
          },
        ],
      });
    }

    // ── Training group ───────────────────────────────────────────────────
    groups.push({
      group: "training",
      label: "Training",
      labelAr: "التدريب",
      cards: [
        { key: "sessions_total", label: "Total Sessions", labelAr: "إجمالي الجلسات", value: sessionsTotal, format: "number", tone: "info", icon: "CalendarDays", group: "training" },
        { key: "sessions_completed", label: "Completed", labelAr: "مكتملة", value: completedSessions, format: "number", tone: "positive", icon: "CheckCircle2", group: "training" },
        { key: "sessions_running", label: "Running", labelAr: "قيد التنفيذ", value: runningSessions, format: "number", tone: "info", icon: "PlayCircle", group: "training" },
        { key: "sessions_upcoming", label: "Upcoming", labelAr: "القادمة", value: upcomingSessions, format: "number", tone: "default", icon: "Clock", group: "training" },
        { key: "sessions_cancelled", label: "Cancelled", labelAr: "ملغاة", value: cancelledSessions, format: "number", tone: cancelledSessions > 0 ? "negative" : "default", icon: "XCircle", group: "training" },
        { key: "training_pass_rate", label: "Pass Rate", labelAr: "نسبة النجاح", value: passRate, format: "percentage", tone: passRate >= 70 ? "positive" : passRate >= 50 ? "warning" : "negative", icon: "Award", group: "training" },
        { key: "training_attendance", label: "Attendance %", labelAr: "نسبة الحضور", value: attendancePct, format: "percentage", tone: attendancePct >= 80 ? "positive" : attendancePct >= 60 ? "warning" : "negative", icon: "UserCheck", group: "training" },
        { key: "certs_issued", label: "Certificates Issued", labelAr: "الشهادات الصادرة", value: certsIssued, format: "number", tone: "info", icon: "BadgeCheck", group: "training" },
        { key: "re_exams", label: "Re-Exams", labelAr: "إعادة الامتحانات", value: reExamCount, format: "number", tone: reExamCount > 0 ? "warning" : "default", icon: "RefreshCw", group: "training" },
        { key: "avg_trainees_session", label: "Avg Trainees/Session", labelAr: "متوسط المتدربين/جلسة", value: avgTraineesPerSession, format: "number", tone: "info", icon: "Users", group: "training" },
        { key: "capacity_utilization", label: "Capacity Utilization", labelAr: "استغلال الطاقة", value: capacityUtilization, format: "percentage", tone: capacityUtilization >= 80 ? "positive" : capacityUtilization >= 50 ? "warning" : "negative", icon: "Gauge", group: "training" },
      ],
    });

    // ── Trainers group (operational) ─────────────────────────────────────
    if (scope.canSeeOperational) {
      groups.push({
        group: "trainers",
        label: "Trainers",
        labelAr: "المدربون",
        cards: [
          { key: "trainer_top", label: "Top Trainer (by sessions)", labelAr: "أفضل مدرب (حسب الجلسات)", value: topTrainersBySessions[0]?.trainerName ?? "—", format: "text", tone: "info", icon: "Star", group: "trainers" },
          { key: "trainer_top_pass", label: "Highest Pass Rate", labelAr: "أعلى نسبة نجاح", value: trainerPassRates[0] ? `${trainerPassRates[0].trainerName} (${trainerPassRates[0].passRate}%)` : "—", format: "text", tone: "positive", icon: "Trophy", group: "trainers" },
          { key: "trainer_low_pass", label: "Lowest Pass Rate", labelAr: "أدنى نسبة نجاح", value: trainerPassRates[trainerPassRates.length - 1] ? `${trainerPassRates[trainerPassRates.length - 1].trainerName} (${trainerPassRates[trainerPassRates.length - 1].passRate}%)` : "—", format: "text", tone: trainerPassRates.length > 0 && trainerPassRates[trainerPassRates.length - 1].passRate < 50 ? "negative" : "warning", icon: "AlertCircle", group: "trainers" },
          { key: "trainer_utilization", label: "Trainer Utilization", labelAr: "استغلال المدربين", value: trainerUtilization, format: "percentage", tone: trainerUtilization >= 80 ? "negative" : trainerUtilization >= 40 ? "positive" : "warning", icon: "Gauge", group: "trainers" },
          { key: "trainer_idle", label: "Idle Trainers (30d)", labelAr: "مدربون خاملون (30 يوم)", value: idleTrainers, format: "number", tone: idleTrainers > 0 ? "warning" : "positive", icon: "UserX", group: "trainers" },
        ],
      });
    }

    // ── Contractors group ────────────────────────────────────────────────
    if (scope.role !== "CONTRACTOR") {
      const contractorCards: KpiCard[] = [
        { key: "contractor_top_active", label: "Most Active", labelAr: "الأكثر نشاطاً", value: topContractorsByActivity[0]?.companyName ?? "—", format: "text", tone: "info", icon: "Building2", group: "contractors" },
        ...(scope.canSeeFinancial ? [{ key: "contractor_top_spend", label: "Highest Spending", labelAr: "الأعلى إنفاقاً", value: topContractorsBySpend[0]?.companyName ?? "—", format: "text" as const, tone: "info" as const, icon: "DollarSign", group: "contractors" as const }] : []),
        { key: "contractor_failure", label: "Highest Failure Rate", labelAr: "أعلى نسبة رسوب", value: topContractorsByFailureRate[0] ? `${topContractorsByFailureRate[0].companyName} (${topContractorsByFailureRate[0].failRate}%)` : "—", format: "text", tone: "warning", icon: "AlertTriangle", group: "contractors" },
      ];
      groups.push({
        group: "contractors",
        label: "Contractors",
        labelAr: "المقاولون",
        cards: contractorCards,
      });
    }

    // ── Certificates group ───────────────────────────────────────────────
    groups.push({
      group: "certificates",
      label: "Certificates",
      labelAr: "الشهادات",
      cards: [
        { key: "cert_valid", label: "Valid", labelAr: "صالحة", value: validCerts, format: "number", tone: "positive", icon: "BadgeCheck", group: "certificates" },
        { key: "cert_expired", label: "Expired", labelAr: "منتهية", value: expiredCerts, format: "number", tone: expiredCerts > 0 ? "negative" : "positive", icon: "XCircle", group: "certificates" },
        { key: "cert_revoked", label: "Revoked", labelAr: "ملغاة", value: revokedCerts, format: "number", tone: revokedCerts > 0 ? "warning" : "default", icon: "Ban", group: "certificates" },
        { key: "cert_expiring_7", label: "Expiring (7d)", labelAr: "تنتهي (7 أيام)", value: certExpiryBuckets.d7, format: "number", tone: certExpiryBuckets.d7 > 0 ? "negative" : "positive", icon: "Clock", group: "certificates" },
        { key: "cert_expiring_30", label: "Expiring (30d)", labelAr: "تنتهي (30 يوم)", value: certExpiryBuckets.d30, format: "number", tone: certExpiryBuckets.d30 > 0 ? "warning" : "positive", icon: "Clock", group: "certificates" },
        { key: "cert_expiring_60", label: "Expiring (60d)", labelAr: "تنتهي (60 يوم)", value: certExpiryBuckets.d60, format: "number", tone: "info", icon: "Clock", group: "certificates" },
        { key: "cert_expiring_90", label: "Expiring (90d)", labelAr: "تنتهي (90 يوم)", value: certExpiryBuckets.d90, format: "number", tone: "info", icon: "Clock", group: "certificates" },
      ],
    });

    return {
      generatedAt: new Date().toISOString(),
      range,
      groups,
    };
  });
}

// ─── Helper aggregates ─────────────────────────────────────────────────────

async function getAttendanceStats(scope: AnalyticsScope, range: TimeRange) {
  const where: Record<string, unknown> = {
    deletedAt: null,
    session: { startDate: { gte: range.from, lte: range.to }, deletedAt: null, ...sessionCompanyFilter(scope) },
  };
  const stats = await db.attendance.groupBy({
    by: ["status"],
    where,
    _count: true,
  });
  const map = new Map(stats.map((s) => [s.status, s._count]));
  const present = (map.get("PRESENT") ?? 0) + (map.get("LATE") ?? 0);
  const total = Array.from(map.values()).reduce((a, b) => a + b, 0);
  const attendancePct = total > 0 ? Math.round((present / total) * 100) : 0;

  // Pass rate: based on TestResult records in range
  const testResults = await db.testResult.groupBy({
    by: ["passed"],
    where: { deletedAt: null, attemptedAt: { gte: range.from, lte: range.to } },
    _count: true,
  });
  const passedCount = testResults.find((t) => t.passed === true)?._count ?? 0;
  const failedCount = testResults.find((t) => t.passed === false)?._count ?? 0;
  const totalTests = passedCount + failedCount;
  const passRate = totalTests > 0 ? Math.round((passedCount / totalTests) * 100) : 0;
  return { attendancePct, passRate };
}

async function getAvgTraineesPerSession(scope: AnalyticsScope, range: TimeRange) {
  const result = await db.trainingSession.aggregate({
    where: { deletedAt: null, startDate: { gte: range.from, lte: range.to }, ...sessionCompanyFilter(scope) },
    _avg: { expectedTrainees: true },
  });
  return Math.round(result._avg.expectedTrainees ?? 0);
}

async function getCapacityUtilization(scope: AnalyticsScope, range: TimeRange) {
  // avg(expectedTrainees / capacity) * 100
  const sessions = await db.trainingSession.findMany({
    where: { deletedAt: null, startDate: { gte: range.from, lte: range.to }, ...sessionCompanyFilter(scope) },
    select: { expectedTrainees: true, capacity: true },
    take: 500,
  });
  if (sessions.length === 0) return 0;
  const utilizations = sessions.map((s) => s.capacity > 0 ? (s.expectedTrainees / s.capacity) * 100 : 0);
  return Math.round(utilizations.reduce((a, b) => a + b, 0) / sessions.length);
}

async function getTopTrainersBySessions(scope: AnalyticsScope, range: TimeRange) {
  if (!scope.canSeeOperational) return [];
  const rows = await db.trainingSession.groupBy({
    by: ["trainerId"],
    where: { deletedAt: null, startDate: { gte: range.from, lte: range.to }, trainerId: { not: null } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 10,
  });
  if (rows.length === 0) return [];
  const trainers = await db.trainer.findMany({
    where: { id: { in: rows.map((r) => r.trainerId).filter((x): x is string => x !== null) } },
    select: { id: true, nameEn: true, refNumber: true },
  });
  const trainerMap = new Map(trainers.map((t) => [t.id, t]));
  return rows.map((r) => ({
    trainerId: r.trainerId,
    trainerName: trainerMap.get(r.trainerId ?? "")?.nameEn ?? "—",
    trainerRef: trainerMap.get(r.trainerId ?? "")?.refNumber ?? "—",
    sessionCount: r._count,
  }));
}

async function getTrainerPassRates(scope: AnalyticsScope, range: TimeRange) {
  if (!scope.canSeeOperational) return [];
  // Group test results by session → trainer
  const testResults = await db.testResult.findMany({
    where: { deletedAt: null, attemptedAt: { gte: range.from, lte: range.to } },
    select: { passed: true, session: { select: { trainerId: true, trainer: { select: { id: true, nameEn: true, refNumber: true } } } } },
    take: 1000,
  });
  const byTrainer = new Map<string, { name: string; ref: string; passed: number; total: number }>();
  for (const r of testResults) {
    const tid = r.session.trainerId;
    if (!tid) continue;
    const entry = byTrainer.get(tid) ?? { name: r.session.trainer?.nameEn ?? "—", ref: r.session.trainer?.refNumber ?? "—", passed: 0, total: 0 };
    entry.total++;
    if (r.passed) entry.passed++;
    byTrainer.set(tid, entry);
  }
  const arr = Array.from(byTrainer.entries()).map(([id, e]) => ({
    trainerId: id, trainerName: e.name, trainerRef: e.ref,
    passRate: e.total > 0 ? Math.round((e.passed / e.total) * 100) : 0,
    total: e.total,
  }));
  arr.sort((a, b) => b.passRate - a.passRate);
  return arr;
}

async function getTrainerUtilization(scope: AnalyticsScope, range: TimeRange) {
  if (!scope.canSeeOperational) return 0;
  const activeTrainers = await db.trainingSession.findMany({
    where: { deletedAt: null, startDate: { gte: range.from, lte: range.to }, trainerId: { not: null } },
    select: { trainerId: true },
    distinct: ["trainerId"],
  });
  const totalTrainers = await db.trainer.count({ where: { deletedAt: null, status: "ACTIVE" } });
  if (totalTrainers === 0) return 0;
  return Math.round((activeTrainers.length / totalTrainers) * 100);
}

async function getIdleTrainers(scope: AnalyticsScope, _range: TimeRange) {
  if (!scope.canSeeOperational) return 0;
  const thirty = new Date(Date.now() - 30 * 86400000);
  const activeTrainers = await db.trainingSession.findMany({
    where: { deletedAt: null, startDate: { gte: thirty }, trainerId: { not: null } },
    select: { trainerId: true },
    distinct: ["trainerId"],
  });
  const activeIds = new Set(activeTrainers.map((t) => t.trainerId));
  const totalActive = await db.trainer.count({ where: { deletedAt: null, status: "ACTIVE" } });
  return Math.max(0, totalActive - activeIds.size);
}

async function getTopContractorsByActivity(_scope: AnalyticsScope, range: TimeRange) {
  const rows = await db.sessionEnrollment.groupBy({
    by: ["companyId"],
    where: { deletedAt: null, enrollmentDate: { gte: range.from, lte: range.to }, enrollmentStatus: { not: "CANCELLED" } },
    _count: { id: true },
    orderBy: { _count: { id: "desc" } },
    take: 10,
  });
  if (rows.length === 0) return [];
  const companies = await db.company.findMany({
    where: { id: { in: rows.map((r) => r.companyId) } },
    select: { id: true, name: true, refNumber: true },
  });
  const companyMap = new Map(companies.map((c) => [c.id, c]));
  return rows.map((r) => ({
    companyId: r.companyId,
    companyName: companyMap.get(r.companyId)?.name ?? "—",
    companyRef: companyMap.get(r.companyId)?.refNumber ?? "—",
    enrollmentCount: r._count,
  }));
}

async function getTopContractorsBySpend(scope: AnalyticsScope, range: TimeRange) {
  if (!scope.canSeeFinancial) return [];
  const grouped = await db.invoice.groupBy({
    by: ["companyId"],
    where: { deletedAt: null, issueDate: { gte: range.from, lte: range.to } },
    _sum: { grandTotal: true },
    orderBy: { _sum: { grandTotal: "desc" } },
    take: 10,
  });
  if (grouped.length === 0) return [];
  const companies = await db.company.findMany({
    where: { id: { in: grouped.map((r) => r.companyId) } },
    select: { id: true, name: true, refNumber: true },
  });
  const companyMap = new Map(companies.map((c) => [c.id, c]));
  return grouped.map((r) => ({
    companyId: r.companyId,
    companyName: companyMap.get(r.companyId)?.name ?? "—",
    companyRef: companyMap.get(r.companyId)?.refNumber ?? "—",
    total: r._sum.grandTotal ?? 0,
  }));
}

async function getTopContractorsByFailureRate(_scope: AnalyticsScope, range: TimeRange) {
  // Aggregate failures per company (via trainee's company on TestResult)
  const testResults = await db.testResult.findMany({
    where: { deletedAt: null, attemptedAt: { gte: range.from, lte: range.to } },
    select: { passed: true, companyId: true },
    take: 2000,
  });
  const byCompany = new Map<string, { failed: number; total: number }>();
  for (const r of testResults) {
    if (!r.companyId) continue;
    const e = byCompany.get(r.companyId) ?? { failed: 0, total: 0 };
    e.total++;
    if (!r.passed) e.failed++;
    byCompany.set(r.companyId, e);
  }
  const arr = Array.from(byCompany.entries()).map(([companyId, e]) => ({
    companyId,
    failRate: e.total > 0 ? Math.round((e.failed / e.total) * 100) : 0,
    failed: e.failed,
    total: e.total,
  }));
  arr.sort((a, b) => b.failRate - a.failRate);
  const top = arr.slice(0, 10);
  if (top.length === 0) return [];
  const companies = await db.company.findMany({
    where: { id: { in: top.map((t) => t.companyId) } },
    select: { id: true, name: true, refNumber: true },
  });
  const companyMap = new Map(companies.map((c) => [c.id, c]));
  return top.map((t) => ({
    companyId: t.companyId,
    companyName: companyMap.get(t.companyId)?.name ?? "—",
    companyRef: companyMap.get(t.companyId)?.refNumber ?? "—",
    failRate: t.failRate,
  }));
}

async function getCertExpiryBuckets(scope: AnalyticsScope) {
  const now = new Date();
  const companyWhere = scope.role === "CONTRACTOR" && scope.companyId ? { companyId: scope.companyId } : {};
  const [d7, d30, d60, d90] = await Promise.all([
    db.certificate.count({ where: { deletedAt: null, status: "VALID", validUntil: { gte: now, lte: new Date(now.getTime() + 7 * 86400000) }, ...companyWhere } }),
    db.certificate.count({ where: { deletedAt: null, status: "VALID", validUntil: { gte: now, lte: new Date(now.getTime() + 30 * 86400000) }, ...companyWhere } }),
    db.certificate.count({ where: { deletedAt: null, status: "VALID", validUntil: { gte: now, lte: new Date(now.getTime() + 60 * 86400000) }, ...companyWhere } }),
    db.certificate.count({ where: { deletedAt: null, status: "VALID", validUntil: { gte: now, lte: new Date(now.getTime() + 90 * 86400000) }, ...companyWhere } }),
  ]);
  return { d7, d30, d60, d90 };
}
