// GCCLAB AI Copilot — Phase 3 — Natural Language Analytics Query
// =====================================================================
// Routes natural-language questions to the right analytics function and
// returns a structured NlQueryResult (table / chart / kpi / text).
//
// The intent detection uses keyword matching — fast, deterministic, no LLM
// round-trip required. For more complex questions, the LLM (via the chat
// endpoint) can be used as a fallback.
import { db } from "@/lib/db";
import type { AnalyticsScope, NlQueryResult, ChartDataset, KpiCard } from "./types";
import { computeKpis } from "./kpis";
import { computeRecommendations } from "./recommendations";
import { rangeFromPreset } from "./types";
import { CHART_COLORS } from "./charts";

interface Intent {
  key: string;
  label: string;
  labelAr: string;
  keywords: string[];
  keywordsAr: string[];
}

const INTENTS: Intent[] = [
  { key: "top_revenue_contractor", label: "Top contractors by revenue", labelAr: "أعلى المقاولين بالإيرادات",
    keywords: ["highest revenue contractor", "top revenue contractor", "which contractor generated", "which contractor has the highest revenue", "biggest spender", "contractor with most revenue", "top contractor by revenue"],
    keywordsAr: ["أعلى مقاول بالإيرادات", "أكبر مقاول بالإيرادات", "أي مقاول ولّد", "أي مقاول لديه أعلى إيراد"] },
  { key: "best_pass_rate_trainer", label: "Best trainer by pass rate", labelAr: "أفضل مدرب بنسبة النجاح",
    keywords: ["best pass rate", "highest pass rate", "best trainer", "top trainer pass"],
    keywordsAr: ["أفضل نسبة نجاح", "أعلى نسبة نجاح", "أفضل مدرب"] },
  { key: "under_capacity_sessions", label: "Sessions under capacity", labelAr: "جلسات أقل من الطاقة",
    keywords: ["under capacity", "low capacity", "under filled", "underfilled", "low enrollment", "empty sessions"],
    keywordsAr: ["أقل من الطاقة", "طاقة منخفضة", "تسجيل منخفض"] },
  { key: "overdue_invoices", label: "Overdue invoices", labelAr: "فواتير متأخرة",
    keywords: ["overdue", "late invoice", "past due", "unpaid invoice"],
    keywordsAr: ["متأخرة", "فاتورة متأخرة", "غير مدفوعة"] },
  { key: "cert_renewals_next_month", label: "Certificate renewals next month", labelAr: "تجديدات الشهادات الشهر القادم",
    keywords: ["renewal", "renew", "expiring", "expiring next month", "certificate renewal"],
    keywordsAr: ["تجديد", "تجديدات", "منتهية", "شهادات منتهية"] },
  { key: "compare_months", label: "Compare months", labelAr: "مقارنة الأشهر",
    keywords: ["compare", "vs", "versus", "month over month", "mom", "july vs june", "august vs july"],
    keywordsAr: ["قارن", "مقارنة", " versus ", "شهر مقابل شهر"] },
  { key: "compare_trainers", label: "Compare trainers", labelAr: "مقارنة المدربين",
    keywords: ["compare trainer", "trainer vs", "trainer versus", "ahmed vs ali"],
    keywordsAr: ["قارن المدربين", "مدرب مقابل"] },
  { key: "revenue_summary", label: "Revenue summary", labelAr: "ملخص الإيرادات",
    keywords: ["revenue summary", "revenue overview", "total revenue", "how much revenue", "revenue this month", "revenue this year"],
    keywordsAr: ["ملخص الإيرادات", "إجمالي الإيرادات", "كم الإيرادات"] },
  { key: "session_summary", label: "Session summary", labelAr: "ملخص الجلسات",
    keywords: ["session summary", "sessions summary", "session overview", "training summary", "how many sessions", "session count"],
    keywordsAr: ["ملخص الجلسات", "إجمالي الجلسات", "كم جلسة"] },
];

