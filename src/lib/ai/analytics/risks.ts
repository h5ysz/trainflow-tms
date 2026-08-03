// GCCLAB AI Copilot — Phase 3 — Risk Detection Engine
// =====================================================================
// Pure functions that detect operational + financial risks. Each risk
// includes severity, category, and an optional suggested AI action.
import { db } from "@/lib/db";
import type { AnalyticsScope, Risk, RisksResult } from "./types";
import { cached, buildKey, getTtl } from "./cache";

function sessionCompanyFilter(scope: AnalyticsScope): Record<string, unknown> {
  if (scope.role === "CONTRACTOR" && scope.companyId) {
    return { enrollments: { some: { companyId: scope.companyId, deletedAt: null } } };
  }
  return {};
}

export async function computeRisks(scope: AnalyticsScope): Promise<RisksResult> {
  const key = buildKey(scope, "risks");
  return cached(key, getTtl("RISKS"), ["risks", "sessions", "invoices", "certificates"], async () => {
    const [
      trainerConflicts, scheduleConflicts, certExpiryRisks,
      lateInvoiceRisks, repeatedFailures, inactiveContractors,
      lowAttendanceRisks, financialRisks, duplicateTrainees, capacityIssues,
    ] = await Promise.all([
      detectTrainerConflicts(scope),
      detectScheduleConflicts(scope),
      detectCertExpiryRisks(scope),
      scope.canSeeFinancial ? detectLateInvoiceRisks(scope) : Promise.resolve([]),
      detectRepeatedFailures(scope),
      scope.role !== "CONTRACTOR" ? detectInactiveContractors(scope) : Promise.resolve([]),
      detectLowAttendanceRisks(scope),
      scope.canSeeFinancial ? detectFinancialRisks(scope) : Promise.resolve([]),
      detectDuplicateTrainees(scope),
      detectCapacityIssues(scope),
    ]);

    const risks: Risk[] = [
      ...trainerConflicts, ...scheduleConflicts, ...certExpiryRisks,
      ...lateInvoiceRisks, ...repeatedFailures, ...inactiveContractors,
      ...lowAttendanceRisks, ...financialRisks, ...duplicateTrainees, ...capacityIssues,
    ];

    const severityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    risks.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

    return {
      generatedAt: new Date().toISOString(),
      risks: risks.slice(0, 100), // cap
    };
  });
}

// ─── Detection helpers ─────────────────────────────────────────────────────

async function detectTrainerConflicts(scope: AnalyticsScope): Promise<Risk[]> {
  if (!scope.canSeeOperational) return [];
  const sessions = await db.trainingSession.findMany({
    where: { deletedAt: null, status: { in: ["SCHEDULED", "IN_PROGRESS"] }, trainerId: { not: null }, ...sessionCompanyFilter(scope) },
    include: { trainer: { select: { refNumber: true, fullName: true } } },
    take: 1000,
  });
  const byTrainer = new Map<string, typeof sessions>();
  for (const s of sessions) {
    if (!s.trainerId) continue;
    const arr = byTrainer.get(s.trainerId) ?? [];
    arr.push(s);
    byTrainer.set(s.trainerId, arr);
  }
  const out: Risk[] = [];
  for (const [tid, arr] of byTrainer) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (arr[i].startDate < arr[j].endDate && arr[j].startDate < arr[i].endDate) {
          out.push({
            id: `risk_trainer_conflict_${tid}_${i}_${j}`,
            severity: "critical",
            category: "trainer_conflict",
            title: `Trainer ${arr[i].trainer?.fullName} is double-booked`,
            titleAr: `المدرب ${arr[i].trainer?.fullName} محجوز مرتين`,
            description: `${arr[i].trainer?.fullName} (${arr[i].trainer?.refNumber}) has overlapping sessions: ${arr[i].refNumber} and ${arr[j].refNumber}.`,
            descriptionAr: `${arr[i].trainer?.fullName} (${arr[i].trainer?.refNumber}) لديه جلسات متداخلة: ${arr[i].refNumber} و ${arr[j].refNumber}.`,
            entityRefs: [
              { entity: "TRAINER", refNumber: arr[i].trainer?.refNumber ?? "—", description: arr[i].trainer?.fullName ?? "" },
              { entity: "SESSION", refNumber: arr[i].refNumber, description: arr[i].title },
              { entity: "SESSION", refNumber: arr[j].refNumber, description: arr[j].title },
            ],
            suggestedAction: "TRAINER_REPLACE",
          });
        }
      }
    }
  }
  return out.slice(0, 20);
}

