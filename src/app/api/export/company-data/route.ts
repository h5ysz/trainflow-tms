// /api/export/company-data — professional administrative Excel export
//
// Query params:
//   scope: last | specific_request | specific_course | date_range | all
//   items: comma-separated subset of:
//          requests, trainees, attendance, results, evaluations,
//          certificates, invoices, attachments
//   format: excel (fully supported) | pdf | zip (stub — falls back to excel)
//   locale: en | ar  — controls column headers, sheet names AND enum value
//                       translation. When ar, sheet view is right-to-left.
//   specificId?: string — request id (specific_request) or course id (specific_course)
//   dateFrom?: string  (ISO date)
//   dateTo?:   string  (ISO date)
//
// Output: a single .xlsx workbook. Sheet 1 is always "Summary" (in the chosen
// locale). Every selected item gets its own sheet — empty sheets are NOT
// created. Enum values from the DB (statuses, priorities, test types…) are
// translated to the chosen locale. Numeric IDs are written as text so leading
// zeros are preserved. Dates are written as real Excel dates with a yyyy-mm-dd
// format so they sort and filter correctly.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, fail } from "@/lib/auth/api";
import ExcelJS from "exceljs";

type Locale = "en" | "ar";

// ─────────────────────────────────────────────────────────────────────────────
// Translation maps — DB enum/raw value → localized display value
// ─────────────────────────────────────────────────────────────────────────────
type TxEntry = { en: string; ar: string };

const REQUEST_STATUS: Record<string, TxEntry> = {
  DRAFT: { en: "Draft", ar: "مسودة" },
  SUBMITTED: { en: "Submitted", ar: "مقدم" },
  UNDER_REVIEW: { en: "Under Review", ar: "قيد المراجعة" },
  APPROVED: { en: "Approved", ar: "معتمد" },
  SCHEDULED: { en: "Scheduled", ar: "مجدول" },
  IN_PROGRESS: { en: "In Progress", ar: "قيد التنفيذ" },
  COMPLETED: { en: "Completed", ar: "مكتمل" },
  CANCELLED: { en: "Cancelled", ar: "ملغي" },
  REJECTED: { en: "Rejected", ar: "مرفوض" },
  REQUIRES_MODIFICATION: { en: "Requires Modification", ar: "يحتاج تعديل" },
  CLOSED: { en: "Closed", ar: "مغلق" },
};

const PRIORITY: Record<string, TxEntry> = {
  LOW: { en: "Low", ar: "منخفضة" },
  NORMAL: { en: "Normal", ar: "عادية" },
  HIGH: { en: "High", ar: "عالية" },
  URGENT: { en: "Urgent", ar: "عاجلة" },
};

const ATTENDANCE_STATUS: Record<string, TxEntry> = {
  REGISTERED: { en: "Registered", ar: "مسجل" },
  PRESENT: { en: "Present", ar: "حاضر" },
  ABSENT: { en: "Absent", ar: "غائب" },
  LATE: { en: "Late", ar: "متأخر" },
  EXCUSED: { en: "Excused", ar: "بعذر" },
};

const TEST_TYPE: Record<string, TxEntry> = {
  PRE_TEST: { en: "Pre-Test", ar: "اختبار قبلي" },
  FINAL_TEST: { en: "Final Test", ar: "الاختبار النهائي" },
};

const CERT_STATUS: Record<string, TxEntry> = {
  VALID: { en: "Valid", ar: "سارية" },
  EXPIRED: { en: "Expired", ar: "منتهية" },
  REVOKED: { en: "Revoked", ar: "ملغاة" },
  RENEWED: { en: "Renewed", ar: "مجددة" },
};

const CERT_RELEASE_STATUS: Record<string, TxEntry> = {
  DRAFT: { en: "Draft", ar: "مسودة" },
  READY_FOR_RELEASE: { en: "Ready for Release", ar: "جاهزة للإصدار" },
  RELEASED: { en: "Released", ar: "صادرة" },
  DOWNLOADED: { en: "Downloaded", ar: "تم تنزيلها" },
};

const INVOICE_STATUS: Record<string, TxEntry> = {
  DRAFT: { en: "Draft", ar: "مسودة" },
  SENT: { en: "Sent", ar: "مرسلة" },
  PAID: { en: "Paid", ar: "مدفوعة" },
  PARTIALLY_PAID: { en: "Partially Paid", ar: "مدفوعة جزئياً" },
  OVERDUE: { en: "Overdue", ar: "متأخرة" },
  CANCELLED: { en: "Cancelled", ar: "ملغاة" },
  REFUNDED: { en: "Refunded", ar: "مستردة" },
};

const TRAINEE_STATUS: Record<string, TxEntry> = {
  ACTIVE: { en: "Active", ar: "نشط" },
  INACTIVE: { en: "Inactive", ar: "غير نشط" },
};

const ENROLLMENT_STATUS: Record<string, TxEntry> = {
  PENDING: { en: "Pending", ar: "قيد الانتظار" },
  CONFIRMED: { en: "Confirmed", ar: "مؤكد" },
  CHECKED_IN: { en: "Checked In", ar: "تم الحضور" },
  TRAINING: { en: "Training", ar: "تدريب" },
  COMPLETED: { en: "Completed", ar: "مكتمل" },
  CANCELLED: { en: "Cancelled", ar: "ملغي" },
  NO_SHOW: { en: "No Show", ar: "لم يحضر" },
  ENROLLED: { en: "Enrolled", ar: "مسجل" },
  REPLACED: { en: "Replaced", ar: "مستبدل" },
};

const FINAL_TEST_STATUS: Record<string, TxEntry> = {
  NOT_REQUIRED: { en: "Not Required", ar: "غير مطلوب" },
  PENDING: { en: "Pending", ar: "قيد الانتظار" },
  IN_PROGRESS: { en: "In Progress", ar: "قيد التنفيذ" },
  PASSED: { en: "Passed", ar: "ناجح" },
  FAILED: { en: "Failed", ar: "راسب" },
  NOT_STARTED: { en: "Not Started", ar: "لم يبدأ" },
};

