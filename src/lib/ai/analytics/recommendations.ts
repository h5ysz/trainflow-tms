// GCCLAB AI Copilot — Phase 3 — Smart Recommendations Engine
// =====================================================================
// Pure functions that produce actionable recommendations based on live
// system state. Each recommendation may include an `actionType` that
// maps to a Phase 2 AI action the user can invoke.
import { db } from "@/lib/db";
import type { AnalyticsScope, TimeRange, Recommendation, RecommendationsResult } from "./types";
import { cached, buildKey, getTtl } from "./cache";

function sessionCompanyFilter(scope: AnalyticsScope): Record<string, unknown> {
  if (scope.role === "CONTRACTOR" && scope.companyId) {
    return { enrollments: { some: { companyId: scope.companyId, deletedAt: null } } };
  }
  return {};
}

export async function computeRecommendations(scope: AnalyticsScope, range: TimeRange): Promise<RecommendationsResult> {
  const key = buildKey(scope, "recommendations", range.from.toISOString().slice(0, 10));
  return cached(key, getTtl("RECOMMENDATIONS"), ["recommendations", "sessions", "invoices", "certificates", "trainers"], async () => {
    const recommendations: Recommendation[] = [];

    // Run all detection queries in parallel
    const [
      overloadedTrainers, mergeableSessions, increasingCourseDemand,
      contractorsNeedingRenewal, overdueInvoices, expiringCerts,
      underCapacitySessions, idleTrainers, lowAttendanceSessions,
    ] = await Promise.all([
      detectOverloadedTrainers(scope, range),
      detectMergeableSessions(scope),
      detectIncreasingCourseDemand(scope, range),
      detectContractorsNeedingRenewal(scope),
      scope.canSeeFinancial ? detectOverdueInvoices(scope) : Promise.resolve([]),
      detectExpiringCerts(scope),
      detectUnderCapacitySessions(scope),
      scope.canSeeOperational ? detectIdleTrainers(scope, range) : Promise.resolve([]),
      detectLowAttendanceSessions(scope, range),
    ]);

    recommendations.push(...overloadedTrainers, ...mergeableSessions, ...increasingCourseDemand, ...contractorsNeedingRenewal, ...overdueInvoices, ...expiringCerts, ...underCapacitySessions, ...idleTrainers, ...lowAttendanceSessions);

    // Sort by priority: critical > high > medium > low
    const priorityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
    recommendations.sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);

    return {
      generatedAt: new Date().toISOString(),
      recommendations: recommendations.slice(0, 50), // cap at 50 for UI sanity
    };
  });
}

// ─── Detection helpers ─────────────────────────────────────────────────────

async function detectOverloadedTrainers(scope: AnalyticsScope, _range: TimeRange): Promise<Recommendation[]> {
  if (!scope.canSeeOperational) return [];
  const upcoming = await db.trainingSession.findMany({
    where: { deletedAt: null, status: "SCHEDULED", startDate: { gte: new Date(), lte: new Date(Date.now() + 30 * 86400000) }, trainerId: { not: null } },
    include: { trainer: { select: { id: true, nameEn: true, refNumber: true } }, course: { select: { title: true } } },
    take: 500,
  });
  const byTrainer = new Map<string, { name: string; ref: string; sessions: { ref: string; title: string }[] }>();
  for (const s of upcoming) {
    if (!s.trainerId) continue;
    const e = byTrainer.get(s.trainerId) ?? { name: s.trainer?.nameEn ?? "—", ref: s.trainer?.refNumber ?? "—", sessions: [] };
    e.sessions.push({ ref: s.refNumber, title: s.course?.title ?? s.title });
    byTrainer.set(s.trainerId, e);
  }
  const out: Recommendation[] = [];
  for (const [tid, e] of byTrainer) {
    if (e.sessions.length >= 5) {
      out.push({
        id: `rec_trainer_overloaded_${tid}`,
        priority: e.sessions.length >= 10 ? "critical" : "high",
        category: "trainer",
        title: `Trainer ${e.name} is overloaded`,
        titleAr: `المدرب ${e.name} محمل بشكل زائد`,
        description: `${e.name} (${e.ref}) has ${e.sessions.length} upcoming sessions in the next 30 days. Consider reassigning some sessions to idle trainers.`,
        descriptionAr: `${e.name} (${e.ref}) لديه ${e.sessions.length} جلسات قادمة خلال 30 يوماً. فكر في إعادة تعيين بعض الجلسات لمدربين خاملين.`,
        actionType: "TRAINER_REPLACE",
        entityRefs: e.sessions.slice(0, 5).map((s) => ({ entity: "SESSION", refNumber: s.ref, description: s.title })),
        impact: e.sessions.length >= 10 ? "high" : "medium",
      });
    }
  }
  return out;
}

