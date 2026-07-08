// GCCLAB TMS — Report Export Service
// =====================================================================
// Exports report data to Excel (.xlsx) or PDF using template-defined
// column layouts. The service is format-agnostic — it reads the
// template's column definitions and renders accordingly.
//
// New export formats can be added by implementing the Exporter interface.

import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import type { ReportTemplate, ReportDataRow, ReportColumn } from "./template-registry";

export interface ExportResult {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatCellValue(value: unknown, format?: ReportColumn["format"]): string | number | Date {
  if (value === null || value === undefined || value === "") return "";
  switch (format) {
    case "date":
      return value instanceof Date ? value.toLocaleDateString("en-GB") : String(value);
    case "datetime":
      return value instanceof Date ? value.toLocaleString("en-GB") : String(value);
    case "percentage":
      return typeof value === "number" ? `${value}%` : String(value);
    case "boolean":
      return value ? "Yes" : "No";
    case "number":
      return typeof value === "number" ? value : Number(value) || 0;
    default:
      return String(value);
  }
}

function generateFilename(template: ReportTemplate, format: string): string {
  const date = new Date().toISOString().slice(0, 10);
  return `${template.code}_${date}.${format}`;
}

// ── Excel Exporter ───────────────────────────────────────────────────

export async function exportToExcel(
  template: ReportTemplate,
  data: ReportDataRow[],
  filterInfo?: Record<string, string>
): Promise<ExportResult> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GCCLAB TMS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Report", {
    properties: { defaultColWidth: 15 },
  });

  // ── Title row ──
  const titleRow = sheet.addRow([template.title ?? template.name]);
  titleRow.height = 28;
  titleRow.font = { size: 14, bold: true, color: { argb: "FF0D9488" } };
  sheet.mergeCells(1, 1, 1, template.columns.length);

  // ── Filter info row ──
  if (filterInfo && Object.keys(filterInfo).length > 0) {
    const filterText = Object.entries(filterInfo)
      .map(([k, v]) => `${k}: ${v}`)
      .join("  |  ");
    const filterRow = sheet.addRow([filterText]);
    filterRow.font = { size: 9, italic: true, color: { argb: "FF666666" } };
    sheet.mergeCells(2, 1, 2, template.columns.length);
  }

  // ── Generated date row ──
  const dateRow = sheet.addRow([`Generated: ${new Date().toLocaleString("en-GB")}`]);
  dateRow.font = { size: 9, italic: true, color: { argb: "FF999999" } };
  sheet.mergeCells(filterInfo ? 3 : 2, 1, filterInfo ? 3 : 2, template.columns.length);

  // ── Empty spacer row ──
  sheet.addRow([]);

  // ── Column headers ──
  const headerRowIndex = (filterInfo ? 4 : 3) + 1;
  const headerRow = sheet.addRow(template.columns.map((c) => c.header));
  headerRow.height = 22;
  headerRow.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0D9488" },
  };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.border = {
    bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
  };

  // Set column widths
  template.columns.forEach((col, idx) => {
    const cell = sheet.getColumn(idx + 1);
    cell.width = col.width ?? 15;
  });

  // ── Data rows ──
  // If groupByCompany, group rows and add company header rows
  if (template.groupByCompany) {
    const grouped = new Map<string, ReportDataRow[]>();
    for (const row of data) {
      const key = (row.companyName as string) || "—";
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(row);
    }

    for (const [companyName, companyRows] of grouped) {
      // Company header row
      const companyRow = sheet.addRow([`Company: ${companyName} (${companyRows.length} trainees)`]);
      companyRow.font = { bold: true, size: 10, color: { argb: "FF0D9488" } };
      companyRow.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE6F7F5" },
      };
      sheet.mergeCells(companyRow.number, 1, companyRow.number, template.columns.length);

      // Data rows for this company
      for (const row of companyRows) {
        const dataRow = sheet.addRow(
          template.columns.map((col) => formatCellValue(row[col.key], col.format))
        );
        dataRow.font = { size: 10 };
        dataRow.border = {
          bottom: { style: "hair", color: { argb: "FFEEEEEE" } },
        };
      }

      // Spacer
      sheet.addRow([]);
    }
  } else {
    // Flat data rows (no grouping)
    for (const row of data) {
      const dataRow = sheet.addRow(
        template.columns.map((col) => formatCellValue(row[col.key], col.format))
      );
      dataRow.font = { size: 10 };
      dataRow.border = {
        bottom: { style: "hair", color: { argb: "FFEEEEEE" } },
      };
    }
  }

  // ── Summary row ──
  sheet.addRow([]);
  const summaryRow = sheet.addRow([`Total Trainees: ${data.length}`]);
  summaryRow.font = { bold: true, size: 10 };

  // ── Freeze header ──
  sheet.views = [{ state: "frozen", ySplit: headerRowIndex }];

  // ── Generate buffer ──
  const buffer = await workbook.xlsx.writeBuffer();
  return {
    buffer: Buffer.from(buffer),
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    filename: generateFilename(template, "xlsx"),
  };
}

// ── PDF Exporter ─────────────────────────────────────────────────────