const CERT_ENROLL_STATUS: Record<string, TxEntry> = {
  NOT_ELIGIBLE: { en: "Not Eligible", ar: "غير مؤهل" },
  ELIGIBLE: { en: "Eligible", ar: "مؤهل" },
  GENERATED: { en: "Generated", ar: "تم الإصدار" },
  ISSUED: { en: "Issued", ar: "صادر" },
  NOT_ISSUED: { en: "Not Issued", ar: "غير صادر" },
};

function tx(map: Record<string, TxEntry>, key: string | null | undefined, locale: Locale): string {
  if (!key) return "";
  const entry = map[key];
  return entry ? entry[locale] : key;
}

// ─────────────────────────────────────────────────────────────────────────────
// i18n strings (sheet names, headers, summary labels)
// ─────────────────────────────────────────────────────────────────────────────
const SHEET_NAMES = {
  summary: (l: Locale) => (l === "ar" ? "الملخص" : "Summary"),
  requests: (l: Locale) => (l === "ar" ? "طلبات التدريب" : "Training Requests"),
  trainees: (l: Locale) => (l === "ar" ? "المتدربون" : "Trainees"),
  attendance: (l: Locale) => (l === "ar" ? "الحضور" : "Attendance"),
  results: (l: Locale) => (l === "ar" ? "نتائج التقييم" : "Assessment Results"),
  evaluations: (l: Locale) => (l === "ar" ? "التقييمات" : "Evaluations"),
  certificates: (l: Locale) => (l === "ar" ? "الشهادات" : "Certificates"),
  invoices: (l: Locale) => (l === "ar" ? "الفواتير" : "Invoices"),
  attachments: (l: Locale) => (l === "ar" ? "المرفقات" : "Attachments"),
};

