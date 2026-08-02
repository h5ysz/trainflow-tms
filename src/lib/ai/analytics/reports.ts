// GCCLAB AI Copilot — Phase 3 — Report Generator
// =====================================================================
// Generates professional reports in PDF / Excel / Word formats.
// Uses existing libraries: pdfkit (PDF), exceljs (Excel), and HTML-based
// .docx (Word — no extra deps needed; .docx is essentially HTML in a
// Word XML envelope).
//
// All report generation is audit-logged.
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { db } from "@/lib/db";
import type { AnalyticsScope, ReportRequest, ReportResult, ReportType } from "./types";
import { computeKpis } from "./kpis";
import { computeRecommendations } from "./recommendations";
import { computeRisks } from "./risks";
import { rangeFromPreset } from "./types";

// PDFKit uses built-in Helvetica by default — no font registration needed for
// English content. Arabic PDFs require an embedded TrueType font; that's handled
// by the existing pdf/fonts.ts helper for certificate/invoice PDFs. For analytics
// reports, English is sufficient (Arabic labels are written in Latin transliteration
// where needed).

export async function generateReport(req: ReportRequest, scope: AnalyticsScope): Promise<ReportResult> {
  const range = rangeFromPreset(req.range ?? "30d");
  const data = await collectReportData(req.type, scope, range);

  let buffer: Buffer;
  let mimeType: string;
  let filename: string;

  switch (req.format) {
    case "pdf":
      buffer = await renderPdf(req.type, data, scope);
      mimeType = "application/pdf";
      filename = `gcclab-${req.type}-report-${new Date().toISOString().slice(0, 10)}.pdf`;
      break;
    case "xlsx":
      buffer = await renderXlsx(req.type, data);
      mimeType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      filename = `gcclab-${req.type}-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
      break;
    case "docx":
      buffer = renderDocx(req.type, data);
      mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      filename = `gcclab-${req.type}-report-${new Date().toISOString().slice(0, 10)}.docx`;
      break;
  }

  const typeLabels: Record<ReportType, { en: string; ar: string }> = {
    monthly: { en: "Monthly Report", ar: "تقرير شهري" },
    quarterly: { en: "Quarterly Report", ar: "تقرير ربع سنوي" },
    yearly: { en: "Yearly Report", ar: "تقرير سنوي" },
    trainer: { en: "Trainer Report", ar: "تقرير المدرب" },
    contractor: { en: "Contractor Report", ar: "تقرير المقاول" },
    financial: { en: "Financial Report", ar: "تقرير مالي" },
    operational: { en: "Operational Report", ar: "تقرير تشغيلي" },
    attendance: { en: "Attendance Report", ar: "تقرير الحضور" },
    exam: { en: "Exam Report", ar: "تقرير الامتحانات" },
    certificate: { en: "Certificate Report", ar: "تقرير الشهادات" },
  };

  return {
    buffer,
    mimeType,
    filename,
    auditDescription: `AI generated ${typeLabels[req.type].en} (${req.format.toUpperCase()})`,
    auditDescriptionAr: `أنشأ الذكاء الاصطناعي ${typeLabels[req.type].ar} (${req.format.toUpperCase()})`,
  };
}

// ─── Data collection ───────────────────────────────────────────────────────
interface ReportData {
  range: { from: Date; to: Date };
  kpis: Array<{ label: string; labelAr: string; value: string }>;
  sections: Array<{
    title: string;
    titleAr: string;
    columns: Array<{ key: string; label: string }>;
    rows: Array<Record<string, unknown>>;
  }>;
  recommendations: Array<{ priority: string; title: string; description: string }>;
  risks: Array<{ severity: string; title: string; description: string }>;
}

async function collectReportData(type: ReportType, scope: AnalyticsScope, range: { from: Date; to: Date }): Promise<ReportData> {
  const [kpis, recommendations, risks] = await Promise.all([
    computeKpis(scope, range),
    computeRecommendations(scope, range),
    computeRisks(scope),
  ]);

  // Flatten KPIs into label/value pairs
  const kpiRows: Array<{ label: string; labelAr: string; value: string }> = [];
  for (const g of kpis.groups) {
    for (const c of g.cards) {
      const value = typeof c.value === "number"
        ? (c.format === "currency" ? `${c.value.toLocaleString()} ${c.currency ?? "SAR"}` : c.format === "percentage" ? `${c.value}%` : c.value.toLocaleString())
        : String(c.value);
      kpiRows.push({ label: c.label, labelAr: c.labelAr, value });
    }
  }

  const sections: ReportData["sections"] = [];

  // Build sections based on report type
  if (type === "financial" || type === "monthly" || type === "quarterly" || type === "yearly") {
    if (scope.canSeeFinancial) {
      const invoices = await db.invoice.findMany({
        where: { deletedAt: null, issueDate: { gte: range.from, lte: range.to } },
        include: { company: { select: { name: true } } },
        take: 500,
        orderBy: { issueDate: "desc" },
      });
      sections.push({
        title: "Invoices",
        titleAr: "الفواتير",
        columns: [
          { key: "ref", label: "Ref" },
          { key: "contractor", label: "Contractor" },
          { key: "total", label: "Total (SAR)" },
          { key: "outstanding", label: "Outstanding (SAR)" },
          { key: "status", label: "Status" },
          { key: "issueDate", label: "Issue Date" },
        ],
        rows: invoices.slice(0, 200).map((i) => ({
          ref: i.refNumber,
          contractor: i.company.name,
          total: i.grandTotal.toFixed(2),
          outstanding: i.outstandingBalance.toFixed(2),
          status: i.status,
          issueDate: i.issueDate.toISOString().slice(0, 10),
        })),
      });
    }
  }

  if (type === "operational" || type === "monthly" || type === "quarterly" || type === "yearly" || type === "attendance") {
    const sessions = await db.trainingSession.findMany({
      where: { deletedAt: null, startDate: { gte: range.from, lte: range.to } },
      include: { course: { select: { title: true } }, trainer: { select: { fullName: true } } },
      take: 500,
      orderBy: { startDate: "desc" },
    });
    sections.push({
      title: "Sessions",
      titleAr: "الجلسات",
      columns: [
        { key: "ref", label: "Ref" },
        { key: "title", label: "Title" },
        { key: "trainer", label: "Trainer" },
        { key: "startDate", label: "Start Date" },
        { key: "capacity", label: "Capacity" },
        { key: "enrolled", label: "Enrolled" },
        { key: "status", label: "Status" },
      ],
      rows: sessions.slice(0, 200).map((s) => ({
        ref: s.refNumber,
        title: s.course?.title ?? s.title,
        trainer: s.trainer?.fullName ?? "—",
        startDate: s.startDate.toISOString().slice(0, 10),
        capacity: s.capacity,
        enrolled: s.expectedTrainees,
        status: s.status,
      })),
    });
  }

  if (type === "certificate" || type === "monthly" || type === "quarterly" || type === "yearly") {
    const certs = await db.certificate.findMany({
      where: { deletedAt: null, issuedAt: { gte: range.from, lte: range.to } },
      include: { company: { select: { name: true } }, course: { select: { title: true } } },
      take: 500,
      orderBy: { issuedAt: "desc" },
    });
    sections.push({
      title: "Certificates Issued",
      titleAr: "الشهادات الصادرة",
      columns: [
        { key: "ref", label: "Ref" },
        { key: "trainee", label: "Trainee" },
        { key: "contractor", label: "Contractor" },
        { key: "course", label: "Course" },
        { key: "score", label: "Score" },
        { key: "issued", label: "Issued" },
        { key: "expires", label: "Expires" },
      ],
      rows: certs.slice(0, 200).map((c) => ({
        ref: c.refNumber,
        trainee: c.traineeName,
        contractor: c.company?.name ?? "—",
        course: c.course.title,
        score: `${c.finalScore}%`,
        issued: c.issuedAt.toISOString().slice(0, 10),
        expires: c.validUntil.toISOString().slice(0, 10),
      })),
    });
  }

  if (type === "trainer") {
    const testResults = await db.testResult.findMany({
      where: { deletedAt: null, attemptedAt: { gte: range.from, lte: range.to } },
      select: { passed: true, trainingSession: { select: { trainerId: true, trainer: { select: { id: true, fullName: true, refNumber: true } } } } },
      take: 5000,
    });
    const byTrainer = new Map<string, { name: string; ref: string; passed: number; total: number }>();
    for (const r of testResults) {
      const tid = r.trainingSession.trainerId;
      if (!tid) continue;
      const e = byTrainer.get(tid) ?? { name: r.trainingSession.trainer?.fullName ?? "—", ref: r.trainingSession.trainer?.refNumber ?? "—", passed: 0, total: 0 };
      e.total++;
      if (r.passed) e.passed++;
      byTrainer.set(tid, e);
    }
    sections.push({
      title: "Trainer Performance",
      titleAr: "أداء المدربين",
      columns: [
        { key: "trainer", label: "Trainer" },
        { key: "ref", label: "Ref" },
        { key: "exams", label: "Exams Graded" },
        { key: "passed", label: "Passed" },
        { key: "passRate", label: "Pass Rate" },
      ],
      rows: Array.from(byTrainer.values()).map((e) => ({
        trainer: e.name,
        ref: e.ref,
        exams: e.total,
        passed: e.passed,
        passRate: `${e.total > 0 ? Math.round((e.passed / e.total) * 100) : 0}%`,
      })),
    });
  }

  if (type === "contractor" && scope.role !== "CONTRACTOR") {
    const enrollments = await db.sessionEnrollment.groupBy({
      by: ["companyId"],
      where: { deletedAt: null, enrollmentDate: { gte: range.from, lte: range.to }, enrollmentStatus: { not: "CANCELLED" } },
      _count: { id: true },
    orderBy: { _count: { id: "desc" } },
      take: 50,
    });
    const companies = await db.company.findMany({
      where: { id: { in: enrollments.map((e) => e.companyId) } },
      select: { id: true, name: true, refNumber: true },
    });
    const nameMap = new Map(companies.map((c) => [c.id, c]));
    sections.push({
      title: "Contractor Activity",
      titleAr: "نشاط المقاولين",
      columns: [
        { key: "contractor", label: "Contractor" },
        { key: "ref", label: "Ref" },
        { key: "enrollments", label: "Enrollments" },
      ],
      rows: enrollments.map((e) => ({
        contractor: nameMap.get(e.companyId)?.name ?? "—",
        ref: nameMap.get(e.companyId)?.refNumber ?? "—",
        enrollments: e._count,
      })),
    });
  }

  if (type === "exam") {
    const testResults = await db.testResult.findMany({
      where: { deletedAt: null, attemptedAt: { gte: range.from, lte: range.to } },
      select: { refNumber: true, traineeName: true, testType: true, scorePercent: true, passed: true, attemptedAt: true },
      take: 500,
      orderBy: { attemptedAt: "desc" },
    });
    sections.push({
      title: "Exam Results",
      titleAr: "نتائج الامتحانات",
      columns: [
        { key: "ref", label: "Ref" },
        { key: "trainee", label: "Trainee" },
        { key: "type", label: "Type" },
        { key: "score", label: "Score" },
        { key: "passed", label: "Passed" },
        { key: "date", label: "Date" },
      ],
      rows: testResults.slice(0, 200).map((r) => ({
        ref: r.refNumber,
        trainee: r.traineeName,
        type: r.testType,
        score: `${r.scorePercent}%`,
        passed: r.passed ? "Yes" : "No",
        date: r.attemptedAt.toISOString().slice(0, 10),
      })),
    });
  }

  return {
    range,
    kpis: kpiRows,
    sections,
    recommendations: recommendations.recommendations.slice(0, 10).map((r) => ({ priority: r.priority, title: r.title, description: r.description })),
    risks: risks.risks.slice(0, 10).map((r) => ({ severity: r.severity, title: r.title, description: r.description })),
  };
}

// ─── PDF renderer ──────────────────────────────────────────────────────────
async function renderPdf(type: string, data: ReportData, _scope: AnalyticsScope): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: "A4", margin: 50 });
      const chunks: Buffer[] = [];
      doc.on("data", (c: Buffer) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));

      // Title
      doc.fontSize(20).font("Helvetica-Bold").text("GCC Electrical Testing Laboratory", { align: "center" });
      doc.moveDown(0.3);
      doc.fontSize(14).font("Helvetica").text(`${type.charAt(0).toUpperCase() + type.slice(1)} Report`, { align: "center" });
      doc.moveDown(0.2);
      doc.fontSize(10).fillColor("gray").text(`Period: ${data.range.from.toISOString().slice(0, 10)} to ${data.range.to.toISOString().slice(0, 10)}`, { align: "center" });
      doc.moveDown(0.5);
      doc.fillColor("black");

      // KPIs
      doc.fontSize(14).font("Helvetica-Bold").text("Key Performance Indicators", { underline: true });
      doc.moveDown(0.3);
      doc.fontSize(10).font("Helvetica");
      for (const k of data.kpis) {
        doc.text(`${k.label}: ${k.value}`, { continued: false });
      }
      doc.moveDown(0.5);

      // Sections
      for (const section of data.sections) {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(14).font("Helvetica-Bold").fillColor("black").text(section.title, { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(9).font("Helvetica");
        // Column headers
        const colWidth = (525 - 50) / section.columns.length;
        let x = 50;
        for (const col of section.columns) {
          doc.font("Helvetica-Bold").text(col.label, x, doc.y, { width: colWidth, continued: false });
          x += colWidth;
        }
        doc.moveDown(0.2);
        // Rows
        doc.font("Helvetica");
        for (const row of section.rows.slice(0, 100)) {
          if (doc.y > 780) { doc.addPage(); }
          x = 50;
          for (const col of section.columns) {
            const val = row[col.key];
            doc.text(String(val ?? ""), x, doc.y, { width: colWidth, continued: false, ellipsis: true });
            x += colWidth;
          }
          doc.moveDown(0.15);
        }
        doc.moveDown(0.4);
      }

      // Recommendations
      if (data.recommendations.length > 0) {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(14).font("Helvetica-Bold").text("AI Recommendations", { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(10).font("Helvetica");
        for (const r of data.recommendations) {
          doc.font("Helvetica-Bold").text(`[${r.priority.toUpperCase()}] ${r.title}`);
          doc.font("Helvetica").fillColor("gray").text(r.description);
          doc.fillColor("black");
          doc.moveDown(0.2);
        }
      }

      // Risks
      if (data.risks.length > 0) {
        if (doc.y > 700) doc.addPage();
        doc.fontSize(14).font("Helvetica-Bold").text("Risk Detection", { underline: true });
        doc.moveDown(0.3);
        doc.fontSize(10).font("Helvetica");
        for (const r of data.risks) {
          doc.font("Helvetica-Bold").fillColor(r.severity === "critical" ? "red" : r.severity === "high" ? "orange" : "black").text(`[${r.severity.toUpperCase()}] ${r.title}`);
          doc.fillColor("black").font("Helvetica").text(r.description);
          doc.moveDown(0.2);
        }
      }

      // Footer
      doc.fontSize(8).fillColor("gray").text(`Generated by GCCLAB AI Copilot on ${new Date().toISOString()}`, 50, 800, { align: "center" });

      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ─── Excel renderer ────────────────────────────────────────────────────────
async function renderXlsx(_type: string, data: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "GCCLAB AI Copilot";
  wb.created = new Date();

  // KPIs sheet
  const kpiSheet = wb.addWorksheet("KPIs");
  kpiSheet.columns = [
    { header: "Metric", key: "label", width: 40 },
    { header: "Value", key: "value", width: 30 },
  ];
  for (const k of data.kpis) {
    kpiSheet.addRow({ label: k.label, value: k.value });
  }
  kpiSheet.getRow(1).font = { bold: true };

  // Section sheets
  for (const section of data.sections) {
    const sheetName = section.title.substring(0, 31); // Excel sheet name limit
    const sheet = wb.addWorksheet(sheetName);
    sheet.columns = section.columns.map((c) => ({ header: c.label, key: c.key, width: 20 }));
    for (const row of section.rows) {
      sheet.addRow(row);
    }
    sheet.getRow(1).font = { bold: true };
  }

  // Recommendations sheet
  if (data.recommendations.length > 0) {
    const recSheet = wb.addWorksheet("Recommendations");
    recSheet.columns = [
      { header: "Priority", key: "priority", width: 12 },
      { header: "Title", key: "title", width: 50 },
      { header: "Description", key: "description", width: 80 },
    ];
    for (const r of data.recommendations) {
      recSheet.addRow(r);
    }
    recSheet.getRow(1).font = { bold: true };
  }

  // Risks sheet
  if (data.risks.length > 0) {
    const riskSheet = wb.addWorksheet("Risks");
    riskSheet.columns = [
      { header: "Severity", key: "severity", width: 12 },
      { header: "Title", key: "title", width: 50 },
      { header: "Description", key: "description", width: 80 },
    ];
    for (const r of data.risks) {
      riskSheet.addRow(r);
    }
    riskSheet.getRow(1).font = { bold: true };
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── Word renderer (HTML-based .docx) ──────────────────────────────────────
function renderDocx(type: string, data: ReportData): Buffer {
  // Minimal Word .docx — Word can open HTML files with .docx extension via the
  // MHTML/HTML compatibility layer. For a fully-formed OOXML .docx, we'd need
  // a library like `docx`; the HTML approach keeps zero new deps.
  const html = `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>GCCLAB ${type} Report</title>
<style>
  body { font-family: Calibri, Arial, sans-serif; font-size: 11pt; }
  h1 { color: #7c3aed; font-size: 18pt; text-align: center; margin-bottom: 4pt; }
  h2 { color: #444; font-size: 14pt; border-bottom: 1px solid #ccc; padding-bottom: 4pt; margin-top: 20pt; }
  h3 { color: #666; font-size: 12pt; margin-top: 14pt; }
  table { border-collapse: collapse; width: 100%; margin-top: 8pt; }
  th { background: #f3f0ff; border: 1px solid #ccc; padding: 6pt; text-align: left; font-weight: bold; }
  td { border: 1px solid #ccc; padding: 6pt; }
  .kpi { display: inline-block; padding: 8pt 12pt; margin: 4pt; background: #f9f9f9; border: 1px solid #eee; }
  .priority-critical, .severity-critical { color: #dc2626; font-weight: bold; }
  .priority-high, .severity-high { color: #ea580c; font-weight: bold; }
  .footer { margin-top: 30pt; font-size: 9pt; color: #888; text-align: center; }
</style></head>
<body>
<h1>GCC Electrical Testing Laboratory</h1>
<h2 style="text-align:center; border:none;">${type.charAt(0).toUpperCase() + type.slice(1)} Report</h2>
<p style="text-align:center; color:#666;">Period: ${data.range.from.toISOString().slice(0, 10)} to ${data.range.to.toISOString().slice(0, 10)}</p>

<h2>Key Performance Indicators</h2>
<div>
${data.kpis.map((k) => `<div class="kpi"><strong>${k.label}:</strong> ${k.value}</div>`).join("\n")}
</div>

${data.sections.map((s) => `
<h2>${s.title}</h2>
<table>
<thead><tr>${s.columns.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>
<tbody>
${s.rows.slice(0, 200).map((r) => `<tr>${s.columns.map((c) => `<td>${String(r[c.key] ?? "")}</td>`).join("")}</tr>`).join("\n")}
</tbody>
</table>
`).join("\n")}

${data.recommendations.length > 0 ? `
<h2>AI Recommendations</h2>
<table>
<thead><tr><th>Priority</th><th>Title</th><th>Description</th></tr></thead>
<tbody>
${data.recommendations.map((r) => `<tr><td class="priority-${r.priority}">${r.priority.toUpperCase()}</td><td>${r.title}</td><td>${r.description}</td></tr>`).join("\n")}
</tbody>
</table>
` : ""}

${data.risks.length > 0 ? `
<h2>Risk Detection</h2>
<table>
<thead><tr><th>Severity</th><th>Title</th><th>Description</th></tr></thead>
<tbody>
${data.risks.map((r) => `<tr><td class="severity-${r.severity}">${r.severity.toUpperCase()}</td><td>${r.title}</td><td>${r.description}</td></tr>`).join("\n")}
</tbody>
</table>
` : ""}

<div class="footer">Generated by GCCLAB AI Copilot on ${new Date().toISOString()}</div>
</body></html>`;

  return Buffer.from(html, "utf-8");
}