async function detectScheduleConflicts(scope: AnalyticsScope): Promise<Risk[]> {
  // Sessions scheduled at the same venue with overlapping times
  if (!scope.canSeeOperational) return [];
  const sessions = await db.trainingSession.findMany({
    where: { deletedAt: null, status: "SCHEDULED", venue: { not: null }, startDate: { gte: new Date() }, ...sessionCompanyFilter(scope) },
    select: { id: true, refNumber: true, title: true, venue: true, startDate: true, endDate: true },
    take: 500,
  });
  const byVenue = new Map<string, typeof sessions>();
  for (const s of sessions) {
    if (!s.venue) continue;
    const arr = byVenue.get(s.venue) ?? [];
    arr.push(s);
    byVenue.set(s.venue, arr);
  }
  const out: Risk[] = [];
  for (const [venue, arr] of byVenue) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        if (arr[i].startDate < arr[j].endDate && arr[j].startDate < arr[i].endDate) {
          out.push({
            id: `risk_venue_conflict_${arr[i].id}_${arr[j].id}`,
            severity: "high",
            category: "schedule_conflict",
            title: `Venue "${venue}" is double-booked`,
            titleAr: `القاعة "${venue}" محجوزة مرتين`,
            description: `Sessions ${arr[i].refNumber} and ${arr[j].refNumber} overlap at venue "${venue}".`,
            descriptionAr: `الجلستان ${arr[i].refNumber} و ${arr[j].refNumber} متداخلتان في القاعة "${venue}".`,
            entityRefs: [
              { entity: "SESSION", refNumber: arr[i].refNumber, description: arr[i].title },
              { entity: "SESSION", refNumber: arr[j].refNumber, description: arr[j].title },
            ],
            suggestedAction: "SESSION_CHANGE_LOCATION",
          });
        }
      }
    }
  }
  return out.slice(0, 20);
}

async function detectCertExpiryRisks(scope: AnalyticsScope): Promise<Risk[]> {
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86400000);
  const month = new Date(now.getTime() + 30 * 86400000);
  const where = scope.role === "CONTRACTOR" && scope.companyId ? { companyId: scope.companyId } : {};
  const [critical, high, medium] = await Promise.all([
    db.certificate.count({ where: { deletedAt: null, status: "VALID", validUntil: { gte: now, lte: week }, ...where } }),
    db.certificate.count({ where: { deletedAt: null, status: "VALID", validUntil: { gt: week, lte: month }, ...where } }),
    db.certificate.count({ where: { deletedAt: null, status: "EXPIRED", ...where } }),
  ]);
  const out: Risk[] = [];
  if (critical > 0) {
    out.push({
      id: "risk_cert_expiry_critical",
      severity: "critical",
      category: "cert_expiry",
      title: `${critical} certificate(s) expire within 7 days`,
      titleAr: `${critical} شهادة تنتهي خلال 7 أيام`,
      description: `${critical} certificates will expire this week. Immediate action required to schedule renewal training.`,
      descriptionAr: `${critical} شهادة ستنتهي هذا الأسبوع. مطلوب إجراء فوري لجدولة تدريب التجديد.`,
      count: critical,
      suggestedAction: "NOTIFICATION_SEND_REMINDER",
    });
  }
  if (high > 0) {
    out.push({
      id: "risk_cert_expiry_high",
      severity: "high",
      category: "cert_expiry",
      title: `${high} certificate(s) expire within 30 days`,
      titleAr: `${high} شهادة تنتهي خلال 30 يوماً`,
      description: `${high} certificates will expire in the next 30 days. Schedule renewal training sessions.`,
      descriptionAr: `${high} شهادة ستنتهي خلال 30 يوماً. جدول جلسات تدريب التجديد.`,
      count: high,
      suggestedAction: "NOTIFICATION_SEND_REMINDER",
    });
  }
  if (medium > 0) {
    out.push({
      id: "risk_cert_expired",
      severity: "medium",
      category: "cert_expiry",
      title: `${medium} certificate(s) already expired`,
      titleAr: `${medium} شهادة منتهية بالفعل`,
      description: `${medium} certificates have expired and are no longer valid. Affected workers cannot operate until renewed.`,
      descriptionAr: `${medium} شهادة انتهت ولم تعد صالحة. لا يمكن للعمّال المتأثرين العمل حتى التجديد.`,
      count: medium,
    });
  }
  return out;
}