export async function answerNlQuery(question: string, scope: AnalyticsScope): Promise<NlQueryResult> {
  const q = question.toLowerCase();
  // Match intent — weight multi-word keywords higher (more specific)
  let bestIntent: Intent | null = null;
  let bestScore = 0;
  for (const intent of INTENTS) {
    let score = 0;
    for (const kw of intent.keywords) {
      if (q.includes(kw.toLowerCase())) {
        // Weight multi-word keywords higher (more specific). Each word adds 10 points.
        const wordCount = kw.split(/\s+/).length;
        score += kw.length + wordCount * 10;
      }
    }
    for (const kw of intent.keywordsAr) {
      if (q.includes(kw.toLowerCase())) {
        const wordCount = kw.split(/\s+/).length;
        score += kw.length + wordCount * 10;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIntent = intent;
    }
  }

  if (!bestIntent || bestScore === 0) {
    return {
      kind: "text",
      answer: "I couldn't identify a specific analytics intent in your question. Try asking about: top contractors by revenue, best trainer pass rate, under-capacity sessions, overdue invoices, certificate renewals, or month-over-month comparisons.",
      answerAr: "لم أتمكن من تحديد نية تحليلية محددة في سؤالك. جرّب السؤال عن: أعلى المقاولين بالإيرادات، أفضل مدرب بنسبة النجاح، الجلسات أقل من الطاقة، الفواتير المتأخرة، تجديدات الشهادات، أو مقارنات شهرية.",
    };
  }

  switch (bestIntent.key) {
    case "top_revenue_contractor": return await answerTopRevenueContractor(scope, bestIntent);
    case "best_pass_rate_trainer": return await answerBestPassRateTrainer(scope, bestIntent);
    case "under_capacity_sessions": return await answerUnderCapacitySessions(scope, bestIntent);
    case "overdue_invoices": return await answerOverdueInvoices(scope, bestIntent);
    case "cert_renewals_next_month": return await answerCertRenewalsNextMonth(scope, bestIntent);
    case "compare_months": return await answerCompareMonths(scope, bestIntent, question);
    case "compare_trainers": return await answerCompareTrainers(scope, bestIntent, question);
    case "revenue_summary": return await answerRevenueSummary(scope, bestIntent);
    case "session_summary": return await answerSessionSummary(scope, bestIntent);
    default: {
      // Unreachable — all intents in INTENTS[] are handled above. This branch
      // exists as a safety net: if a new intent is added to INTENTS without a
      // matching case, it will fall through here with a clear message.
      return { kind: "text", answer: `Intent "${bestIntent?.key ?? "unknown"}" is registered but not yet implemented.` };
    }
  }
}

// ─── Intent handlers ───────────────────────────────────────────────────────

async function answerTopRevenueContractor(scope: AnalyticsScope, intent: Intent): Promise<NlQueryResult> {
  if (!scope.canSeeFinancial) {
    return { kind: "text", answer: "You don't have permission to view revenue data.", answerAr: "ليس لديك صلاحية لعرض بيانات الإيرادات." };
  }
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const rows = await db.invoice.groupBy({
    by: ["companyId"],
    where: { deletedAt: null, issueDate: { gte: yearStart } },
    _sum: { grandTotal: true },
    _count: true,
    orderBy: { _sum: { grandTotal: "desc" } },
    take: 10,
  });
  if (rows.length === 0) return { kind: "text", answer: "No revenue data found for this year." };
  const companies = await db.company.findMany({
    where: { id: { in: rows.map((r) => r.companyId) } },
    select: { id: true, name: true, refNumber: true },
  });
  const nameMap = new Map(companies.map((c) => [c.id, c]));
  const tableRows = rows.map((r, i) => ({
    rank: i + 1,
    contractor: nameMap.get(r.companyId)?.name ?? "—",
    ref: nameMap.get(r.companyId)?.refNumber ?? "—",
    revenue: r._sum.grandTotal ?? 0,
    invoiceCount: r._count,
  }));
  const chart: ChartDataset = {
    type: "bar",
    title: "Top 10 Contractors by Revenue (This Year)",
    titleAr: "أفضل 10 مقاولين بالإيرادات (هذا العام)",
    xLabel: "Contractor",
    yLabel: "Revenue (SAR)",
    unit: "currency",
    currency: "SAR",
    series: [{
      name: "Revenue",
      nameAr: "الإيرادات",
      color: CHART_COLORS[0],
      data: tableRows.map((r) => ({ label: r.contractor, value: Math.round(r.revenue) })),
    }],
  };
  return {
    kind: "chart",
    intent: intent.label,
    intentAr: intent.labelAr,
    chart,
    table: {
      columns: [
        { key: "rank", label: "Rank", labelAr: "الترتيب" },
        { key: "contractor", label: "Contractor", labelAr: "المقاول" },
        { key: "ref", label: "Ref", labelAr: "المرجع" },
        { key: "revenue", label: "Revenue (SAR)", labelAr: "الإيرادات (ريال)", format: "currency" },
        { key: "invoiceCount", label: "Invoices", labelAr: "الفواتير", format: "number" },
      ],
      rows: tableRows,
    },
    answer: `Top contractor this year: ${tableRows[0].contractor} with ${tableRows[0].revenue.toLocaleString()} SAR across ${tableRows[0].invoiceCount} invoice(s).`,
    answerAr: `أعلى مقاول هذا العام: ${tableRows[0].contractor} بإيرادات ${tableRows[0].revenue.toLocaleString()} ريال عبر ${tableRows[0].invoiceCount} فاتورة.`,
  };
}

async function answerBestPassRateTrainer(scope: AnalyticsScope, intent: Intent): Promise<NlQueryResult> {
  if (!scope.canSeeOperational) {
    return { kind: "text", answer: "You don't have permission to view trainer performance data." };
  }
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const testResults = await db.testResult.findMany({
    where: { deletedAt: null, attemptedAt: { gte: yearStart } },
    select: { passed: true, session: { select: { trainerId: true, trainer: { select: { id: true, nameEn: true, refNumber: true } } } } },
    take: 5000,
  });
  const byTrainer = new Map<string, { name: string; ref: string; passed: number; total: number }>();
  for (const r of testResults) {
    const tid = r.session.trainerId;
    if (!tid) continue;
    const e = byTrainer.get(tid) ?? { name: r.session.trainer?.nameEn ?? "—", ref: r.session.trainer?.refNumber ?? "—", passed: 0, total: 0 };
    e.total++;
    if (r.passed) e.passed++;
    byTrainer.set(tid, e);
  }
  const arr = Array.from(byTrainer.entries()).map(([_, e]) => ({
    trainer: e.name, ref: e.ref,
    passRate: e.total > 0 ? Math.round((e.passed / e.total) * 100) : 0,
    passed: e.passed, total: e.total,
  })).filter((x) => x.total >= 1).sort((a, b) => b.passRate - a.passRate);
  if (arr.length === 0) return { kind: "text", answer: "No trainer performance data found." };
  const chart: ChartDataset = {
    type: "bar",
    title: "Trainer Pass Rates (This Year)",
    titleAr: "نسب نجاح المدربين (هذا العام)",
    xLabel: "Trainer",
    yLabel: "Pass Rate (%)",
    unit: "percent",
    series: [{
      name: "Pass Rate",
      nameAr: "نسبة النجاح",
      color: CHART_COLORS[3],
      data: arr.slice(0, 10).map((a) => ({ label: a.trainer, value: a.passRate })),
    }],
  };
  return {
    kind: "chart",
    intent: intent.label,
    intentAr: intent.labelAr,
    chart,
    table: {
      columns: [
        { key: "trainer", label: "Trainer", labelAr: "المدرب" },
        { key: "ref", label: "Ref", labelAr: "المرجع" },
        { key: "passRate", label: "Pass Rate (%)", labelAr: "نسبة النجاح (%)", format: "percentage" },
        { key: "passed", label: "Passed", labelAr: "ناجح", format: "number" },
        { key: "total", label: "Total", labelAr: "الإجمالي", format: "number" },
      ],
      rows: arr,
    },
    answer: `Best trainer this year: ${arr[0].trainer} with a ${arr[0].passRate}% pass rate (${arr[0].passed}/${arr[0].total} exams).`,
    answerAr: `أفضل مدرب هذا العام: ${arr[0].trainer} بنسبة نجاح ${arr[0].passRate}% (${arr[0].passed}/${arr[0].total} امتحان).`,
  };
}

async function answerUnderCapacitySessions(scope: AnalyticsScope, intent: Intent): Promise<NlQueryResult> {
  const contractorScope = scope.role === "CONTRACTOR" && scope.companyId
    ? { enrollments: { some: { companyId: scope.companyId, deletedAt: null } } }
    : {};
  const upcoming = await db.trainingSession.findMany({
    where: { deletedAt: null, status: "SCHEDULED", startDate: { gte: new Date() }, ...contractorScope },
    include: { course: { select: { title: true } }, trainer: { select: { nameEn: true } } },
    take: 500,
  });
  const under = upcoming
    .map((s) => ({ ref: s.refNumber, title: s.course?.title ?? s.title, trainer: s.trainer?.nameEn ?? "—", capacity: s.capacity, enrolled: s.expectedTrainees, pct: s.capacity > 0 ? Math.round((s.expectedTrainees / s.capacity) * 100) : 0 }))
    .filter((s) => s.pct < 70)
    .sort((a, b) => a.pct - b.pct);
  if (under.length === 0) return { kind: "text", answer: "No under-capacity sessions found. All upcoming sessions are at 70%+ enrollment." };
  const chart: ChartDataset = {
    type: "bar",
    title: "Upcoming Sessions by Capacity Filled",
    titleAr: "الجلسات القادمة حسب نسبة الامتلاء",
    xLabel: "Session",
    yLabel: "Capacity Filled (%)",
    unit: "percent",
    series: [{
      name: "Capacity Filled",
      nameAr: "نسبة الامتلاء",
      color: CHART_COLORS[1],
      data: under.slice(0, 15).map((s) => ({ label: s.ref, value: s.pct })),
    }],
  };
  return {
    kind: "chart",
    intent: intent.label,
    intentAr: intent.labelAr,
    chart,
    table: {
      columns: [
        { key: "ref", label: "Session Ref", labelAr: "مرجع الجلسة" },
        { key: "title", label: "Course", labelAr: "الدورة" },
        { key: "trainer", label: "Trainer", labelAr: "المدرب" },
        { key: "enrolled", label: "Enrolled", labelAr: "المسجلون", format: "number" },
        { key: "capacity", label: "Capacity", labelAr: "الطاقة", format: "number" },
        { key: "pct", label: "Filled (%)", labelAr: "نسبة الامتلاء (%)", format: "percentage" },
      ],
      rows: under,
    },
    answer: `${under.length} upcoming session(s) are under 70% capacity. Lowest: ${under[0].ref} at ${under[0].pct}%.`,
    answerAr: `${under.length} جلسة قادمة أقل من 70% من الطاقة. الأقل: ${under[0].ref} عند ${under[0].pct}%.`,
  };
}

async function answerOverdueInvoices(scope: AnalyticsScope, intent: Intent): Promise<NlQueryResult> {
  if (!scope.canSeeFinancial) {
    return { kind: "text", answer: "You don't have permission to view invoice data." };
  }
  const now = new Date();
  const overdue = await db.invoice.findMany({
    where: { deletedAt: null, status: "OVERDUE", dueDate: { lt: now } },
    include: { company: { select: { name: true, refNumber: true } } },
    take: 500,
  });
  if (overdue.length === 0) return { kind: "text", answer: "No overdue invoices found. All invoices are paid or within their due date." };
  const rows = overdue.map((i) => {
    const daysLate = i.dueDate ? Math.round((now.getTime() - i.dueDate.getTime()) / 86400000) : 0;
    return {
      ref: i.refNumber,
      contractor: i.company.name,
      amount: i.outstandingBalance,
      currency: i.currency,
      dueDate: i.dueDate?.toISOString().slice(0, 10) ?? "—",
      daysLate,
    };
  }).sort((a, b) => b.daysLate - a.daysLate);
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return {
    kind: "table",
    intent: intent.label,
    intentAr: intent.labelAr,
    table: {
      columns: [
        { key: "ref", label: "Invoice Ref", labelAr: "مرجع الفاتورة" },
        { key: "contractor", label: "Contractor", labelAr: "المقاول" },
        { key: "amount", label: "Outstanding (SAR)", labelAr: "المستحق (ريال)", format: "currency" },
        { key: "dueDate", label: "Due Date", labelAr: "تاريخ الاستحقاق", format: "date" },
        { key: "daysLate", label: "Days Late", labelAr: "أيام التأخير", format: "number" },
      ],
      rows,
    },
    answer: `${rows.length} overdue invoice(s) totaling ${total.toLocaleString()} SAR. Oldest: ${rows[0].ref} (${rows[0].daysLate} days late).`,
    answerAr: `${rows.length} فاتورة متأخرة بإجمالي ${total.toLocaleString()} ريال. الأقدم: ${rows[0].ref} (${rows[0].daysLate} يوم تأخير).`,
    recommendations: [{
      id: "rec_overdue_from_nl",
      priority: "high",
      category: "financial",
      title: `Send reminders for ${rows.length} overdue invoice(s)`,
      titleAr: `أرسل تذكيرات لـ ${rows.length} فاتورة متأخرة`,
      description: `Total outstanding: ${total.toLocaleString()} SAR.`,
      descriptionAr: `إجمالي المستحق: ${total.toLocaleString()} ريال.`,
      actionType: "BULK_SEND_INVOICES",
      actionParams: { invoiceIds: overdue.map((i) => i.id) },
      impact: "high",
    }],
  };
}

async function answerCertRenewalsNextMonth(scope: AnalyticsScope, intent: Intent): Promise<NlQueryResult> {
  const now = new Date();
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0, 23, 59, 59, 999);
  const where = scope.role === "CONTRACTOR" && scope.companyId ? { companyId: scope.companyId } : {};
  const certs = await db.certificate.findMany({
    where: { deletedAt: null, status: "VALID", validUntil: { gte: nextMonth, lte: monthEnd }, ...where },
    include: { company: { select: { name: true, refNumber: true } }, course: { select: { title: true } } },
    take: 1000,
  });
  if (certs.length === 0) return { kind: "text", answer: "No certificates expiring next month." };
  const rows = certs.map((c) => ({
    ref: c.refNumber,
    trainee: c.traineeName,
    contractor: c.company?.name ?? "—",
    course: c.course.title,
    expires: c.validUntil.toISOString().slice(0, 10),
  }));
  return {
    kind: "table",
    intent: intent.label,
    intentAr: intent.labelAr,
    table: {
      columns: [
        { key: "ref", label: "Cert Ref", labelAr: "مرجع الشهادة" },
        { key: "trainee", label: "Trainee", labelAr: "المتدرب" },
        { key: "contractor", label: "Contractor", labelAr: "المقاول" },
        { key: "course", label: "Course", labelAr: "الدورة" },
        { key: "expires", label: "Expires", labelAr: "تاريخ الانتهاء", format: "date" },
      ],
      rows,
    },
    answer: `${rows.length} certificate(s) expiring next month.`,
    answerAr: `${rows.length} شهادة تنتهي الشهر القادم.`,
  };
}