async function detectMergeableSessions(scope: AnalyticsScope): Promise<Recommendation[]> {
  if (!scope.canSeeOperational) return [];
  // Find SCHEDULED sessions of the same course with low enrollment (< 50% capacity)
  const upcoming = await db.trainingSession.findMany({
    where: { deletedAt: null, status: "SCHEDULED", startDate: { gte: new Date() }, ...sessionCompanyFilter(scope) },
    select: { id: true, refNumber: true, title: true, courseId: true, capacity: true, expectedTrainees: true, startDate: true, course: { select: { title: true } } },
    take: 500,
  });
  const byCourse = new Map<string, typeof upcoming>();
  for (const s of upcoming) {
    if (s.capacity > 0 && s.expectedTrainees < s.capacity * 0.5) {
      const arr = byCourse.get(s.courseId) ?? [];
      arr.push(s);
      byCourse.set(s.courseId, arr);
    }
  }
  const out: Recommendation[] = [];
  for (const [courseId, sessions] of byCourse) {
    if (sessions.length >= 2) {
      const totalTrainees = sessions.reduce((s, x) => s + x.expectedTrainees, 0);
      const totalCapacity = sessions.reduce((s, x) => s + x.capacity, 0);
      // Only recommend merge if combined fits in one session
      if (totalTrainees <= Math.max(...sessions.map((s) => s.capacity))) {
        out.push({
          id: `rec_merge_${courseId}`,
          priority: "medium",
          category: "session",
          title: `Merge ${sessions.length} under-filled sessions`,
          titleAr: `دمج ${sessions.length} جلسات غير ممتلئة`,
          description: `${sessions.length} sessions for "${sessions[0].course?.title ?? sessions[0].title}" have low enrollment (${totalTrainees}/${totalCapacity} total). Merging would free up trainer time and resources.`,
          descriptionAr: `${sessions.length} جلسات لـ "${sessions[0].course?.title ?? sessions[0].title}" بها تسجيل منخفض (${totalTrainees}/${totalCapacity} إجمالي). الدمج سيحر وقت المدرب والموارد.`,
          actionType: "SESSION_MERGE",
          actionParams: { sessionIds: sessions.map((s) => s.id) },
          entityRefs: sessions.slice(0, 5).map((s) => ({ entity: "SESSION", refNumber: s.refNumber, description: `${s.expectedTrainees}/${s.capacity} trainees` })),
          impact: "medium",
        });
      }
    }
  }
  return out;
}

async function detectIncreasingCourseDemand(scope: AnalyticsScope, range: TimeRange): Promise<Recommendation[]> {
  // Compare session count in the last 90 days vs the previous 90 days
  const now = Date.now();
  const recentFrom = new Date(now - 90 * 86400000);
  const priorFrom = new Date(now - 180 * 86400000);
  const priorTo = new Date(now - 90 * 86400000);

  const scFilter = sessionCompanyFilter(scope);
  const [recent, prior] = await Promise.all([
    db.trainingSession.groupBy({ by: ["courseId"], where: { deletedAt: null, startDate: { gte: recentFrom, lte: range.to }, ...scFilter }, _count: true }),
    db.trainingSession.groupBy({ by: ["courseId"], where: { deletedAt: null, startDate: { gte: priorFrom, lte: priorTo }, ...scFilter }, _count: true }),
  ]);
  const recentMap = new Map(recent.map((r) => [r.courseId, r._count]));
  const priorMap = new Map(prior.map((r) => [r.courseId, r._count]));

  const out: Recommendation[] = [];
  for (const [courseId, recentCount] of recentMap) {
    const priorCount = priorMap.get(courseId) ?? 0;
    if (priorCount > 0 && recentCount > priorCount * 1.5) {
      const course = await db.course.findUnique({ where: { id: courseId }, select: { id: true, title: true, refNumber: true } });
      if (course) {
        const growth = Math.round(((recentCount - priorCount) / priorCount) * 100);
        out.push({
          id: `rec_demand_${courseId}`,
          priority: "medium",
          category: "session",
          title: `Demand for "${course.title}" is increasing`,
          titleAr: `الطلب على "${course.title}" في تزايد`,
          description: `Sessions for "${course.title}" grew ${growth}% (${priorCount} → ${recentCount}) in the last 90 days vs the previous 90 days. Consider scheduling additional sessions proactively.`,
          descriptionAr: `نمت جلسات "${course.title}" بنسبة ${growth}% (${priorCount} ← ${recentCount}) في آخر 90 يوماً مقابل الـ 90 يوماً السابقة. فكر في جدولة جلسات إضافية استباقياً.`,
          actionType: "SESSION_CREATE",
          actionParams: { courseId: course.id },
          entityRefs: [{ entity: "COURSE", refNumber: course.refNumber, description: course.title }],
          impact: "medium",
        });
      }
    }
  }
  return out;
}

