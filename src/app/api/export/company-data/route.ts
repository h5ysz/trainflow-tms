// /api/export/company-data — export company data as a professional Excel file
//
// Query params:
//   scope: last | specific_request | specific_course | date_range | all
//   items: comma-separated (requests, trainees, attendance, results, evaluations, certificates, invoices, attachments)
//   format: excel | pdf | zip (currently only excel is fully implemented)
//   locale: en | ar (controls column header language)
//   specificId?: string
//   dateFrom?: string
//   dateTo?: string
//
// Returns: .xlsx file download with styled headers, auto-width, text-formatted IDs.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, fail } from "@/lib/auth/api";
import ExcelJS from "exceljs";

const isAr = (locale: string) => locale === "ar";

const HEADERS = {
  requests: (ar: boolean) => [
    ar ? "رقم الطلب" : "Request #",
    ar ? "الشركة" : "Company",
    ar ? "الدورة" : "Course",
    ar ? "الحالة" : "Status",
    ar ? "الأولوية" : "Priority",
    ar ? "عدد المتدربين" : "Trainee Count",
    ar ? "التاريخ المبدئي من" : "Preferred From",
    ar ? "التاريخ المبدئي إلى" : "Preferred To",
    ar ? "الموقع" : "Location",
    ar ? "اللغة" : "Language",
    ar ? "الملاحظات" : "Notes",
    ar ? "تاريخ الإنشاء" : "Created At",
  ],
  trainees: (ar: boolean) => [
    ar ? "اسم المتدرب" : "Full Name",
    ar ? "رقم الهوية" : "National ID",
    ar ? "الجنسية" : "Nationality",
    ar ? "المهنة" : "Job Title",
    ar ? "الجوال" : "Mobile",
    ar ? "البريد" : "Email",
    ar ? "الطلب المرتبط" : "Request #",
  ],
  attendance: (ar: boolean) => [
    ar ? "الجلسة" : "Session #",
    ar ? "اسم المتدرب" : "Trainee Name",
    ar ? "الحالة" : "Status",
    ar ? "تاريخ الحضور" : "Check-in",
    ar ? "تاريخ المغادرة" : "Check-out",
  ],
  results: (ar: boolean) => [
    ar ? "الجلسة" : "Session #",
    ar ? "اسم المتدرب" : "Trainee Name",
    ar ? "نوع الاختبار" : "Test Type",
    ar ? "النتيجة" : "Score %",
    ar ? "نجح/رسب" : "Passed",
    ar ? "التاريخ" : "Date",
  ],
  evaluations: (ar: boolean) => [
    ar ? "الجلسة" : "Session #",
    ar ? "اسم المتدرب" : "Trainee Name",
    ar ? "تقييم المدرب" : "Trainer Rating",
    ar ? "تقييم المحتوى" : "Content Rating",
    ar ? "التقييم العام" : "Overall Rating",
    ar ? "التعليقات" : "Comments",
  ],
  certificates: (ar: boolean) => [
    ar ? "رقم الشهادة" : "Certificate #",
    ar ? "الجلسة" : "Session #",
    ar ? "اسم المتدرب" : "Trainee Name",
    ar ? "النتيجة النهائية" : "Final Score",
    ar ? "تاريخ الإصدار" : "Issued At",
    ar ? "صالحة حتى" : "Valid Until",
    ar ? "الحالة" : "Status",
  ],
  invoices: (ar: boolean) => [
    ar ? "رقم الفاتورة" : "Invoice #",
    ar ? "المبلغ الإجمالي" : "Grand Total",
    ar ? "المبلغ المدفوع" : "Paid Amount",
    ar ? "الرصيد المتبقي" : "Outstanding",
    ar ? "العملة" : "Currency",
    ar ? "الحالة" : "Status",
    ar ? "تاريخ الإصدار" : "Issue Date",
  ],
};

function autoWidth(ws: ExcelJS.Worksheet) {
  ws.columns.forEach((col) => {
    let maxLen = 0;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const val = cell.value ? String(cell.value) : "";
      if (val.length > maxLen) maxLen = val.length;
    });
    col.width = Math.min(Math.max(maxLen + 3, 12), 50);
  });
}