async function detectLateInvoiceRisks(_scope: AnalyticsScope): Promise<Risk[]> {
  const now = new Date();
  const overdue = await db.invoice.findMany({
    where: { deletedAt: null, status: "OVERDUE", dueDate: { lt: now } },
    select: { id: true, refNumber: true, grandTotal: true, currency: true, dueDate: true, company: { select: { name: true } } },
    take: 500,
  });
  if (overdue.length === 0) return [];
  const total = overdue.reduce((s, i) => s + i.grandTotal, 0);
  const veryLate = overdue.filter((i) => {
    const daysLate = (now.getTime() - (i.dueDate?.getTime() ?? now.getTime())) / 86400000;
    return daysLate > 30;
  });
  return [{
    id: "risk_late_invoices",
    severity: veryLate.length > 0 ? "critical" : "high",
    category: "late_invoice",
    title: `${overdue.length} overdue invoice(s) totaling ${total.toFixed(2)} SAR`,
    titleAr: `${overdue.length} فاتورة متأخرة بإجمالي ${total.toFixed(2)} ريال`,
    description: `${overdue.length} invoices are past due (${veryLate.length} more than 30 days late). Total outstanding: ${total.toFixed(2)} SAR.`,
    descriptionAr: `${overdue.length} فواتير متأخرة (${veryLate.length} أكثر من 30 يوماً). إجمالي المستحق: ${total.toFixed(2)} ريال.`,
    count: overdue.length,
    entityRefs: overdue.slice(0, 10).map((i) => ({ entity: "INVOICE", refNumber: i.refNumber, description: `${i.company.name}: ${i.grandTotal.toFixed(2)} ${i.currency}` })),
    suggestedAction: "BULK_SEND_INVOICES",
  }];
}

async function detectRepeatedFailures(scope: AnalyticsScope): Promise<Risk[]> {
  // Trainees who failed 2+ times in the last 90 days
  const ninety = new Date(Date.now() - 90 * 86400000);
  const where = scope.role === "CONTRACTOR" && scope.companyId ? { companyId: scope.companyId } : {};
  const testResults = await db.testResult.findMany({
    where: { deletedAt: null, passed: false, attemptedAt: { gte: ninety }, ...where },
    select: { traineeName: true, traineeIdNational: true },
    take: 2000,
  });
  const byTrainee = new Map<string, number>();
  for (const r of testResults) {
    const key = r.traineeIdNational ?? r.traineeName;
    byTrainee.set(key, (byTrainee.get(key) ?? 0) + 1);
  }
  const repeated = Array.from(byTrainee.entries()).filter(([_, c]) => c >= 2);
  if (repeated.length === 0) return [];
  return [{
    id: "risk_repeated_failures",
    severity: "medium",
    category: "repeated_failure",
    title: `${repeated.length} trainee(s) failed 2+ times in the last 90 days`,
    titleAr: `${repeated.length} متدرب رسب مرتين أو أكثر في آخر 90 يوماً`,
    description: `${repeated.length} trainees have failed their exams 2 or more times. Consider remedial training or re-exam scheduling.`,
    descriptionAr: `${repeated.length} متدرب رسب في الامتحان مرتين أو أكثر. فكر في تدريب علاجي أو جدولة إعادة امتحان.`,
    count: repeated.length,
    suggestedAction: "TRAINEE_REGISTER_RE_EXAM",
  }];
}