async function detectContractorsNeedingRenewal(scope: AnalyticsScope): Promise<Recommendation[]> {
  if (scope.role === "CONTRACTOR") return [];
  // Find contractors with certs expiring in next 60 days
  const now = new Date();
  const sixty = new Date(now.getTime() + 60 * 86400000);
  const expiring = await db.certificate.findMany({
    where: { deletedAt: null, status: "VALID", validUntil: { gte: now, lte: sixty } },
    select: { companyId: true, company: { select: { id: true, name: true, refNumber: true } } },
    take: 1000,
  });
  const byCompany = new Map<string, { name: string; ref: string; count: number }>();
  for (const c of expiring) {
    if (!c.companyId) continue;
    const e = byCompany.get(c.companyId) ?? { name: c.company?.name ?? "—", ref: c.company?.refNumber ?? "—", count: 0 };
    e.count++;
    byCompany.set(c.companyId, e);
  }
  const out: Recommendation[] = [];
  for (const [companyId, e] of byCompany) {
    if (e.count >= 1) {
      out.push({
        id: `rec_renewal_${companyId}`,
        priority: e.count >= 5 ? "high" : "medium",
        category: "contractor",
        title: `${e.name} has ${e.count} certificate(s) expiring in 60 days`,
        titleAr: `${e.name} لديه ${e.count} شهادة تنتهي خلال 60 يوماً`,
        description: `Schedule renewal training for ${e.name}'s workers before their certificates expire.`,
        descriptionAr: `جدول تدريب التجديد لعمّال ${e.name} قبل انتهاء شهاداتهم.`,
        actionType: "NOTIFICATION_SEND_REMINDER",
        actionParams: { reminderType: "CERTIFICATE_EXPIRY" },
        entityRefs: [{ entity: "COMPANY", refNumber: e.ref, description: e.name }],
        impact: "medium",
      });
    }
  }
  return out.slice(0, 20); // cap
}

async function detectOverdueInvoices(_scope: AnalyticsScope): Promise<Recommendation[]> {
  const now = new Date();
  const overdue = await db.invoice.findMany({
    where: { deletedAt: null, status: "OVERDUE", dueDate: { lt: now } },
    select: { id: true, refNumber: true, grandTotal: true, currency: true, companyId: true, company: { select: { name: true } } },
    take: 200,
  });
  if (overdue.length === 0) return [];
  const totalOutstanding = overdue.reduce((s, i) => s + i.grandTotal, 0);
  return [{
    id: "rec_overdue_invoices",
    priority: overdue.length >= 5 ? "critical" : "high",
    category: "financial",
    title: `${overdue.length} overdue invoice(s) totaling ${totalOutstanding.toFixed(2)} SAR`,
    titleAr: `${overdue.length} فاتورة متأخرة بإجمالي ${totalOutstanding.toFixed(2)} ريال`,
    description: `${overdue.length} invoices are past their due date. Send payment reminders to the affected contractors.`,
    descriptionAr: `${overdue.length} فواتير تجاوزت تاريخ الاستحقاق. أرسل تذكيرات الدفع للمقاولين المتأثرين.`,
    actionType: "BULK_SEND_INVOICES",
    actionParams: { invoiceIds: overdue.map((i) => i.id) },
    entityRefs: overdue.slice(0, 10).map((i) => ({ entity: "INVOICE", refNumber: i.refNumber, description: `${i.company.name}: ${i.grandTotal.toFixed(2)} ${i.currency}` })),
    impact: "high",
  }];
}

async function detectExpiringCerts(scope: AnalyticsScope): Promise<Recommendation[]> {
  const now = new Date();
  const week = new Date(now.getTime() + 7 * 86400000);
  const where = scope.role === "CONTRACTOR" && scope.companyId ? { companyId: scope.companyId } : {};
  const expiringSoon = await db.certificate.count({
    where: { deletedAt: null, status: "VALID", validUntil: { gte: now, lte: week }, ...where },
  });
  if (expiringSoon === 0) return [];
  return [{
    id: "rec_expiring_certs_week",
    priority: expiringSoon >= 10 ? "critical" : "high",
    category: "certificate",
    title: `${expiringSoon} certificate(s) expire next week`,
    titleAr: `${expiringSoon} شهادة تنتهي الأسبوع القادم`,
    description: `${expiringSoon} certificates will expire in the next 7 days. Schedule renewal training sessions immediately.`,
    descriptionAr: `${expiringSoon} شهادة ستنتهي خلال 7 أيام. جدول جلسات تدريب التجديد فوراً.`,
    actionType: "NOTIFICATION_SEND_REMINDER",
    actionParams: { reminderType: "CERTIFICATE_EXPIRY" },
    impact: "high",
  }];
}

