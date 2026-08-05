// /api/compliance/executive-dashboard — Executive Compliance Dashboard data
// =====================================================================
// Sprint 6: Executive dashboard for GCCLAB administrators.
// Returns all KPIs + chart data in a single API call for <2s load.
// Filters: companyId, courseId, dateFrom, dateTo
// Permissions: SUPER_ADMIN, COORDINATOR, TRAINER
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok } from "@/lib/auth/api";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const GET = withErrorEnvelope(async function GET(req: Request) {
  await requireRole("SUPER_ADMIN", "COORDINATOR", "TRAINER");

  const url = new URL(req.url);
  const companyId = url.searchParams.get("companyId");
  const courseId = url.searchParams.get("courseId");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  const certWhere: Record<string, unknown> = { deletedAt: null };
  if (companyId) certWhere.companyId = companyId;
  if (courseId) certWhere.courseId = courseId;
  if (dateFrom || dateTo) {
    certWhere.issuedAt = {};
    if (dateFrom) (certWhere.issuedAt as Record<string, unknown>).gte = new Date(dateFrom);
    if (dateTo) (certWhere.issuedAt as Record<string, unknown>).lte = new Date(dateTo);
  }

  const companyWhere: Record<string, unknown> = { deletedAt: null };
  const workerWhere: Record<string, unknown> = { deletedAt: null };
  if (companyId) workerWhere.companyId = companyId;

  const now = new Date();
  const inDays = (n: number) => new Date(now.getTime() + n * MS_PER_DAY);

  const [
    totalCompanies, totalWorkers, activeWorkers, totalCertificates,
    activeCertificates, expiredCertificates, expiring7, expiring30,
    expiring60, expiring90, revokedCertificates, pendingApprovalCerts,
  ] = await Promise.all([
    db.company.count({ where: companyWhere }),
    db.workerPassport.count({ where: workerWhere }),
    db.workerPassport.count({
      where: { ...workerWhere, certificates: { some: { deletedAt: null, status: { in: ["ISSUED", "VALID"] }, validUntil: { gte: now } } } },
    }),
    db.certificate.count({ where: certWhere }),
    db.certificate.count({ where: { ...certWhere, status: { in: ["ISSUED", "VALID"] }, validUntil: { gte: now } } }),
    db.certificate.count({ where: { ...certWhere, status: { not: "REVOKED" }, validUntil: { lt: now } } }),
    db.certificate.count({ where: { ...certWhere, status: { in: ["ISSUED", "VALID"] }, validUntil: { gte: now, lte: inDays(7) } } }),
    db.certificate.count({ where: { ...certWhere, status: { in: ["ISSUED", "VALID"] }, validUntil: { gte: now, lte: inDays(30) } } }),
    db.certificate.count({ where: { ...certWhere, status: { in: ["ISSUED", "VALID"] }, validUntil: { gte: now, lte: inDays(60) } } }),
    db.certificate.count({ where: { ...certWhere, status: { in: ["ISSUED", "VALID"] }, validUntil: { gte: now, lte: inDays(90) } } }),
    db.certificate.count({ where: { ...certWhere, status: "REVOKED" } }),
    db.certificate.count({ where: { ...certWhere, status: "PENDING_APPROVAL" } }),
  ]);

  const complianceRate = activeCertificates + expiredCertificates > 0
    ? Math.round((activeCertificates / (activeCertificates + expiredCertificates)) * 100) : 100;

  const companies = await db.company.findMany({
    where: companyWhere,
    select: { id: true, name: true, certificates: { where: { deletedAt: null }, select: { id: true, status: true, validUntil: true } } },
    orderBy: { name: "asc" },
  });

  const companyCompliance = companies.map((c) => {
    const certs = c.certificates.filter((cert) => cert.status !== "REVOKED");
    const active = certs.filter((cert) => cert.validUntil >= now && (cert.status === "ISSUED" || cert.status === "VALID")).length;
    const expired = certs.filter((cert) => cert.validUntil < now).length;
    const total = active + expired;
    return { companyId: c.id, companyName: c.name, active, expired, total, complianceRate: total > 0 ? Math.round((active / total) * 100) : 100 };
  }).sort((a, b) => a.complianceRate - b.complianceRate).slice(0, 10);

  const certStatus = [
    { name: "Valid", value: activeCertificates, color: "#16a34a" },
    { name: "Expiring", value: expiring30, color: "#ea580c" },
    { name: "Expired", value: expiredCertificates, color: "#dc2626" },
    { name: "Revoked", value: revokedCertificates, color: "#6b7280" },
  ];

  const complianceByCompany = companyCompliance.map((c) => ({
    name: c.companyName.length > 15 ? c.companyName.substring(0, 15) + "…" : c.companyName,
    rate: c.complianceRate,
  }));

  // Monthly certs (last 12 months)
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 11);
  twelveMonthsAgo.setDate(1);
  twelveMonthsAgo.setHours(0, 0, 0, 0);
  const monthLabels: string[] = [];
  const monthKeys: string[] = [];
  const tmp = new Date(twelveMonthsAgo);
  for (let i = 0; i < 12; i++) {
    const key = `${tmp.getFullYear()}-${String(tmp.getMonth() + 1).padStart(2, "0")}`;
    monthKeys.push(key);
    monthLabels.push(tmp.toLocaleDateString("en", { month: "short", year: "2-digit" }));
    tmp.setMonth(tmp.getMonth() + 1);
  }

  const monthlyCertsRaw = await db.certificate.findMany({ where: { ...certWhere, issuedAt: { gte: twelveMonthsAgo } }, select: { issuedAt: true } });
  const monthCounts: Record<string, number> = {};
  monthKeys.forEach(k => monthCounts[k] = 0);
  for (const cert of monthlyCertsRaw) {
    const key = `${cert.issuedAt.getFullYear()}-${String(cert.issuedAt.getMonth() + 1).padStart(2, "0")}`;
    if (key in monthCounts) monthCounts[key]++;
  }
  const monthlyCertificatesIssued = monthLabels.map((label, i) => ({ name: label, issued: monthCounts[monthKeys[i]] }));

  // Monthly renewals — count certs issued in the same month as a previous cert
  // for the same trainee (renewal pattern). Falls back to 0 if no renewals.
  const renewalCounts: Record<string, number> = {};
  monthKeys.forEach(k => renewalCounts[k] = 0);
  // Note: renewedFromId field is on the enterprise-certificate-management branch.
  // On this branch, we approximate renewals by counting certs issued to trainees
  // who already had a previous cert for the same course.
  const allCertsInPeriod = await db.certificate.findMany({
    where: { ...certWhere, issuedAt: { gte: twelveMonthsAgo } },
    select: { issuedAt: true, traineeIdNational: true, courseId: true },
  });
  // Build a set of (traineeIdNational + courseId) seen before this period
  const earlierCerts = await db.certificate.findMany({
    where: { ...certWhere, issuedAt: { lt: twelveMonthsAgo } },
    select: { traineeIdNational: true, courseId: true },
  });
  const earlierSet = new Set(earlierCerts.filter(c => c.traineeIdNational).map(c => `${c.traineeIdNational}:${c.courseId}`));
  for (const cert of allCertsInPeriod) {
    if (cert.traineeIdNational && earlierSet.has(`${cert.traineeIdNational}:${cert.courseId}`)) {
      const key = `${cert.issuedAt.getFullYear()}-${String(cert.issuedAt.getMonth() + 1).padStart(2, "0")}`;
      if (key in renewalCounts) renewalCounts[key]++;
    }
  }
  const monthlyRenewals = monthLabels.map((label, i) => ({ name: label, renewals: renewalCounts[monthKeys[i]] }));

  // Top 10 courses
  const topCoursesData = await db.certificate.groupBy({ by: ["courseId"], where: certWhere, _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 10 });
  const topCourseInfo = await db.course.findMany({ where: { id: { in: topCoursesData.map(t => t.courseId) } }, select: { id: true, code: true, title: true } });
  const topCourses = topCoursesData.map((t) => {
    const course = topCourseInfo.find(c => c.id === t.courseId);
    return { name: course ? (course.title.length > 20 ? course.title.substring(0, 20) + "…" : course.title) : "Unknown", code: course?.code ?? "?", count: t._count.id };
  });

  // Top 10 companies
  const topCompaniesData = await db.certificate.groupBy({ by: ["companyId"], where: { ...certWhere, companyId: { not: null } }, _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 10 });
  const topCompanyInfo = await db.company.findMany({ where: { id: { in: topCompaniesData.map(t => t.companyId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
  const topCompanies = topCompaniesData.map((t) => {
    const company = topCompanyInfo.find(c => c.id === t.companyId);
    return { name: company ? (company.name.length > 15 ? company.name.substring(0, 15) + "…" : company.name) : "Unknown", count: t._count.id };
  });

  // Workers missing mandatory courses
  const coreRules = await db.complianceRule.findMany({ where: { deletedAt: null, isActive: true, isCoreMandatory: true }, include: { course: { select: { id: true, code: true, title: true } } } });
  const workersMissingMandatory = await Promise.all(coreRules.map(async (rule) => {
    const haveValid = await db.workerPassport.count({ where: { ...workerWhere, certificates: { some: { deletedAt: null, status: { in: ["ISSUED", "VALID"] }, validUntil: { gte: now }, courseId: rule.courseId } } } });
    return { course: rule.course.title.length > 20 ? rule.course.title.substring(0, 20) + "…" : rule.course.title, code: rule.course.code, missing: Math.max(0, totalWorkers - haveValid), haveValid };
  }));

  return ok({
    kpis: { totalCompanies, totalWorkers, activeWorkers, totalCertificates, activeCertificates, expiredCertificates, expiring7Days: expiring7, expiring30Days: expiring30, expiring60Days: expiring60, expiring90Days: expiring90, revokedCertificates, pendingApprovalCerts, complianceRate },
    charts: { certStatus, complianceByCompany, monthlyCertificatesIssued, monthlyRenewals, topCourses, topCompanies, workersMissingMandatory },
    lowestComplianceCompanies: companyCompliance,
    filters: { companyId, courseId, dateFrom, dateTo },
  });
});