// Monkey-patch pdfkit's font loading to resolve from the correct path.
// In Turbopack/Next.js bundled environments, __dirname resolves to /ROOT
// instead of the actual node_modules path, causing ENOENT errors.
// We patch the GLOBAL fs module so pdfkit's internal require('fs') picks it up.
/* eslint-disable @typescript-eslint/no-require-imports */
try {
  const nodePath = require("path");
  const realDataDir = nodePath.join(process.cwd(), "node_modules", "pdfkit", "js", "data");
  const fsModule = require("fs");
  if (fsModule.existsSync(realDataDir)) {
    const originalReadFileSync = fsModule.readFileSync;
    fsModule.readFileSync = function (filePath: string, ...args: any[]) {
      if (
        typeof filePath === "string" &&
        filePath.includes("/data/") &&
        filePath.endsWith(".afm") &&
        !fsModule.existsSync(filePath)
      ) {
        const filename = nodePath.basename(filePath);
        const correctedPath = nodePath.join(realDataDir, filename);
        if (fsModule.existsSync(correctedPath)) {
          return originalReadFileSync(correctedPath, ...args);
        }
      }
      return originalReadFileSync(filePath, ...args);
    };
  }
} catch {
  // ignore — will fall back to default
}
/* eslint-enable @typescript-eslint/no-require-imports */

export async function exportToPdf(
  template: ReportTemplate,
  data: ReportDataRow[],
  filterInfo?: Record<string, string>
): Promise<ExportResult> {
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margins: { top: 50, bottom: 50, left: 40, right: 40 },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const pdfPromise = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  // ── Title ──
  doc
    .fontSize(14)
    .fillColor("#0d9488")
    .font("Helvetica-Bold")
    .text(template.title ?? template.name, { align: "center" });

  // ── Filter info ──
  if (filterInfo && Object.keys(filterInfo).length > 0) {
    const filterText = Object.entries(filterInfo)
      .map(([k, v]) => `${k}: ${v}`)
      .join("  |  ");
    doc
      .fontSize(8)
      .fillColor("#666")
      .font("Helvetica")
      .text(filterText, { align: "center" });
  }

  doc
    .fontSize(8)
    .fillColor("#999")
    .text(`Generated: ${new Date().toLocaleString("en-GB")}`, { align: "center" });

  doc.moveDown(0.5);

  // ── Table ──
  const pageWidth = doc.page.width - 80; // margins
  const colCount = template.columns.length;
  const colWidth = pageWidth / colCount;

  // Header row
  doc.rect(40, doc.y, pageWidth, 18).fill("#0d9488");
  doc.fillColor("#fff").fontSize(6).font("Helvetica-Bold");
  let x = 40;
  for (const col of template.columns) {
    doc.text(col.header, x + 2, doc.y + 4, { width: colWidth - 4, align: "left" });
    x += colWidth;
  }
  doc.y += 18;

  // Data rows
  doc.fillColor("#333").fontSize(6).font("Helvetica");
  let rowY = doc.y;
  let isAlternate = false;

  const rowsToRender = data.slice(0, 500); // limit to 500 rows for PDF
  for (const row of rowsToRender) {
    // Check if we need a new page
    if (rowY > doc.page.height - 80) {
      doc.addPage();
      rowY = doc.y;
      // Redraw header on new page
      doc.rect(40, rowY, pageWidth, 18).fill("#0d9488");
      doc.fillColor("#fff").fontSize(6).font("Helvetica-Bold");
      x = 40;
      for (const col of template.columns) {
        doc.text(col.header, x + 2, rowY + 4, { width: colWidth - 4, align: "left" });
        x += colWidth;
      }
      rowY += 18;
      doc.fillColor("#333").fontSize(6).font("Helvetica");
    }

    // Alternate row background
    if (isAlternate) {
      doc.rect(40, rowY, pageWidth, 14).fill("#f5f5f5");
    }
    isAlternate = !isAlternate;

    x = 40;
    for (const col of template.columns) {
      const val = formatCellValue(row[col.key], col.format);
      doc.text(String(val), x + 2, rowY + 3, { width: colWidth - 4, align: "left" });
      x += colWidth;
    }
    rowY += 14;
    doc.y = rowY;

    // Row border
    doc.moveTo(40, rowY).lineTo(40 + pageWidth, rowY).lineWidth(0.3).strokeColor("#eee").stroke();
  }

  // Summary
  doc.moveDown(1);
  doc
    .fontSize(8)
    .fillColor("#666")
    .font("Helvetica-Bold")
    .text(`Total Trainees: ${data.length}${data.length > 500 ? ` (showing first 500 in PDF — use Excel for full export)` : ""}`, 40, doc.y);

  doc.end();

  const buffer = await pdfPromise;
  return {
    buffer,
    mimeType: "application/pdf",
    filename: generateFilename(template, "pdf"),
  };
}

// ── Main Export Entry Point ──────────────────────────────────────────

export async function exportReport(
  template: ReportTemplate,
  format: "xlsx" | "pdf",
  data: ReportDataRow[],
  filterInfo?: Record<string, string>
): Promise<ExportResult> {
  if (format === "xlsx") {
    return exportToExcel(template, data, filterInfo);
  } else {
    return exportToPdf(template, data, filterInfo);
  }
}
