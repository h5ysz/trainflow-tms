// GCCLAB TMS — Report Template Registry
// =====================================================================
// Template-based reporting architecture. Each template defines:
//   - metadata (code, name, description, supported formats)
//   - column definitions (field key, header, width, format)
//   - a query function that pulls data from the production DB
//
// New client templates can be added by registering a new template
// in the TEMPLATES array — no business logic changes needed.
//
// The first template reproduces the GCCLAB monthly Excel report.

import { db } from "@/lib/db";

// ── Types ────────────────────────────────────────────────────────────

export type ExportFormat = "xlsx" | "pdf";

export interface ReportColumn {
  key: string;           // field key in the data row
  header: string;        // column header in the export
  width?: number;        // column width in Excel (chars)
  format?: "text" | "date" | "datetime" | "number" | "percentage" | "boolean";
}

export interface ReportFilter {
  month?: string;        // "2026-07" format
  dateFrom?: string;     // ISO date
  dateTo?: string;       // ISO date
  companyId?: string;
  trainerId?: string;
  courseId?: string;
  region?: string;
  city?: string;
  client?: string;       // alias for companyId
}

export interface ReportTemplate {
  code: string;                          // unique template code, e.g. "GCCLAB_MONTHLY"
  name: string;                          // display name
  nameAr: string;                        // Arabic name
  description: string;
  supportedFormats: ExportFormat[];
  columns: ReportColumn[];
  groupByCompany?: boolean;              // if true, group rows by company with subtotals
  title?: string;                        // report title shown in the export
  query: (filter: ReportFilter) => Promise<ReportDataRow[]>;
}

export interface ReportDataRow {
  [key: string]: string | number | boolean | Date | null;
}

// ── GCCLAB Monthly Report Template ──────────────────────────────────

const GCCLAB_COLUMNS: ReportColumn[] = [
  { key: "traineeName", header: "Trainee Name", width: 30, format: "text" },
  { key: "nationalId", header: "National ID / Iqama", width: 18, format: "text" },
  { key: "companyName", header: "Company", width: 25, format: "text" },
  { key: "companyRef", header: "Company Ref", width: 14, format: "text" },
  { key: "city", header: "City", width: 15, format: "text" },
  { key: "region", header: "Region", width: 15, format: "text" },
  { key: "courseTitle", header: "Course", width: 30, format: "text" },
  { key: "courseCode", header: "Course Code", width: 12, format: "text" },
  { key: "sessionRef", header: "Session", width: 14, format: "text" },
  { key: "sessionDate", header: "Session Date", width: 14, format: "date" },
  { key: "trainerName", header: "Trainer", width: 25, format: "text" },
  { key: "attendanceStatus", header: "Attendance", width: 14, format: "text" },
  { key: "checkInAt", header: "Check-in Time", width: 18, format: "datetime" },
  { key: "preTestScore", header: "Pre-Test Score", width: 12, format: "percentage" },
  { key: "finalTestScore", header: "Final Test Score", width: 12, format: "percentage" },
  { key: "examPassed", header: "Exam Result", width: 12, format: "text" },
  { key: "certificateRef", header: "Certificate No.", width: 16, format: "text" },
  { key: "certificateStatus", header: "Certificate Status", width: 14, format: "text" },
  { key: "issueDate", header: "Issue Date", width: 14, format: "date" },
  { key: "expiryDate", header: "Expiry Date", width: 14, format: "date" },
];