async function answerCompareMonths(scope: AnalyticsScope, intent: Intent, question: string): Promise<NlQueryResult> {
  if (!scope.canSeeFinancial) {
    return { kind: "text", answer: "You don't have permission to view revenue data." };
  }
  // Extract two months from the question — default to last two months
  const monthPattern = /(\d{4}-\d{2}|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b)/gi;
  const matches = question.matchAll(monthPattern);
  const months = Array.from(matches).map((m) => m[1]);
  let month1Label: string, month2Label: string;
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  if (months.length >= 2) {
    month1Label = normalizeMonth(months[0], now.getFullYear());
    month2Label = normalizeMonth(months[1], now.getFullYear());
  } else {
    month1Label = fmt(twoMonthsAgo);
    month2Label = fmt(lastMonth);
  }

  // Compare revenue, sessions, certs across the two months
  const [m1Invoices, m2Invoices, m1Sessions, m2Sessions, m1Certs, m2Certs] = await Promise.all([
    db.invoice.aggregate({ where: { deletedAt: null, issueDate: { gte: new Date(`${month1Label}-01`), lt: new Date(`${month2Label}-01`) } }, _sum: { grandTotal: true }, _count: true }),
    db.invoice.aggregate({ where: { deletedAt: null, issueDate: { gte: new Date(`${month2Label}-01`), lt: nextMonthLabel(month2Label) } }, _sum: { grandTotal: true }, _count: true }),
    db.trainingSession.count({ where: { deletedAt: null, startDate: { gte: new Date(`${month1Label}-01`), lt: new Date(`${month2Label}-01`) } } }),
    db.trainingSession.count({ where: { deletedAt: null, startDate: { gte: new Date(`${month2Label}-01`), lt: nextMonthLabel(month2Label) } } }),
    db.certificate.count({ where: { deletedAt: null, issuedAt: { gte: new Date(`${month1Label}-01`), lt: new Date(`${month2Label}-01`) } } }),
    db.certificate.count({ where: { deletedAt: null, issuedAt: { gte: new Date(`${month2Label}-01`), lt: nextMonthLabel(month2Label) } } }),
  ]);
  const m1Revenue = m1Invoices._sum.grandTotal ?? 0;
  const m2Revenue = m2Invoices._sum.grandTotal ?? 0;
  const revenueDelta = m1Revenue === 0 ? null : Math.round(((m2Revenue - m1Revenue) / m1Revenue) * 100);
  const sessionDelta = m1Sessions === 0 ? null : Math.round(((m2Sessions - m1Sessions) / m1Sessions) * 100);
  const certDelta = m1Certs === 0 ? null : Math.round(((m2Certs - m1Certs) / m1Certs) * 100);
  const chart: ChartDataset = {
    type: "comparison",
    title: `Comparison: ${month1Label} vs ${month2Label}`,
    titleAr: `مقارنة: ${month1Label} مقابل ${month2Label}`,
    unit: "count",
    series: [
      { name: month1Label, color: CHART_COLORS[3], data: [
        { label: "Revenue (SAR)", value: Math.round(m1Revenue) },
        { label: "Sessions", value: m1Sessions },
        { label: "Certificates", value: m1Certs },
      ]},
      { name: month2Label, color: CHART_COLORS[0], data: [
        { label: "Revenue (SAR)", value: Math.round(m2Revenue) },
        { label: "Sessions", value: m2Sessions },
        { label: "Certificates", value: m2Certs },
      ]},
    ],
  };
  const rows = [
    { metric: "Revenue (SAR)", [month1Label]: Math.round(m1Revenue), [month2Label]: Math.round(m2Revenue), deltaPercent: revenueDelta },
    { metric: "Sessions", [month1Label]: m1Sessions, [month2Label]: m2Sessions, deltaPercent: sessionDelta },
    { metric: "Certificates", [month1Label]: m1Certs, [month2Label]: m2Certs, deltaPercent: certDelta },
  ];
  return {
    kind: "chart",
    intent: intent.label,
    intentAr: intent.labelAr,
    chart,
    table: {
      columns: [
        { key: "metric", label: "Metric", labelAr: "المقياس" },
        { key: month1Label, label: month1Label, labelAr: month1Label, format: "number" },
        { key: month2Label, label: month2Label, labelAr: month2Label, format: "number" },
        { key: "deltaPercent", label: "Δ %", labelAr: "التغير %", format: "percentage" },
      ],
      rows,
    },
    answer: `Revenue: ${m1Revenue.toLocaleString()} → ${m2Revenue.toLocaleString()} SAR (${revenueDelta === null ? "n/a" : `${revenueDelta > 0 ? "+" : ""}${revenueDelta}%`}). Sessions: ${m1Sessions} → ${m2Sessions}. Certificates: ${m1Certs} → ${m2Certs}.`,
    answerAr: `الإيرادات: ${m1Revenue.toLocaleString()} ← ${m2Revenue.toLocaleString()} ريال. الجلسات: ${m1Sessions} ← ${m2Sessions}. الشهادات: ${m1Certs} ← ${m2Certs}.`,
  };
}