async function detectInactiveContractors(_scope: AnalyticsScope): Promise<Risk[]> {
  // Contractors with no enrollments in the last 90 days
  const ninety = new Date(Date.now() - 90 * 86400000);
  const activeCompanyIds = await db.sessionEnrollment.findMany({
    where: { deletedAt: null, enrollmentDate: { gte: ninety }, enrollmentStatus: { not: "CANCELLED" } },
    select: { companyId: true },
    distinct: ["companyId"],
  });
  const activeSet = new Set(activeCompanyIds.map((e) => e.companyId));
  const allCompanies = await db.company.findMany({
    where: { deletedAt: null, status: "ACTIVE" },
    select: { id: true, name: true, refNumber: true },
  });
  const inactive = allCompanies.filter((c) => !activeSet.has(c.id));
  if (inactive.length === 0) return [];
  return [{
    id: "risk_inactive_contractors",
    severity: "low",
    category: "inactive_contractor",
    title: `${inactive.length} inactive contractor(s)`,
    titleAr: `${inactive.length} مقاول خامل`,
    description: `${inactive.length} contractors have had no training activity in the last 90 days. Consider outreach to re-engage them.`,
    descriptionAr: `${inactive.length} مقاول لم يكن لديهم نشاط تدريبي في آخر 90 يوماً. فكر في التواصل لإعادة إشراكهم.`,
    count: inactive.length,
    entityRefs: inactive.slice(0, 10).map((c) => ({ entity: "COMPANY", refNumber: c.refNumber, description: c.name })),
  }];
}

async function detectLowAttendanceRisks(scope: AnalyticsScope): Promise<Risk[]> {
  const thirty = new Date(Date.now() - 30 * 86400000);
  const scFilter = sessionCompanyFilter(scope);
  const sessions = await db.trainingSession.findMany({
    where: { deletedAt: null, status: "COMPLETED", startDate: { gte: thirty }, ...scFilter },
    select: { id: true, refNumber: true, expectedTrainees: true, actualTrainees: true },
    take: 500,
  });
  const lowAttendance = sessions.filter((s) => s.expectedTrainees > 0 && s.actualTrainees < s.expectedTrainees * 0.5);
  if (lowAttendance.length === 0) return [];
  return [{
    id: "risk_low_attendance",
    severity: "medium",
    category: "low_attendance",
    title: `${lowAttendance.length} session(s) with <50% attendance in the last 30 days`,
    titleAr: `${lowAttendance.length} جلسة بحضور <50% في آخر 30 يوماً`,
    description: `${lowAttendance.length} completed sessions had attendance below 50% of expected. Investigate root causes.`,
    descriptionAr: `${lowAttendance.length} جلسات مكتملة كان الحضور فيها أقل من 50% من المتوقع. حقق في الأسباب الجذرية.`,
    count: lowAttendance.length,
    entityRefs: lowAttendance.slice(0, 10).map((s) => ({ entity: "SESSION", refNumber: s.refNumber, description: `${s.actualTrainees}/${s.expectedTrainees} attended` })),
  }];
}