function styleHeader(ws: ExcelJS.Worksheet) {
  const row = ws.getRow(1);
  row.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF4B0082" } };
  row.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  row.height = 24;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export const GET = async (req: NextRequest) => {
  const user = await requireAuth();
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "last";
  const items = (url.searchParams.get("items") || "").split(",").filter(Boolean);
  const locale = url.searchParams.get("locale") || "en";
  const specificId = url.searchParams.get("specificId");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");
  const ar = isAr(locale);

  if (items.length === 0) return fail("No items selected", 422, "VALIDATION_ERROR");
  if (!user.companyId) return fail("No company linked", 403);

  // Build where clause
  const where: Record<string, unknown> = { companyId: user.companyId, deletedAt: null };
  switch (scope) {
    case "last": {
      const last = await db.trainingRequest.findFirst({
        where: { companyId: user.companyId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (last) where.id = last.id;
      break;
    }
    case "specific_request":
      if (specificId) where.id = specificId;
      break;
    case "date_range":
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
        if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(dateTo);
      }
      break;
  }

  // Create workbook
  const wb = new ExcelJS.Workbook();
  wb.creator = "GCCLAB TMS";
  wb.created = new Date();

  // ── Sheet 1: Training Requests ──
  if (items.includes("requests")) {
    const ws = wb.addWorksheet(ar ? "طلبات التدريب" : "Training Requests");
    ws.columns = HEADERS.requests(ar).map((h) => ({ header: h, key: h }));
    const reqs = await db.trainingRequest.findMany({
      where,
      select: {
        refNumber: true, status: true, priority: true, traineeCount: true,
        preferredDateFrom: true, preferredDateTo: true, preferredLocation: true,
        preferredLanguage: true, notes: true, createdAt: true,
        company: { select: { name: true } },
        course: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    for (const r of reqs) {
      ws.addRow([
        r.refNumber, r.company?.name ?? "", r.course?.title ?? "",
        r.status, r.priority, r.traineeCount,
        fmtDate(r.preferredDateFrom), fmtDate(r.preferredDateTo),
        r.preferredLocation ?? "", r.preferredLanguage ?? "",
        r.notes ?? "", fmtDateTime(r.createdAt),
      ]);
    }
    styleHeader(ws);
    autoWidth(ws);
    // Format ID column as text
    ws.getColumn(1).numFmt = "@";
  }

  // ── Sheet 2: Trainees ──
  if (items.includes("trainees")) {
    const ws = wb.addWorksheet(ar ? "المتدربون" : "Trainees");
    ws.columns = HEADERS.trainees(ar).map((h) => ({ header: h, key: h }));
    const reqsWithTrainees = await db.trainingRequest.findMany({
      where,
      select: {
        refNumber: true,
        requestCourses: {
          where: { deletedAt: null },
          select: {
            trainees: {
              where: { deletedAt: null },
              include: {
                trainee: {
                  select: { fullName: true, nationalId: true, nationality: true, jobTitle: true, mobile: true, email: true },
                },
              },
            },
          },
        },
      },
    });
    for (const r of reqsWithTrainees) {
      for (const rc of r.requestCourses) {
        for (const trc of rc.trainees) {
          ws.addRow([
            trc.trainee.fullName, trc.trainee.nationalId,
            trc.trainee.nationality ?? "", trc.trainee.jobTitle ?? "",
            trc.trainee.mobile ?? "", trc.trainee.email ?? "",
            r.refNumber,
          ]);
        }
      }
    }
    styleHeader(ws);
    autoWidth(ws);
    // National ID as text
    ws.getColumn(2).numFmt = "@";
  }

  // ── Sheet: Attendance ──
  if (items.includes("attendance")) {
    const ws = wb.addWorksheet(ar ? "الحضور" : "Attendance");
    ws.columns = HEADERS.attendance(ar).map((h) => ({ header: h, key: h }));
    const sessions = await db.trainingSession.findMany({
      where: { request: { companyId: user.companyId, deletedAt: null } },
      select: {
        refNumber: true,
        attendance: { where: { deletedAt: null }, select: { traineeName: true, status: true, checkInAt: true, checkOutAt: true } },
      },
    });
    for (const s of sessions) {
      for (const a of s.attendance) {
        ws.addRow([s.refNumber, a.traineeName, a.status, fmtDateTime(a.checkInAt), fmtDateTime(a.checkOutAt)]);
      }
    }
    styleHeader(ws);
    autoWidth(ws);
  }

  // ── Sheet: Assessment Results ──
  if (items.includes("results")) {
    const ws = wb.addWorksheet(ar ? "النتائج" : "Assessment Results");
    ws.columns = HEADERS.results(ar).map((h) => ({ header: h, key: h }));
    const sessions = await db.trainingSession.findMany({
      where: { request: { companyId: user.companyId, deletedAt: null } },
      select: {
        refNumber: true,
        testResults: { where: { deletedAt: null }, select: { traineeName: true, testType: true, scorePercent: true, passed: true, attemptedAt: true } },
      },
    });
    for (const s of sessions) {
      for (const r of s.testResults) {
        ws.addRow([s.refNumber, r.traineeName, r.testType, r.scorePercent, r.passed ? (ar ? "ناجح" : "Yes") : (ar ? "راسب" : "No"), fmtDateTime(r.attemptedAt)]);
      }
    }
    styleHeader(ws);
    autoWidth(ws);
  }

  // ── Sheet: Evaluations ──
  if (items.includes("evaluations")) {
    const ws = wb.addWorksheet(ar ? "التقييمات" : "Evaluations");
    ws.columns = HEADERS.evaluations(ar).map((h) => ({ header: h, key: h }));
    const sessions = await db.trainingSession.findMany({
      where: { request: { companyId: user.companyId, deletedAt: null } },
      select: {
        refNumber: true,
        evaluations: { where: { deletedAt: null }, select: { traineeName: true, trainerRating: true, contentRating: true, overallRating: true, comments: true } },
      },
    });
    for (const s of sessions) {
      for (const e of s.evaluations) {
        ws.addRow([s.refNumber, e.traineeName, e.trainerRating, e.contentRating, e.overallRating, e.comments ?? ""]);
      }
    }
    styleHeader(ws);
    autoWidth(ws);
  }

  // ── Sheet: Certificates ──
  if (items.includes("certificates")) {
    const ws = wb.addWorksheet(ar ? "الشهادات" : "Certificates");
    ws.columns = HEADERS.certificates(ar).map((h) => ({ header: h, key: h }));
    const certs = await db.certificate.findMany({
      where: { companyId: user.companyId, deletedAt: null },
      select: { refNumber: true, sessionId: true, traineeName: true, finalScore: true, issuedAt: true, validUntil: true, status: true, session: { select: { refNumber: true } } },
      orderBy: { issuedAt: "desc" },
    });
    for (const c of certs) {
      ws.addRow([c.refNumber, c.session?.refNumber ?? "", c.traineeName, c.finalScore, fmtDate(c.issuedAt), fmtDate(c.validUntil), c.status]);
    }
    styleHeader(ws);
    autoWidth(ws);
  }

  // ── Sheet: Invoices ──
  if (items.includes("invoices")) {
    const ws = wb.addWorksheet(ar ? "الفواتير" : "Invoices");
    ws.columns = HEADERS.invoices(ar).map((h) => ({ header: h, key: h }));
    const invoices = await db.invoice.findMany({
      where: { companyId: user.companyId, deletedAt: null },
      select: { refNumber: true, grandTotal: true, paidAmount: true, outstandingBalance: true, currency: true, status: true, issueDate: true },
      orderBy: { issueDate: "desc" },
    });
    for (const inv of invoices) {
      ws.addRow([inv.refNumber, inv.grandTotal, inv.paidAmount, inv.outstandingBalance, inv.currency, inv.status, fmtDate(inv.issueDate)]);
    }
    styleHeader(ws);
    autoWidth(ws);
  }

  // Generate buffer
  const buffer = await wb.xlsx.writeBuffer();
  const filename = `export-${scope}-${Date.now()}.xlsx`;

  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