const HEADERS = {
  requests: (l: Locale) => [
    l === "ar" ? "رقم الطلب" : "Request #",
    l === "ar" ? "الشركة" : "Company",
    l === "ar" ? "الدورة" : "Course",
    l === "ar" ? "الحالة" : "Status",
    l === "ar" ? "الأولوية" : "Priority",
    l === "ar" ? "عدد المتدربين" : "Trainee Count",
    l === "ar" ? "التاريخ المبدئي من" : "Preferred From",
    l === "ar" ? "التاريخ المبدئي إلى" : "Preferred To",
    l === "ar" ? "الموقع" : "Location",
    l === "ar" ? "اللغة" : "Language",
    l === "ar" ? "الملاحظات" : "Notes",
    l === "ar" ? "تاريخ الإنشاء" : "Created At",
  ],
  trainees: (l: Locale) => [
    l === "ar" ? "اسم المتدرب" : "Full Name",
    l === "ar" ? "رقم الهوية" : "National ID",
    l === "ar" ? "الجنسية" : "Nationality",
    l === "ar" ? "المهنة" : "Job Title",
    l === "ar" ? "الجوال" : "Mobile",
    l === "ar" ? "البريد" : "Email",
    l === "ar" ? "الطلب المرتبط" : "Request #",
    l === "ar" ? "الحالة" : "Status",
  ],
  attendance: (l: Locale) => [
    l === "ar" ? "الجلسة" : "Session #",
    l === "ar" ? "اسم المتدرب" : "Trainee Name",
    l === "ar" ? "رقم الهوية" : "National ID",
    l === "ar" ? "الحالة" : "Status",
    l === "ar" ? "وقت الحضور" : "Check-in",
    l === "ar" ? "وقت المغادرة" : "Check-out",
  ],
  results: (l: Locale) => [
    l === "ar" ? "الجلسة" : "Session #",
    l === "ar" ? "اسم المتدرب" : "Trainee Name",
    l === "ar" ? "نوع الاختبار" : "Test Type",
    l === "ar" ? "النتيجة %" : "Score %",
    l === "ar" ? "النتيجة" : "Result",
    l === "ar" ? "التاريخ" : "Date",
  ],
  evaluations: (l: Locale) => [
    l === "ar" ? "الجلسة" : "Session #",
    l === "ar" ? "اسم المتدرب" : "Trainee Name",
    l === "ar" ? "تقييم المدرب" : "Trainer Rating",
    l === "ar" ? "تقييم المحتوى" : "Content Rating",
    l === "ar" ? "التقييم العام" : "Overall Rating",
    l === "ar" ? "التعليقات" : "Comments",
  ],
  certificates: (l: Locale) => [
    l === "ar" ? "رقم الشهادة" : "Certificate #",
    l === "ar" ? "الجلسة" : "Session #",
    l === "ar" ? "اسم المتدرب" : "Trainee Name",
    l === "ar" ? "رقم الهوية" : "National ID",
    l === "ar" ? "النتيجة النهائية" : "Final Score",
    l === "ar" ? "تاريخ الإصدار" : "Issued At",
    l === "ar" ? "صالحة حتى" : "Valid Until",
    l === "ar" ? "الحالة" : "Status",
    l === "ar" ? "حالة الإصدار" : "Release Status",
  ],
  invoices: (l: Locale) => [
    l === "ar" ? "رقم الفاتورة" : "Invoice #",
    l === "ar" ? "رقم الطلب" : "Request #",
    l === "ar" ? "المبلغ الإجمالي" : "Grand Total",
    l === "ar" ? "المبلغ المدفوع" : "Paid Amount",
    l === "ar" ? "الرصيد المتبقي" : "Outstanding",
    l === "ar" ? "العملة" : "Currency",
    l === "ar" ? "الحالة" : "Status",
    l === "ar" ? "تاريخ الإصدار" : "Issue Date",
    l === "ar" ? "تاريخ الاستحقاق" : "Due Date",
  ],
  attachments: (l: Locale) => [
    l === "ar" ? "اسم الملف" : "File Name",
    l === "ar" ? "نوع الملف" : "File Type",
    l === "ar" ? "النوع" : "Category",
    l === "ar" ? "اسم المتدرب" : "Trainee Name",
    l === "ar" ? "رقم الطلب" : "Request #",
    l === "ar" ? "تاريخ الرفع" : "Uploaded At",
    l === "ar" ? "الرابط" : "URL",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — styling, dates, IDs
// ─────────────────────────────────────────────────────────────────────────────
const HEADER_FILL = "FF1F3A5F"; // deep navy
const HEADER_FONT_COLOR = "FFFFFFFF";
const BORDER_COLOR = "FFD0D7DE";

function styleSheet(ws: ExcelJS.Worksheet, locale: Locale) {
  // Header row styling
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, size: 11, color: { argb: HEADER_FONT_COLOR } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  headerRow.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  headerRow.height = 28;
  headerRow.border = {
    top: { style: "thin", color: { argb: BORDER_COLOR } },
    bottom: { style: "medium", color: { argb: BORDER_COLOR } },
    left: { style: "thin", color: { argb: BORDER_COLOR } },
    right: { style: "thin", color: { argb: BORDER_COLOR } },
  };

  // Freeze header + enable filter + RTL for Arabic
  const view: Partial<ExcelJS.WorksheetView> = { state: "frozen", ySplit: 1 };
  if (locale === "ar") view.rightToLeft = true;
  ws.views = [view as ExcelJS.WorksheetView];

  // Auto-filter on the header row
  const colCount = ws.columnCount;
  if (colCount > 0) {
    const lastLetter = ws.getColumn(colCount).letter;
    ws.autoFilter = `A1:${lastLetter}1`;
  }

  // Page setup — fit-to-width when printing / exporting to PDF
  ws.pageSetup.orientation = "landscape";
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0;
  ws.properties.defaultRowHeight = 18;
}

function autoWidth(ws: ExcelJS.Worksheet, opts: { wrapCols?: Set<number> } = {}) {
  const wrapCols = opts.wrapCols ?? new Set<number>();
  const colCount = ws.columnCount;
  const rowCount = ws.rowCount;
  for (let c = 1; c <= colCount; c++) {
    let maxLen = 0;
    for (let r = 1; r <= rowCount; r++) {
      const cell = ws.getCell(r, c);
      let val = "";
      if (cell.value instanceof Date) {
        val = cell.value.toLocaleDateString();
      } else if (cell.value !== null && cell.value !== undefined) {
        val = String(cell.value);
      }
      if (wrapCols.has(c)) {
        if (val.length > maxLen && val.length <= 50) maxLen = val.length;
      } else {
        const lines = val.split("\n");
        const longest = Math.max(...lines.map((l) => l.length), 0);
        if (longest > maxLen) maxLen = longest;
      }
    }
    ws.getColumn(c).width = Math.min(Math.max(maxLen + 3, 12), 60);
  }
}

function applyDataStyling(ws: ExcelJS.Worksheet, rowCount: number) {
  if (rowCount === 0) return;
  // Apply borders + zebra striping to data rows
  for (let r = 2; r <= rowCount + 1; r++) {
    const row = ws.getRow(r);
    row.border = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      left: { style: "thin", color: { argb: BORDER_COLOR } },
      right: { style: "thin", color: { argb: BORDER_COLOR } },
    };
    if (r % 2 === 1) {
      // Light zebra stripe
      row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8FA" } };
    }
    row.alignment = { vertical: "middle", horizontal: "left", wrapText: false };
  }
}

function writeIdCell(ws: ExcelJS.Worksheet, row: ExcelJS.Row, colIdx: number, value: string) {
  // National IDs / ref numbers must be text — preserves leading zeros
  const cell = ws.getCell(row.number, colIdx);
  cell.value = String(value ?? "");
  cell.numFmt = "@";
}

function writeDateCell(cell: ExcelJS.Cell, value: Date | string | null | undefined, withTime = false) {
  if (!value) {
    cell.value = "";
    return;
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    cell.value = "";
    return;
  }
  cell.value = date;
  cell.numFmt = withTime ? "yyyy-mm-dd hh:mm" : "yyyy-mm-dd";
}

// ─────────────────────────────────────────────────────────────────────────────
// Main route
// ─────────────────────────────────────────────────────────────────────────────
export const GET = async (req: NextRequest) => {
  const user = await requireAuth();

  // Contractors are scoped to their own company. Coordinators / Super Admin /
  // Company Admin can export ALL companies' data (they don't have companyId).
  const isGlobalRole = ["COORDINATOR", "SUPER_ADMIN", "COMPANY_ADMIN", "TRAINER", "AUDITOR"].includes(user.role);
  if (!user.companyId && !isGlobalRole) {
    return fail("No company linked", 403);
  }

  const url = new URL(req.url);
  const scope = (url.searchParams.get("scope") || "last") as
    | "last" | "specific_request" | "specific_course" | "date_range" | "all";
  const items = (url.searchParams.get("items") || "").split(",").filter(Boolean);
  const localeParam = url.searchParams.get("locale") === "ar" ? "ar" : "en";
  const locale: Locale = localeParam;
  const specificId = url.searchParams.get("specificId") || undefined;
  const dateFrom = url.searchParams.get("dateFrom") || undefined;
  const dateTo = url.searchParams.get("dateTo") || undefined;

  if (items.length === 0) {
    return fail("No items selected", 422, "VALIDATION_ERROR");
  }

  const companyId = user.companyId; // undefined for global roles → no company filter

  // ── Build the TrainingRequest where-clause ──
  // Contractors: scoped to their own company.
  // Coordinators/Admins: see ALL companies (no companyId filter).
  const reqWhere: Record<string, unknown> = { deletedAt: null };
  if (companyId) reqWhere.companyId = companyId;
  let scopeCourseId: string | undefined;
  let scopeCourseTitle = "";
  let scopeRequestRef = "";

  switch (scope) {
    case "last": {
      const last = await db.trainingRequest.findFirst({
        where: reqWhere,
        orderBy: { createdAt: "desc" },
        select: { id: true, refNumber: true },
      });
      if (last) {
        reqWhere.id = last.id;
        scopeRequestRef = last.refNumber;
      }
      break;
    }
    case "specific_request": {
      if (specificId) {
        reqWhere.id = specificId;
        const r = await db.trainingRequest.findUnique({
          where: { id: specificId },
          select: { refNumber: true },
        });
        scopeRequestRef = r?.refNumber ?? specificId;
      }
      break;
    }
    case "specific_course": {
      if (specificId) {
        scopeCourseId = specificId;
        // A request is "for this course" if its primary courseId matches OR
        // any of its requestCourses.courseId matches.
        reqWhere.OR = [
          { courseId: specificId },
          { requestCourses: { some: { courseId: specificId, deletedAt: null } } },
        ];
        const c = await db.course.findUnique({ where: { id: specificId }, select: { title: true } });
        scopeCourseTitle = c?.title ?? specificId;
      }
      break;
    }
    case "date_range": {
      if (dateFrom || dateTo) {
        const range: Record<string, Date> = {};
        if (dateFrom) range.gte = new Date(dateFrom);
        if (dateTo) {
          const end = new Date(dateTo);
          end.setHours(23, 59, 59, 999);
          range.lte = end;
        }
        reqWhere.createdAt = range;
      }
      break;
    }
    case "all":
    default:
      // No additional filter — full company export
      break;
  }

  // ── Fetch request ids (used by downstream sheets when scopeCourseId set) ──
  const allRequests = await db.trainingRequest.findMany({
    where: reqWhere,
    select: {
      id: true, refNumber: true, status: true, priority: true, traineeCount: true,
      preferredDateFrom: true, preferredDateTo: true, preferredLocation: true,
      preferredLanguage: true, notes: true, createdAt: true,
      company: { select: { name: true } },
      course: { select: { title: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  const requestIds = allRequests.map((r) => r.id);

  // ── Workbook ──
  const wb = new ExcelJS.Workbook();
  wb.creator = "GCCLAB TMS";
  wb.created = new Date();
  wb.modified = new Date();

  // Counters for the Summary sheet
  const counts = {
    requests: 0, trainees: 0, attendance: 0, results: 0,
    evaluations: 0, certificates: 0, invoices: 0, attachments: 0, courses: 0,
  };

  // Number of distinct courses touched by the requests
  if (requestIds.length > 0) {
    const distinctCourses = await db.trainingRequestCourse.findMany({
      where: { requestId: { in: requestIds }, deletedAt: null },
      select: { courseId: true },
      distinct: ["courseId"],
    });
    counts.courses = distinctCourses.length;
    // Include the primary course as well
    const primaryCourses = new Set(
      allRequests.map((r) => r.course?.title).filter(Boolean) as string[],
    );
    counts.courses = Math.max(counts.courses, primaryCourses.size);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET 1 — Summary (always present, always first)
  // ═══════════════════════════════════════════════════════════════════════════
  const summaryWs = wb.addWorksheet(SHEET_NAMES.summary(locale));
  // Two-column layout: label | value
  summaryWs.columns = [
    { header: locale === "ar" ? "الحقل" : "Field", key: "field" },
    { header: locale === "ar" ? "القيمة" : "Value", key: "value" },
  ];

  const companyName = allRequests[0]?.company?.name
    ?? (companyId ? (await db.company.findUnique({ where: { id: companyId }, select: { name: true } }))?.name : null)
    ?? (isGlobalRole ? (locale === "ar" ? "جميع الشركات" : "All Companies") : "");
  const scopeLabels: Record<string, string> = {
    last: locale === "ar" ? `آخر طلب (${scopeRequestRef})` : `Last request (${scopeRequestRef})`,
    specific_request: locale === "ar" ? `طلب محدد (${scopeRequestRef})` : `Specific request (${scopeRequestRef})`,
    specific_course: locale === "ar" ? `دورة محددة (${scopeCourseTitle})` : `Specific course (${scopeCourseTitle})`,
    date_range: locale === "ar"
      ? `نطاق تاريخ${dateFrom ? ` من ${dateFrom}` : ""}${dateTo ? ` إلى ${dateTo}` : ""}`
      : `Date range${dateFrom ? ` from ${dateFrom}` : ""}${dateTo ? ` to ${dateTo}` : ""}`,
    all: locale === "ar" ? "كل البيانات" : "All data",
  };

  // We'll fill summary rows AFTER all data sheets have been built (so counts are populated).
  // For now, register the sheet so it stays first in the workbook.
  // We'll re-add rows at the end.

  const itemLabels: Record<string, { en: string; ar: string }> = {
    requests: { en: "Training Requests", ar: "طلبات التدريب" },
    trainees: { en: "Trainees", ar: "المتدربون" },
    attendance: { en: "Attendance", ar: "الحضور" },
    results: { en: "Assessment Results", ar: "نتائج التقييم" },
    evaluations: { en: "Evaluations", ar: "التقييمات" },
    certificates: { en: "Certificates", ar: "الشهادات" },
    invoices: { en: "Invoices", ar: "الفواتير" },
    attachments: { en: "Attachments", ar: "المرفقات" },
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET — Training Requests
  // ═══════════════════════════════════════════════════════════════════════════
  if (items.includes("requests")) {
    const ws = wb.addWorksheet(SHEET_NAMES.requests(locale));
    const headers = HEADERS.requests(locale);
    ws.columns = headers.map((h) => ({ header: h, key: h }));

    for (const r of allRequests) {
      const row = ws.addRow([
        r.refNumber,
        r.company?.name ?? "",
        r.course?.title ?? "",
        tx(REQUEST_STATUS, r.status, locale),
        tx(PRIORITY, r.priority, locale),
        r.traineeCount,
        "", // preferredDateFrom (set as date below)
        "", // preferredDateTo
        r.preferredLocation ?? "",
        r.preferredLanguage ?? "",
        r.notes ?? "",
        "", // createdAt
      ]);
      // Date cells
      writeDateCell(ws.getCell(row.number, 7), r.preferredDateFrom);
      writeDateCell(ws.getCell(row.number, 8), r.preferredDateTo);
      writeDateCell(ws.getCell(row.number, 12), r.createdAt, true);
      // Ref number as text
      writeIdCell(ws, row, 1, r.refNumber);
    }
    counts.requests = allRequests.length;
    styleSheet(ws, locale);
    autoWidth(ws, { wrapCols: new Set([11]) }); // wrap Notes
    applyDataStyling(ws, allRequests.length);
    // Wrap text on Notes column for all data rows
    if (allRequests.length > 0) {
      for (let r = 2; r <= allRequests.length + 1; r++) {
        ws.getCell(r, 11).alignment = { vertical: "top", wrapText: true };
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET — Trainees
  // ═══════════════════════════════════════════════════════════════════════════
  if (items.includes("trainees")) {
    const ws = wb.addWorksheet(SHEET_NAMES.trainees(locale));
    const headers = HEADERS.trainees(locale);
    ws.columns = headers.map((h) => ({ header: h, key: h }));

    // Fetch trainees via requestCourses → trainees → trainee
    const reqsWithTrainees = await db.trainingRequest.findMany({
      where: reqWhere,
      select: {
        refNumber: true,
        requestCourses: {
          where: { deletedAt: null },
          select: {
            course: { select: { title: true } },
            trainees: {
              where: { deletedAt: null },
              include: {
                trainee: {
                  select: {
                    fullName: true, nationalId: true, nationality: true,
                    jobTitle: true, mobile: true, email: true, status: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { refNumber: "asc" },
    });

    let traineeRowCount = 0;
    const seenTraineeIds = new Set<string>();
    for (const r of reqsWithTrainees) {
      for (const rc of r.requestCourses) {
        for (const trc of rc.trainees) {
          // Deduplicate by nationalId+fullName (trainee might appear in multiple courses)
          const dedupKey = `${trc.trainee.nationalId}|${trc.trainee.fullName}`;
          if (seenTraineeIds.has(dedupKey)) continue;
          seenTraineeIds.add(dedupKey);
          const row = ws.addRow([
            trc.trainee.fullName,
            "", // nationalId as text
            trc.trainee.nationality ?? "",
            trc.trainee.jobTitle ?? "",
            trc.trainee.mobile ?? "",
            trc.trainee.email ?? "",
            r.refNumber,
            tx(TRAINEE_STATUS, trc.trainee.status, locale),
          ]);
          writeIdCell(ws, row, 2, trc.trainee.nationalId);
          traineeRowCount++;
        }
      }
    }
    counts.trainees = traineeRowCount;
    styleSheet(ws, locale);
    autoWidth(ws);
    applyDataStyling(ws, traineeRowCount);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET — Attendance
  // ═══════════════════════════════════════════════════════════════════════════
  if (items.includes("attendance")) {
    const ws = wb.addWorksheet(SHEET_NAMES.attendance(locale));
    const headers = HEADERS.attendance(locale);
    ws.columns = headers.map((h) => ({ header: h, key: h }));

    // If a specific course is selected, only show attendance for sessions
    // whose request belongs to that course
    const sessionWhere: Record<string, unknown> = {
      request: reqWhere,
      deletedAt: null,
    };
    const sessions = await db.trainingSession.findMany({
      where: sessionWhere,
      select: {
        refNumber: true,
        attendance: {
          where: { deletedAt: null },
          select: {
            traineeName: true, traineeIdNational: true, status: true,
            checkInAt: true, checkOutAt: true,
          },
        },
      },
      orderBy: { refNumber: "asc" },
    });

    let attendanceRowCount = 0;
    for (const s of sessions) {
      for (const a of s.attendance) {
        const row = ws.addRow([
          s.refNumber,
          a.traineeName,
          "", // nationalId as text
          tx(ATTENDANCE_STATUS, a.status, locale),
          "", // checkIn
          "", // checkOut
        ]);
        writeIdCell(ws, row, 3, a.traineeIdNational ?? "");
        writeDateCell(ws.getCell(row.number, 5), a.checkInAt, true);
        writeDateCell(ws.getCell(row.number, 6), a.checkOutAt, true);
        writeIdCell(ws, row, 1, s.refNumber);
        attendanceRowCount++;
      }
    }
    counts.attendance = attendanceRowCount;
    styleSheet(ws, locale);
    autoWidth(ws);
    applyDataStyling(ws, attendanceRowCount);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET — Assessment Results
  // ═══════════════════════════════════════════════════════════════════════════
  if (items.includes("results")) {
    const ws = wb.addWorksheet(SHEET_NAMES.results(locale));
    const headers = HEADERS.results(locale);
    ws.columns = headers.map((h) => ({ header: h, key: h }));

    const sessions = await db.trainingSession.findMany({
      where: { request: reqWhere, deletedAt: null },
      select: {
        refNumber: true,
        testResults: {
          where: { deletedAt: null },
          select: {
            traineeName: true, testType: true, scorePercent: true,
            passed: true, attemptedAt: true,
          },
        },
      },
      orderBy: { refNumber: "asc" },
    });

    let resultsRowCount = 0;
    for (const s of sessions) {
      for (const r of s.testResults) {
        const row = ws.addRow([
          s.refNumber,
          r.traineeName,
          tx(TEST_TYPE, r.testType, locale),
          r.scorePercent,
          r.passed ? (locale === "ar" ? "ناجح" : "Passed") : (locale === "ar" ? "راسب" : "Failed"),
          "", // date
        ]);
        writeDateCell(ws.getCell(row.number, 6), r.attemptedAt, true);
        writeIdCell(ws, row, 1, s.refNumber);
        // Center score + result
        ws.getCell(row.number, 4).alignment = { horizontal: "center" };
        ws.getCell(row.number, 5).alignment = { horizontal: "center" };
        resultsRowCount++;
      }
    }
    counts.results = resultsRowCount;
    styleSheet(ws, locale);
    autoWidth(ws);
    applyDataStyling(ws, resultsRowCount);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET — Evaluations
  // ═══════════════════════════════════════════════════════════════════════════
  if (items.includes("evaluations")) {
    const ws = wb.addWorksheet(SHEET_NAMES.evaluations(locale));
    const headers = HEADERS.evaluations(locale);
    ws.columns = headers.map((h) => ({ header: h, key: h }));

    const sessions = await db.trainingSession.findMany({
      where: { request: reqWhere, deletedAt: null },
      select: {
        refNumber: true,
        evaluations: {
          where: { deletedAt: null },
          select: {
            traineeName: true, trainerRating: true, contentRating: true,
            overallRating: true, comments: true,
          },
        },
      },
      orderBy: { refNumber: "asc" },
    });

    let evalRowCount = 0;
    for (const s of sessions) {
      for (const e of s.evaluations) {
        const row = ws.addRow([
          s.refNumber,
          e.traineeName,
          e.trainerRating ?? "",
          e.contentRating ?? "",
          e.overallRating ?? "",
          e.comments ?? "",
        ]);
        writeIdCell(ws, row, 1, s.refNumber);
        // Center numeric ratings
        for (const c of [3, 4, 5]) {
          ws.getCell(row.number, c).alignment = { horizontal: "center" };
        }
        evalRowCount++;
      }
    }
    counts.evaluations = evalRowCount;
    styleSheet(ws, locale);
    autoWidth(ws, { wrapCols: new Set([6]) }); // wrap Comments
    applyDataStyling(ws, evalRowCount);
    if (evalRowCount > 0) {
      for (let r = 2; r <= evalRowCount + 1; r++) {
        ws.getCell(r, 6).alignment = { vertical: "top", wrapText: true };
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET — Certificates
  // ═══════════════════════════════════════════════════════════════════════════
  if (items.includes("certificates")) {
    const ws = wb.addWorksheet(SHEET_NAMES.certificates(locale));
    const headers = HEADERS.certificates(locale);
    ws.columns = headers.map((h) => ({ header: h, key: h }));

    // Filter certs by company (only for contractors), AND if specific_course — also by course
    const certWhere: Record<string, unknown> = { deletedAt: null };
    if (companyId) certWhere.companyId = companyId;
    if (scope === "specific_course" && scopeCourseId) {
      certWhere.courseId = scopeCourseId;
    } else if (requestIds.length > 0) {
      // Limit to certificates issued for sessions belonging to the in-scope requests
      certWhere.session = { request: { id: { in: requestIds } } };
    }
    const certs = await db.certificate.findMany({
      where: certWhere,
      select: {
        refNumber: true, traineeName: true, traineeIdNational: true,
        finalScore: true, issuedAt: true, validUntil: true, status: true,
        releaseStatus: true,
        session: { select: { refNumber: true } },
      },
      orderBy: { issuedAt: "desc" },
    });

    let certRowCount = 0;
    for (const c of certs) {
      const row = ws.addRow([
        "", // refNumber as text
        c.session?.refNumber ?? "",
        c.traineeName,
        "", // nationalId as text
        c.finalScore,
        "", // issuedAt
        "", // validUntil
        tx(CERT_STATUS, c.status, locale),
        tx(CERT_RELEASE_STATUS, c.releaseStatus, locale),
      ]);
      writeIdCell(ws, row, 1, c.refNumber);
      writeIdCell(ws, row, 2, c.session?.refNumber ?? "");
      writeIdCell(ws, row, 4, c.traineeIdNational ?? "");
      writeDateCell(ws.getCell(row.number, 6), c.issuedAt);
      writeDateCell(ws.getCell(row.number, 7), c.validUntil);
      // Center score
      ws.getCell(row.number, 5).alignment = { horizontal: "center" };
      certRowCount++;
    }
    counts.certificates = certRowCount;
    styleSheet(ws, locale);
    autoWidth(ws);
    applyDataStyling(ws, certRowCount);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET — Invoices
  // ═══════════════════════════════════════════════════════════════════════════
  if (items.includes("invoices")) {
    const ws = wb.addWorksheet(SHEET_NAMES.invoices(locale));
    const headers = HEADERS.invoices(locale);
    ws.columns = headers.map((h) => ({ header: h, key: h }));

    // If specific_course scope, we still want invoices tied to requests in that course
    const invWhere: Record<string, unknown> = { deletedAt: null };
    if (companyId) invWhere.companyId = companyId;
    if (requestIds.length > 0) {
      invWhere.requestId = { in: requestIds };
    }
    const invoices = await db.invoice.findMany({
      where: invWhere,
      select: {
        refNumber: true, grandTotal: true, paidAmount: true,
        outstandingBalance: true, currency: true, status: true,
        issueDate: true, dueDate: true,
        request: { select: { refNumber: true } },
      },
      orderBy: { issueDate: "desc" },
    });

    let invRowCount = 0;
    for (const inv of invoices) {
      const row = ws.addRow([
        "", // refNumber as text
        inv.request?.refNumber ?? "",
        inv.grandTotal,
        inv.paidAmount,
        inv.outstandingBalance,
        inv.currency,
        tx(INVOICE_STATUS, inv.status, locale),
        "", // issueDate
        "", // dueDate
      ]);
      writeIdCell(ws, row, 1, inv.refNumber);
      // Number format for currency columns
      for (const col of [3, 4, 5]) {
        const cell = ws.getCell(row.number, col);
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: "right" };
      }
      writeDateCell(ws.getCell(row.number, 8), inv.issueDate);
      writeDateCell(ws.getCell(row.number, 9), inv.dueDate);
      invRowCount++;
    }
    counts.invoices = invRowCount;
    styleSheet(ws, locale);
    autoWidth(ws);
    applyDataStyling(ws, invRowCount);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SHEET — Attachments (metadata only — no embedded files)
  // ═══════════════════════════════════════════════════════════════════════════
  if (items.includes("attachments")) {
    const ws = wb.addWorksheet(SHEET_NAMES.attachments(locale));
    const headers = HEADERS.attachments(locale);
    ws.columns = headers.map((h) => ({ header: h, key: h }));

    // Gather attachments from:
    //  1. Trainee.documents (JSON array)
    //  2. Trainee.idAttachmentUrl (legacy single field)
    //  3. TrainingRequest.documents (JSON array)
    type AttachmentRow = {
      fileName: string; fileType: string; category: string;
      traineeName: string; requestRef: string;
      uploadedAt: string; url: string;
    };
    const rows: AttachmentRow[] = [];

    // Helper: extract a human-readable filename from the stored JSON.
    // The upload handler stores both `filename` (random hex) and `originalName`
    // (the real file name). Prefer originalName; fall back to filename; if
    // neither is available, extract from the URL path.
    function getDisplayName(doc: { filename?: string; originalName?: string; url?: string }): string {
      if (doc.originalName && doc.originalName.length > 0) return doc.originalName;
      if (doc.filename && doc.filename.length > 0 && !/^[a-f0-9]{32}\./.test(doc.filename)) return doc.filename;
      // If filename is a random hex hash, try to extract from URL
      const urlParts = doc.url?.split("/") ?? [];
      const lastPart = urlParts[urlParts.length - 1] ?? "attachment";
      // If even the URL part is a hex hash, show a generic name with extension
      if (/^[a-f0-9]{32}\./.test(lastPart)) {
        const ext = lastPart.split(".").pop() ?? "file";
        return `Attachment.${ext}`;
      }
      return lastPart;
    }

    // 1. Trainee documents
    const traineeAttachWhere: Record<string, unknown> = { deletedAt: null };
    if (companyId) traineeAttachWhere.companyId = companyId;
    const traineesForAttachments = await db.trainee.findMany({
      where: traineeAttachWhere,
      select: {
        fullName: true, nationalId: true, documents: true,
        idAttachmentUrl: true,
      },
    });
    // Fetch trainee→requestRef map separately
    const traineeRequestMap = new Map<string, string>();
    if (traineesForAttachments.length > 0) {
      const traineeIds = traineesForAttachments.map((t) => t.nationalId);
      // Use junction table to find which request each trainee belongs to
      const junctions = await db.trainingRequestCourseTrainee.findMany({
        where: { trainee: { nationalId: { in: traineeIds } }, deletedAt: null },
        select: {
          trainee: { select: { nationalId: true } },
          requestCourse: { select: { request: { select: { refNumber: true } } } },
        },
      });
      for (const j of junctions) {
        if (!traineeRequestMap.has(j.trainee.nationalId)) {
          traineeRequestMap.set(j.trainee.nationalId, j.requestCourse.request.refNumber);
        }
      }
    }
    for (const t of traineesForAttachments) {
      const reqRef = traineeRequestMap.get(t.nationalId) ?? "";
      if (t.idAttachmentUrl) {
        const fileName = getDisplayName({ url: t.idAttachmentUrl });
        const ext = (t.idAttachmentUrl.split(".").pop() ?? "FILE").toUpperCase();
        rows.push({
          fileName,
          fileType: ext,
          category: locale === "ar" ? "هوية" : "ID",
          traineeName: t.fullName,
          requestRef: reqRef,
          uploadedAt: "",
          url: t.idAttachmentUrl,
        });
      }
      if (t.documents) {
        try {
          const docs = JSON.parse(t.documents) as Array<{
            url?: string; filename?: string; originalName?: string; type?: string; uploadedAt?: string;
          }>;
          for (const d of docs) {
            if (!d.url) continue;
            const fileName = getDisplayName(d);
            const ext = (d.url.split(".").pop() ?? "FILE").toUpperCase();
            rows.push({
              fileName,
              fileType: ext,
              category: d.type ?? (locale === "ar" ? "مرفق" : "Attachment"),
              traineeName: t.fullName,
              requestRef: reqRef,
              uploadedAt: d.uploadedAt ?? "",
              url: d.url,
            });
          }
        } catch {
          // ignore malformed JSON
        }
      }
    }

    // 2. TrainingRequest documents — filter by scope
    const requestsForAttachments = await db.trainingRequest.findMany({
      where: reqWhere,
      select: { refNumber: true, documents: true, createdAt: true },
    });
    for (const r of requestsForAttachments) {
      if (!r.documents) continue;
      try {
        const docs = JSON.parse(r.documents) as Array<{
          url?: string; filename?: string; originalName?: string; type?: string; uploadedAt?: string;
        }>;
        for (const d of docs) {
          if (!d.url) continue;
          const fileName = getDisplayName(d);
          const ext = (d.url.split(".").pop() ?? "FILE").toUpperCase();
          rows.push({
            fileName,
            fileType: ext,
            category: d.type ?? (locale === "ar" ? "طلب" : "Request"),
            traineeName: "",
            requestRef: r.refNumber,
            uploadedAt: d.uploadedAt ?? r.createdAt.toISOString(),
            url: d.url,
          });
        }
      } catch {
        // ignore malformed JSON
      }
    }

    let attRowCount = 0;
    // Build the base URL for attachment hyperlinks.
    //
    // The URL must point to wherever the app is actually serving files —
    // the exported Excel should open attachments from the SAME server that
    // generated the export. We build the URL from the request's own host
    // (via reverse-proxy-aware headers), with a final fallback to the
    // production domain.
    //
    // Priority:
    //   1. x-forwarded-proto + x-forwarded-host (Render / load balancer)
    //   2. Host header (direct access)
    //   3. APP_URL env var (if set and not localhost/0.0.0.0)
    //   4. Hardcoded production URL (last resort)
    const PRODUCTION_URL = "https://trainflow-tms.onrender.com";

    const fwdProto = req.headers.get("x-forwarded-proto") || "https";
    const fwdHost = req.headers.get("x-forwarded-host");
    const hostHeader = req.headers.get("host");
    const envUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;

    let baseUrl: string;
    if (fwdHost && !fwdHost.includes("0.0.0.0")) {
      // Reverse proxy (Render, nginx, etc.) — trust x-forwarded-host
      // but reject 0.0.0.0 (Render's internal bind address)
      baseUrl = `${fwdProto}://${fwdHost}`;
    } else if (hostHeader && !hostHeader.includes("0.0.0.0")) {
      // Direct host header (includes localhost in dev — that's fine,
      // the files ARE on localhost in dev mode)
      baseUrl = `${req.nextUrl.protocol.replace(":", "")}://${hostHeader}`;
    } else if (envUrl && !envUrl.includes("0.0.0.0") && !envUrl.includes("fcapp.run")) {
      // Env var
      baseUrl = envUrl;
    } else {
      // Last resort: production URL
      baseUrl = PRODUCTION_URL;
    }
    baseUrl = baseUrl.replace(/\/+$/, "");

    for (const a of rows) {
      // Build the URL from the base + relative path.
      // Strip any existing host from stored URLs (handles stale absolute URLs).
      const relativePath = a.url.replace(/^https?:\/\/[^/]+/, "");
      const fullUrl = `${baseUrl}${relativePath.startsWith("/") ? "" : "/"}${relativePath}`;
      const row = ws.addRow([
        a.fileName,
        a.fileType,
        a.category,
        a.traineeName,
        a.requestRef,
        "", // uploadedAt as date
        fullUrl,
      ]);
      writeDateCell(ws.getCell(row.number, 6), a.uploadedAt ? new Date(a.uploadedAt) : null, true);
      writeIdCell(ws, row, 5, a.requestRef);
      // Make URL cell a clickable hyperlink
      const urlCell = ws.getCell(row.number, 7);
      urlCell.value = { text: fullUrl, hyperlink: fullUrl };
      urlCell.font = { color: { argb: "FF0563C1" }, underline: true };
      attRowCount++;
    }
    counts.attachments = attRowCount;
    styleSheet(ws, locale);
    autoWidth(ws, { wrapCols: new Set([1, 7]) });
    applyDataStyling(ws, attRowCount);
    if (attRowCount > 0) {
      for (let r = 2; r <= attRowCount + 1; r++) {
        ws.getCell(r, 1).alignment = { vertical: "middle", wrapText: true };
        ws.getCell(r, 7).alignment = { vertical: "middle", wrapText: true };
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Populate Summary sheet content (now that all counts are known)
  // ═══════════════════════════════════════════════════════════════════════════
  const exportedItemsList = items
    .filter((i) => itemLabels[i])
    .map((i) => `• ${itemLabels[i][locale]}`)
    .join("\n");

  const summaryRows: Array<[string, string | number]> = [
    [locale === "ar" ? "اسم الشركة" : "Company Name", companyName],
    [locale === "ar" ? "تاريخ ووقت التصدير" : "Export Date & Time", new Date().toLocaleString(locale === "ar" ? "ar-SA" : "en-US")],
    [locale === "ar" ? "اسم المستخدم" : "Exported By", user.fullName ?? user.email ?? ""],
    [locale === "ar" ? "نطاق التصدير" : "Export Scope", scopeLabels[scope] ?? scope],
    [locale === "ar" ? "اللغة" : "Language", locale === "ar" ? "العربية" : "English"],
    [locale === "ar" ? "عدد الطلبات" : "Training Requests Count", counts.requests],
    [locale === "ar" ? "عدد المتدربين" : "Trainees Count", counts.trainees],
    [locale === "ar" ? "عدد الدورات" : "Courses Count", counts.courses],
    [locale === "ar" ? "عدد سجلات الحضور" : "Attendance Records", counts.attendance],
    [locale === "ar" ? "عدد نتائج التقييم" : "Assessment Results Count", counts.results],
    [locale === "ar" ? "عدد التقييمات" : "Evaluations Count", counts.evaluations],
    [locale === "ar" ? "عدد الشهادات" : "Certificates Count", counts.certificates],
    [locale === "ar" ? "عدد الفواتير" : "Invoices Count", counts.invoices],
    [locale === "ar" ? "عدد المرفقات" : "Attachments Count", counts.attachments],
    [locale === "ar" ? "العناصر المُصدّرة" : "Exported Items", exportedItemsList],
  ];

  // Add a title row above headers
  summaryWs.spliceRows(1, 0, []);
  const titleRow = summaryWs.getRow(1);
  titleRow.getCell(1).value = locale === "ar" ? "ملخص التصدير" : "Export Summary";
  titleRow.font = { bold: true, size: 16, color: { argb: HEADER_FONT_COLOR } };
  titleRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  titleRow.alignment = { vertical: "middle", horizontal: "center" };
  titleRow.height = 32;
  summaryWs.mergeCells("A1:B1");

  // Now row 2 is the column header row
  const headerRow = summaryWs.getRow(2);
  headerRow.font = { bold: true, size: 11, color: { argb: HEADER_FONT_COLOR } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };
  headerRow.height = 24;
  headerRow.border = {
    top: { style: "thin", color: { argb: BORDER_COLOR } },
    bottom: { style: "medium", color: { argb: BORDER_COLOR } },
    left: { style: "thin", color: { argb: BORDER_COLOR } },
    right: { style: "thin", color: { argb: BORDER_COLOR } },
  };

  // Data rows
  for (let i = 0; i < summaryRows.length; i++) {
    const [label, value] = summaryRows[i];
    const r = summaryWs.getRow(i + 3);
    r.getCell(1).value = label;
    r.getCell(2).value = value;
    r.alignment = { vertical: "middle", wrapText: label === (locale === "ar" ? "العناصر المُصدّرة" : "Exported Items") };
    r.border = {
      top: { style: "thin", color: { argb: BORDER_COLOR } },
      bottom: { style: "thin", color: { argb: BORDER_COLOR } },
      left: { style: "thin", color: { argb: BORDER_COLOR } },
      right: { style: "thin", color: { argb: BORDER_COLOR } },
    };
    r.getCell(1).font = { bold: true, size: 11 };
    r.getCell(2).font = { size: 11 };
    if (i % 2 === 1) {
      r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF6F8FA" } };
    }
  }

  // Column widths
  summaryWs.getColumn(1).width = 32;
  summaryWs.getColumn(2).width = 60;

  // Freeze title + header
  const summaryView: Partial<ExcelJS.WorksheetView> = { state: "frozen", ySplit: 2 };
  if (locale === "ar") summaryView.rightToLeft = true;
  summaryWs.views = [summaryView as ExcelJS.WorksheetView];

  // Page setup for Summary
  summaryWs.pageSetup.orientation = "portrait";
  summaryWs.pageSetup.fitToPage = true;
  summaryWs.pageSetup.fitToWidth = 1;
  summaryWs.pageSetup.fitToHeight = 1;

  // Set active sheet to Summary
  summaryWs.views = summaryWs.views; // ensure applied
  wb.views = wb.views; // ensure workbook views applied

  // ── Generate buffer ──
  const buffer = await wb.xlsx.writeBuffer();
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const scopeTag = scope === "specific_course" && scopeCourseTitle
    ? `-${scopeCourseTitle.replace(/\s+/g, "_").slice(0, 30)}`
    : `-${scope}`;
  const filename = `gcclab-export${scopeTag}-${locale}-${stamp}.xlsx`;

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
};