async function detectFinancialRisks(_scope: AnalyticsScope): Promise<Risk[]> {
  // High outstanding balance per contractor
  const byCompany = await db.invoice.groupBy({
    by: ["companyId"],
    where: { deletedAt: null, status: { in: ["PENDING_PAYMENT", "PARTIALLY_PAID", "OVERDUE"] } },
    _sum: { outstandingBalance: true },
    having: { outstandingBalance: { _sum: { gt: 50000 } } },
    orderBy: { _sum: { outstandingBalance: "desc" } },
    take: 20,
  });
  if (byCompany.length === 0) return [];
  const companies = await db.company.findMany({
    where: { id: { in: byCompany.map((r) => r.companyId) } },
    select: { id: true, name: true, refNumber: true },
  });
  const nameMap = new Map(companies.map((c) => [c.id, c]));
  return byCompany.map((r) => ({
    id: `risk_financial_${r.companyId}`,
    severity: (r._sum.outstandingBalance ?? 0) > 100000 ? "high" : "medium",
    category: "financial",
    title: `${nameMap.get(r.companyId)?.name ?? "—"} has high outstanding balance`,
    titleAr: `${nameMap.get(r.companyId)?.name ?? "—"} لديه رصيد مستحق مرتفع`,
    description: `Outstanding balance: ${(r._sum.outstandingBalance ?? 0).toFixed(2)} SAR. Consider pausing new services until payment is received.`,
    descriptionAr: `الرصيد المستحق: ${(r._sum.outstandingBalance ?? 0).toFixed(2)} ريال. فكر في إيقاف الخدمات الجديدة حتى يستلم الدفع.`,
    entityRefs: [{ entity: "COMPANY", refNumber: nameMap.get(r.companyId)?.refNumber ?? "—", description: nameMap.get(r.companyId)?.name ?? "—" }],
    suggestedAction: "NOTIFICATION_SEND_REMINDER",
  }));
}

async function detectDuplicateTrainees(scope: AnalyticsScope): Promise<Risk[]> {
  // Trainees with the same nationalId across companies (not necessarily a bug, but worth flagging)
  if (scope.role === "CONTRACTOR") return []; // contractors can't see other companies
  const duplicates = await db.trainee.groupBy({
    by: ["nationalId"],
    where: { deletedAt: null },
    _count: { id: true },
    having: { nationalId: { _count: { gt: 1 } } },
    orderBy: { _count: { id: "desc" } },
    take: 50,
  });
  if (duplicates.length === 0) return [];
  return [{
    id: "risk_duplicate_trainees",
    severity: "low",
    category: "duplicate_trainee",
    title: `${duplicates.length} national ID(s) appear across multiple companies`,
    titleAr: `${duplicates.length} هوية وطنية تظهر عبر عدة شركات`,
    description: `${duplicates.length} national IDs are registered under multiple companies. Verify this is intentional (re-hire) and not a data entry error.`,
    descriptionAr: `${duplicates.length} هوية وطنية مسجلة تحت عدة شركات. تحقق أن هذا مقصود (إعادة توظيف) وليس خطأ إدخال.`,
    count: duplicates.length,
  }];
}

async function detectCapacityIssues(scope: AnalyticsScope): Promise<Risk[]> {
  const scFilter = sessionCompanyFilter(scope);
  const upcoming = await db.trainingSession.findMany({
    where: { deletedAt: null, status: "SCHEDULED", startDate: { gte: new Date() }, ...scFilter },
    select: { id: true, refNumber: true, capacity: true, expectedTrainees: true },
    take: 500,
  });
  const over = upcoming.filter((s) => s.expectedTrainees > s.capacity);
  if (over.length === 0) return [];
  return [{
    id: "risk_capacity_over",
    severity: "high",
    category: "capacity",
    title: `${over.length} upcoming session(s) are over capacity`,
    titleAr: `${over.length} جلسة قادمة تتجاوز الطاقة`,
    description: `${over.length} sessions have more enrolled trainees than capacity allows. Split or reschedule immediately.`,
    descriptionAr: `${over.length} جلسات بها متدربون أكثر من الطاقة المسموحة. قسم أو أعد الجدولة فوراً.`,
    count: over.length,
    entityRefs: over.slice(0, 10).map((s) => ({ entity: "SESSION", refNumber: s.refNumber, description: `${s.expectedTrainees}/${s.capacity} trainees` })),
    suggestedAction: "SESSION_SPLIT",
  }];
}