async function gcclabMonthlyQuery(filter: ReportFilter): Promise<ReportDataRow[]> {
  // Build the WHERE clause for sessions
  const sessionWhere: Record<string, unknown> = { deletedAt: null };

  // Date range filter
  if (filter.month) {
    const [year, month] = filter.month.split("-").map(Number);
    const from = new Date(year, month - 1, 1);
    const to = new Date(year, month, 0, 23, 59, 59);
    sessionWhere.startDate = { gte: from, lte: to };
  } else if (filter.dateFrom || filter.dateTo) {
    const dateFilter: Record<string, unknown> = {};
    if (filter.dateFrom) dateFilter.gte = new Date(filter.dateFrom);
    if (filter.dateTo) dateFilter.lte = new Date(filter.dateTo);
    sessionWhere.startDate = dateFilter;
  }

  // Filters on related fields
  if (filter.courseId) sessionWhere.courseId = filter.courseId;
  if (filter.trainerId) sessionWhere.trainerId = filter.trainerId;
  if (filter.city) sessionWhere.city = filter.city;
  if (filter.region) sessionWhere.region = filter.region;

  // Fetch sessions with all related data
  const sessions = await db.trainingSession.findMany({
    where: sessionWhere,
    include: {
      course: { select: { id: true, title: true, code: true, refNumber: true } },
      trainer: { select: { id: true, fullName: true, refNumber: true } },
      attendance: {
        where: { deletedAt: null },
        select: {
          id: true,
          traineeName: true,
          traineeIdNational: true,
          companyId: true,
          checkInAt: true,
          status: true,
        },
      },
      certificates: {
        where: { deletedAt: null },
        select: {
          id: true,
          refNumber: true,
          traineeName: true,
          traineeIdNational: true,
          finalScore: true,
          status: true,
          issuedAt: true,
          validUntil: true,
          companyId: true,
        },
      },
    },
    orderBy: { startDate: "asc" },
  });

  // If company filter, filter sessions that have attendance/certs from that company
  const companyIdFilter = filter.companyId || filter.client;

  // Collect all company IDs we need
  const allCompanyIds = new Set<string>();
  sessions.forEach((s) => {
    s.attendance.forEach((a) => { if (a.companyId) allCompanyIds.add(a.companyId); });
    s.certificates.forEach((c) => { if (c.companyId) allCompanyIds.add(c.companyId); });
  });
  const companies = await db.company.findMany({
    where: { id: { in: Array.from(allCompanyIds) } },
    select: { id: true, name: true, refNumber: true, city: true, country: true },
  });
  const companyMap = new Map(companies.map((c) => [c.id, c]));

  // Also fetch exam results per session+trainee
  const sessionIds = sessions.map((s) => s.id);
  const examResults = await db.testResult.findMany({
    where: {
      deletedAt: null,
      sessionId: { in: sessionIds },
    },
    select: {
      sessionId: true,
      traineeName: true,
      traineeIdNational: true,
      testType: true,
      scorePercent: true,
      passed: true,
    },
  });

  // Index exam results by (sessionId + traineeName + testType)
  const examMap = new Map<string, { score: number; passed: boolean }>();
  for (const er of examResults) {
    const key = `${er.sessionId}|${er.traineeName}|${er.testType}`;
    examMap.set(key, { score: er.scorePercent, passed: er.passed });
  }

  // Build report rows — one row per attendance record
  const rows: ReportDataRow[] = [];
  for (const session of sessions) {
    for (const att of session.attendance) {
      // Apply company filter
      if (companyIdFilter && att.companyId !== companyIdFilter) continue;

      const company = att.companyId ? companyMap.get(att.companyId) : null;
      const preTestKey = `${session.id}|${att.traineeName}|PRE_TEST`;
      const finalTestKey = `${session.id}|${att.traineeName}|FINAL_TEST`;
      const preTest = examMap.get(preTestKey);
      const finalTest = examMap.get(finalTestKey);

      // Find matching certificate
      const cert = session.certificates.find(
        (c) =>
          c.traineeName === att.traineeName &&
          (!att.traineeIdNational || c.traineeIdNational === att.traineeIdNational)
      );

      rows.push({
        traineeName: att.traineeName,
        nationalId: att.traineeIdNational ?? "",
        companyName: company?.name ?? "",
        companyRef: company?.refNumber ?? "",
        city: session.city ?? company?.city ?? "",
        region: session.region ?? company?.country ?? "",
        courseTitle: session.course?.title ?? "",
        courseCode: session.course?.code ?? "",
        sessionRef: session.refNumber,
        sessionDate: session.startDate,
        trainerName: session.trainer?.fullName ?? "",
        attendanceStatus: att.status,
        checkInAt: att.checkInAt,
        preTestScore: preTest?.score ?? null,
        finalTestScore: finalTest?.score ?? null,
        examPassed: finalTest ? (finalTest.passed ? "PASSED" : "FAILED") : "",
        certificateRef: cert?.refNumber ?? "",
        certificateStatus: cert?.status ?? "",
        issueDate: cert?.issuedAt ?? null,
        expiryDate: cert?.validUntil ?? null,
      });
    }
  }

  return rows;
}

// ── Template Registry ────────────────────────────────────────────────

export const TEMPLATES: ReportTemplate[] = [
  {
    code: "GCCLAB_MONTHLY",
    name: "GCCLAB Monthly Report",
    nameAr: "تقرير GCCLAB الشهري",
    description: "Monthly training report reproducing the GCCLAB Excel format with trainee, company, course, session, attendance, exam, and certificate information.",
    supportedFormats: ["xlsx", "pdf"],
    columns: GCCLAB_COLUMNS,
    groupByCompany: true,
    title: "GCCLAB Monthly Training Report",
    query: gcclabMonthlyQuery,
  },
];

export function getTemplate(code: string): ReportTemplate | undefined {
  return TEMPLATES.find((t) => t.code === code);
}

export function listTemplates() {
  return TEMPLATES.map((t) => ({
    code: t.code,
    name: t.name,
    nameAr: t.nameAr,
    description: t.description,
    supportedFormats: t.supportedFormats,
    columns: t.columns.map((c) => ({ key: c.key, header: c.header })),
    groupByCompany: t.groupByCompany ?? false,
    title: t.title ?? t.name,
  }));
}