function normalizeMonth(s: string, defaultYear: number): string {
  const lower = s.toLowerCase();
  const months: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  for (const [name, num] of Object.entries(months)) {
    if (lower.startsWith(name)) {
      return `${defaultYear}-${String(num).padStart(2, "0")}`;
    }
  }
  // Already YYYY-MM
  if (/^\d{4}-\d{2}$/.test(s)) return s;
  return `${defaultYear}-01`;
}

function nextMonthLabel(label: string): Date {
  const [y, m] = label.split("-").map(Number);
  const next = new Date(y, m, 1); // m is 1-indexed; new Date(y, m, 1) = first day of next month
  return next;
}

async function answerCompareTrainers(scope: AnalyticsScope, intent: Intent, question: string): Promise<NlQueryResult> {
  if (!scope.canSeeOperational) {
    return { kind: "text", answer: "You don't have permission to view trainer data." };
  }
  // Extract trainer names — heuristic: any capitalized word > 3 chars
  const words = question.split(/[\s,vs.]+/).filter((w) => w.length > 2 && /^[A-Z][a-z]+$/.test(w));
  const names = Array.from(new Set(words)).slice(0, 2);
  if (names.length < 2) {
    return { kind: "text", answer: "Please specify two trainer names to compare, e.g. 'Compare Ahmed with Ali'." };
  }
  const trainers = await db.trainer.findMany({
    where: { deletedAt: null, nameEn: { in: names } },
    select: { id: true, nameEn: true, refNumber: true },
  });
  if (trainers.length < 2) {
    return { kind: "text", answer: `Could not find both trainers (${names.join(", ")}). Please check the spelling.` };
  }
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const testResults = await db.testResult.findMany({
    where: { deletedAt: null, attemptedAt: { gte: yearStart }, session: { trainerId: { in: trainers.map((t) => t.id) } } },
    select: { passed: true, session: { select: { trainerId: true } } },
    take: 5000,
  });
  const byTrainer = new Map<string, { name: string; ref: string; passed: number; total: number; sessions: number }>();
  for (const t of trainers) {
    byTrainer.set(t.id, { name: t.nameEn, ref: t.refNumber, passed: 0, total: 0, sessions: 0 });
  }
  for (const r of testResults) {
    const tid = r.session.trainerId;
    if (!tid) continue;
    const e = byTrainer.get(tid);
    if (!e) continue;
    e.total++;
    if (r.passed) e.passed++;
  }
  // Per-trainer session counts
  for (const t of trainers) {
    const count = await db.trainingSession.count({ where: { deletedAt: null, startDate: { gte: yearStart }, trainerId: t.id } });
    byTrainer.get(t.id)!.sessions = count;
  }
  const arr = Array.from(byTrainer.values()).map((e) => ({
    trainer: e.name, ref: e.ref, sessions: e.sessions,
    passRate: e.total > 0 ? Math.round((e.passed / e.total) * 100) : 0,
    exams: e.total,
  }));
  const chart: ChartDataset = {
    type: "comparison",
    title: `Trainer Comparison: ${arr[0].trainer} vs ${arr[1].trainer}`,
    titleAr: `مقارنة المدربين: ${arr[0].trainer} مقابل ${arr[1].trainer}`,
    unit: "count",
    series: arr.map((a, i) => ({
      name: a.trainer,
      color: CHART_COLORS[i],
      data: [
        { label: "Sessions", value: a.sessions },
        { label: "Exams Graded", value: a.exams },
        { label: "Pass Rate (%)", value: a.passRate },
      ],
    })),
  };
  return {
    kind: "chart",
    intent: intent.label,
    intentAr: intent.labelAr,
    chart,
    table: {
      columns: [
        { key: "trainer", label: "Trainer", labelAr: "المدرب" },
        { key: "ref", label: "Ref", labelAr: "المرجع" },
        { key: "sessions", label: "Sessions", labelAr: "الجلسات", format: "number" },
        { key: "exams", label: "Exams", labelAr: "الامتحانات", format: "number" },
        { key: "passRate", label: "Pass Rate (%)", labelAr: "نسبة النجاح (%)", format: "percentage" },
      ],
      rows: arr,
    },
    answer: `${arr[0].trainer}: ${arr[0].sessions} sessions, ${arr[0].passRate}% pass rate. ${arr[1].trainer}: ${arr[1].sessions} sessions, ${arr[1].passRate}% pass rate.`,
    answerAr: `${arr[0].trainer}: ${arr[0].sessions} جلسات، ${arr[0].passRate}% نجاح. ${arr[1].trainer}: ${arr[1].sessions} جلسات، ${arr[1].passRate}% نجاح.`,
  };
}