async function detectUnderCapacitySessions(scope: AnalyticsScope): Promise<Recommendation[]> {
  const upcoming = await db.trainingSession.findMany({
    where: { deletedAt: null, status: "SCHEDULED", startDate: { gte: new Date(), lte: new Date(Date.now() + 14 * 86400000) }, ...sessionCompanyFilter(scope) },
    select: { id: true, refNumber: true, title: true, capacity: true, expectedTrainees: true, course: { select: { title: true } } },
    take: 200,
  });
  const out: Recommendation[] = [];
  for (const s of upcoming) {
    if (s.capacity > 0 && s.expectedTrainees < s.capacity * 0.3) {
      out.push({
        id: `rec_under_capacity_${s.id}`,
        priority: "low",
        category: "capacity",
        title: `Session ${s.refNumber} is at ${Math.round((s.expectedTrainees / s.capacity) * 100)}% capacity`,
        titleAr: `الجلسة ${s.refNumber} عند ${Math.round((s.expectedTrainees / s.capacity) * 100)}% من الطاقة`,
        description: `"${s.course?.title ?? s.title}" (${s.refNumber}) has only ${s.expectedTrainees}/${s.capacity} trainees enrolled. Consider promoting the session or rescheduling.`,
        descriptionAr: `"${s.course?.title ?? s.title}" (${s.refNumber}) بها ${s.expectedTrainees}/${s.capacity} متدرب فقط. فكر في الترويج للجلسة أو إعادة جدولتها.`,
        entityRefs: [{ entity: "SESSION", refNumber: s.refNumber, description: s.course?.title ?? s.title }],
        impact: "low",
      });
    }
  }
  return out.slice(0, 10);
}

async function detectIdleTrainers(_scope: AnalyticsScope, _range: TimeRange): Promise<Recommendation[]> {
  const sixty = new Date(Date.now() + 30 * 86400000);
  // Find trainers with no upcoming sessions in the next 30 days
  const busyTrainers = await db.trainingSession.findMany({
    where: { deletedAt: null, status: "SCHEDULED", startDate: { gte: new Date(), lte: sixty }, trainerId: { not: null } },
    select: { trainerId: true },
    distinct: ["trainerId"],
  });
  const busyIds = new Set(busyTrainers.map((t) => t.trainerId));
  const activeTrainers = await db.trainer.findMany({
    where: { deletedAt: null, status: "ACTIVE" },
    select: { id: true, nameEn: true, refNumber: true },
  });
  const idle = activeTrainers.filter((t) => !busyIds.has(t.id));
  if (idle.length === 0) return [];
  return [{
    id: "rec_idle_trainers",
    priority: "low",
    category: "trainer",
    title: `${idle.length} trainer(s) have no upcoming sessions`,
    titleAr: `${idle.length} مدرب بدون جلسات قادمة`,
    description: `${idle.length} active trainer(s) have no sessions scheduled in the next 30 days. Consider assigning them to under-staffed sessions.`,
    descriptionAr: `${idle.length} مدرب نشط بدون جلسات في الـ 30 يوماً القادمة. فكر في تعيينهم لجلسات تعاني نقص المدربين.`,
    entityRefs: idle.slice(0, 10).map((t) => ({ entity: "TRAINER", refNumber: t.refNumber, description: t.nameEn })),
    impact: "low",
  }];
}

async function detectLowAttendanceSessions(scope: AnalyticsScope, range: TimeRange): Promise<Recommendation[]> {
  // Sessions with attendance < 50%
  const sessions = await db.trainingSession.findMany({
    where: { deletedAt: null, status: "COMPLETED", startDate: { gte: range.from, lte: range.to }, ...sessionCompanyFilter(scope) },
    select: { id: true, refNumber: true, title: true, expectedTrainees: true, actualTrainees: true, course: { select: { title: true } } },
    take: 200,
  });
  const out: Recommendation[] = [];
  for (const s of sessions) {
    if (s.expectedTrainees > 0 && s.actualTrainees < s.expectedTrainees * 0.5) {
      out.push({
        id: `rec_low_attendance_${s.id}`,
        priority: "medium",
        category: "session",
        title: `Session ${s.refNumber} had low attendance (${s.actualTrainees}/${s.expectedTrainees})`,
        titleAr: `الجلسة ${s.refNumber} كان الحضور منخفضاً (${s.actualTrainees}/${s.expectedTrainees})`,
        description: `"${s.course?.title ?? s.title}" had only ${s.actualTrainees} of ${s.expectedTrainees} expected trainees attend. Investigate root cause.`,
        descriptionAr: `"${s.course?.title ?? s.title}" حضرها ${s.actualTrainees} فقط من ${s.expectedTrainees} متدرب متوقع. حقق في السبب الجذري.`,
        entityRefs: [{ entity: "SESSION", refNumber: s.refNumber, description: s.course?.title ?? s.title }],
        impact: "medium",
      });
    }
  }
  return out.slice(0, 10);
}