async function answerRevenueSummary(scope: AnalyticsScope, intent: Intent): Promise<NlQueryResult> {
  if (!scope.canSeeFinancial) {
    return { kind: "text", intent: intent.label, intentAr: intent.labelAr, answer: "You don't have permission to view revenue data.", answerAr: "ليس لديك صلاحية لعرض بيانات الإيرادات." };
  }
  const range = rangeFromPreset("12m");
  const kpis = await computeKpis(scope, range);
  const revenueGroup = kpis.groups.find((g) => g.group === "revenue");
  if (!revenueGroup) return { kind: "text", intent: intent.label, intentAr: intent.labelAr, answer: "No revenue data available for your scope." };
  const cards: KpiCard[] = revenueGroup.cards;
  return {
    kind: "kpi",
    intent: intent.label,
    intentAr: intent.labelAr,
    kpis: cards,
    answer: cards.map((c) => `${c.label}: ${typeof c.value === "number" ? c.value.toLocaleString() : c.value}${c.deltaPercent !== undefined && c.deltaPercent !== null ? ` (${c.deltaPercent > 0 ? "+" : ""}${c.deltaPercent}%)` : ""}`).join(". "),
  };
}

async function answerSessionSummary(scope: AnalyticsScope, intent: Intent): Promise<NlQueryResult> {
  const range = rangeFromPreset("30d");
  const kpis = await computeKpis(scope, range);
  const trainingGroup = kpis.groups.find((g) => g.group === "training");
  if (!trainingGroup) return { kind: "text", answer: "No session data available." };
  const recs = await computeRecommendations(scope, range);
  return {
    kind: "kpi",
    intent: intent.label,
    intentAr: intent.labelAr,
    kpis: trainingGroup.cards,
    recommendations: recs.recommendations.filter((r) => r.category === "session" || r.category === "capacity").slice(0, 5),
    answer: trainingGroup.cards.map((c) => `${c.label}: ${typeof c.value === "number" ? c.value.toLocaleString() : c.value}`).join(". "),
  };
}
