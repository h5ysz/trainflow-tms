// GCCLAB TMS — Claim PDF export builders
// =====================================================================
// Two documents:
//   • "OT / Regular Hours Approval Sheet" — mirrors the reference Excel/PDF
//     (title row, B–I columns, total hours, Requested/Assigned/Approved block).
//   • "Business Mission" — a clean, professional GCCLAB-branded bilingual A4
//     sheet (English + Arabic labels) with trainer/session/destination/rates/
//     totals and the Requested/Assigned/Approved signature block.
// Plus a monthly summary PDF (Overtime + Business Mission tables).
//
// Pure builders over a pdfkit document: fonts and the logo arrive via options
// (registered by the caller), so this module stays unit-testable in node.

import PDFDocument from "pdfkit";
import { orderTextForLtr } from "@/lib/pdf/bidi";
import { weekdayName } from "../engine";
import type { ClaimExportData } from "./excel";

export interface ClaimPdfOptions {
  /** Registered regular font (Latin + Arabic), or null for Helvetica fallback. */
  fontName?: string | null;
  /** Registered bold font, or null for Helvetica-Bold fallback. */
  fontNameBold?: string | null;
  /** Absolute path to the GCCLAB logo, or null for text-only header. */
  logoPath?: string | null;
}

// A4 portrait (595 x 842).
const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 42;
const CONTENT_W = PAGE_W - MARGIN * 2;

const BURGUNDY = "#7B1E2B";
const DARK = "#1a1a1a";
const GRAY = "#666";
const LIGHT = "#bdbdbd";
const HEADER_FILL = "#eef2fa";
const TOTAL_FILL = "#fff7e0";

type Doc = any;

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function fmtMonthDay(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function regFont(doc: Doc, fontName: string | null | undefined, fallback: string): string {
  return fontName ?? fallback;
}

function drawHeader(
  doc: Doc,
  opts: ClaimPdfOptions,
  titleEn: string,
  titleAr: string,
  refNumber: string,
) {
  const font = regFont(doc, opts.fontName, "Helvetica");
  const fontBold = regFont(doc, opts.fontNameBold, "Helvetica-Bold");

  if (opts.logoPath) {
    try {
      doc.image(opts.logoPath, MARGIN, MARGIN, { height: 44 });
    } catch {
      // Ignore a broken logo image; the text header still renders.
    }
  }
  doc
    .font(fontBold)
    .fontSize(14)
    .fillColor(DARK)
    .text(titleEn, opts.logoPath ? MARGIN + 52 : MARGIN, MARGIN + 4, { width: CONTENT_W - (opts.logoPath ? 52 : 0) - 120, lineBreak: false });
  doc
    .font(font)
    .fontSize(10)
    .fillColor(GRAY)
    .text(orderTextForLtr(titleAr), opts.logoPath ? MARGIN + 52 : MARGIN, MARGIN + 22, { width: CONTENT_W - (opts.logoPath ? 52 : 0) - 120, lineBreak: false });
  doc
    .font(font)
    .fontSize(9)
    .fillColor(GRAY)
    .text(`Ref: ${refNumber}`, MARGIN, MARGIN + 44, { width: CONTENT_W - 120, align: "right", lineBreak: false });

  doc
    .moveTo(MARGIN, MARGIN + 60)
    .lineTo(PAGE_W - MARGIN, MARGIN + 60)
    .lineWidth(1)
    .strokeColor(BURGUNDY)
    .stroke();
  return MARGIN + 70;
}

function drawFooter(doc: Doc, opts: ClaimPdfOptions, refNumber: string) {
  const font = regFont(doc, opts.fontName, "Helvetica");
  doc
    .font(font)
    .fontSize(7.5)
    .fillColor(GRAY)
    .text(`${refNumber} · GCCLAB TMS · Generated ${new Date().toLocaleString("en-GB")}`, MARGIN, PAGE_H - 28, { width: CONTENT_W, align: "center", lineBreak: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// OT / Regular Hours approval sheet
// ─────────────────────────────────────────────────────────────────────────────

export async function buildOvertimeSheetPdf(data: ClaimExportData, opts: ClaimPdfOptions): Promise<Buffer> {
  const isContractor = data.engagementType === "CONTRACTOR";
  const font = regFont(opts, opts.fontName, "Helvetica");
  const fontBold = regFont(opts, opts.fontNameBold, "Helvetica-Bold");

  const doc: Doc = new PDFDocument({ size: "A4", margin: MARGIN });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  let y = drawHeader(
    doc,
    opts,
    `${isContractor ? "Regular Hours" : "OT Approval"} Sheet`,
    isContractor ? "بيان الساعات الاعتيادية" : "بيان ساعات العمل الإضافية",
    data.refNumber,
  );

  // Title band.
  const band = `${isContractor ? "REGULAR HOURS" : "OT APPROVAL"} SHEET ${titlePeriod(data.periodFrom, data.periodTo)} ${(data.mainLocation ?? "").toUpperCase()}`.trim();
  doc.font(fontBold).fontSize(13).fillColor(DARK);
  doc.text(band, MARGIN, y, { width: CONTENT_W, align: "center", lineBreak: false });
  y += 22;

  // Table header.
  const columns: Array<{ label: string; w: number; align: "left" | "center" }> = [
    { label: "Training", w: 120, align: "left" },
    { label: "Location", w: 95, align: "left" },
    { label: "Requested by", w: 105, align: "left" },
    { label: "Assigned to", w: 105, align: "left" },
    { label: "DATE", w: 70, align: "center" },
    { label: "Day", w: 60, align: "center" },
    { label: "Hours", w: 40, align: "center" },
    { label: "Session", w: 50, align: "center" },
  ];
  const headerH = 18;
  let x = MARGIN;
  doc.rect(MARGIN, y, CONTENT_W, headerH).fill(HEADER_FILL);
  doc.font(fontBold).fontSize(8).fillColor(DARK);
  for (const col of columns) {
    doc.text(col.label, x + 3, y + 5, { width: col.w - 6, align: col.align as any, lineBreak: false });
    x += col.w;
  }
  doc.moveTo(MARGIN, y + headerH).lineTo(MARGIN + CONTENT_W, y + headerH).lineWidth(0.5).strokeColor(LIGHT).stroke();
  y += headerH;

  const rowH = 16;
  doc.font(font).fontSize(8.5).fillColor(DARK);
  for (const item of data.items) {
    if (y + rowH + 8 > PAGE_H - 40) {
      drawFooter(doc, opts, data.refNumber);
      doc.addPage();
      y = MARGIN;
      // Repeat header on continued pages.
      x = MARGIN;
      doc.rect(MARGIN, y, CONTENT_W, headerH).fill(HEADER_FILL);
      doc.font(fontBold).fontSize(8).fillColor(DARK);
      for (const col of columns) {
        doc.text(col.label, x + 3, y + 5, { width: col.w - 6, align: col.align as any, lineBreak: false });
        x += col.w;
      }
      y += headerH;
      doc.font(font).fontSize(8.5).fillColor(DARK);
    }
    const day = new Date(`${item.date}T00:00:00.000Z`);
    const isWeekend = day.getUTCDay() === 5 || day.getUTCDay() === 6;
    const sessionLabel = !isContractor && isWeekend && item.finalValue >= 12 ? "M/E" : item.shift ?? "";
    const cells = [
      item.courseTitle ?? item.courseCode ?? "",
      item.location ?? "",
      data.requestedByName,
      data.assignedToName,
      fmtMonthDay(day),
      weekdayName(day.getUTCDay()),
      String(item.finalValue),
      sessionLabel,
    ];
    x = MARGIN;
    cells.forEach((text, i) => {
      doc.text(text, x + 3, y + 4, { width: columns[i].w - 6, align: columns[i].align as any, lineBreak: false });
      x += columns[i].w;
    });
    y += rowH;
  }

  // Total row.
  y += 4;
  doc.rect(MARGIN, y, CONTENT_W, 18).fill(TOTAL_FILL);
  doc.font(fontBold).fontSize(9).fillColor(DARK);
  doc.text(isContractor ? "Total Regular Hours" : "Total OT Hours", MARGIN + 3, y + 5, { width: 180, lineBreak: false });
  doc.text(String(data.totalHours), MARGIN + CONTENT_W - 70, y + 5, { width: 60, align: "right", lineBreak: false });
  y += 22;

  // Signature block.
  const sigY = y + 30;
  const sigW = (CONTENT_W - 20) / 3;
  const labels: Array<[string, string]> = [
    ["Requested By", data.requestedByName],
    ["Assigned To", data.assignedToName],
    ["Approved By", data.approvedByName],
  ];
  x = MARGIN;
  for (const [label, name] of labels) {
    doc.font(fontBold).fontSize(8.5).fillColor(GRAY).text(label, x, sigY - 20, { width: sigW, lineBreak: false });
    doc.moveTo(x, sigY).lineTo(x + sigW - 10, sigY).lineWidth(0.75).strokeColor(DARK).stroke();
    doc.font(font).fontSize(9).fillColor(DARK).text(name, x, sigY + 4, { width: sigW - 10, lineBreak: false });
    x += sigW + 10;
  }

  drawFooter(doc, opts, data.refNumber);
  doc.end();
  return done;
}

// ─────────────────────────────────────────────────────────────────────────────
// Business mission — bilingual GCCLAB-branded A4 sheet
// ─────────────────────────────────────────────────────────────────────────────

function labelRow(
  doc: Doc,
  opts: ClaimPdfOptions,
  y: number,
  leftLabel: string,
  leftAr: string,
  leftValue: string,
  rightLabel: string,
  rightAr: string,
  rightValue: string,
): number {
  const font = regFont(opts, opts.fontName, "Helvetica");
  const fontBold = regFont(opts, opts.fontNameBold, "Helvetica-Bold");
  const halfW = CONTENT_W / 2;

  doc.font(fontBold).fontSize(8).fillColor(BURGUNDY).text(leftLabel, MARGIN, y, { width: halfW - 14, lineBreak: false });
  doc.font(font).fontSize(7.5).fillColor(GRAY).text(orderTextForLtr(leftAr), MARGIN + 80, y, { width: halfW - 90, lineBreak: false });
  doc.font(font).fontSize(9).fillColor(DARK).text(leftValue, MARGIN, y + 13, { width: halfW - 14, lineBreak: false });

  doc.font(fontBold).fontSize(8).fillColor(BURGUNDY).text(rightLabel, MARGIN + halfW, y, { width: halfW - 14, lineBreak: false });
  doc.font(font).fontSize(7.5).fillColor(GRAY).text(orderTextForLtr(rightAr), MARGIN + halfW + 80, y, { width: halfW - 90, lineBreak: false });
  doc.font(font).fontSize(9).fillColor(DARK).text(rightValue, MARGIN + halfW, y + 13, { width: halfW - 14, lineBreak: false });

  doc.moveTo(MARGIN, y + 30).lineTo(MARGIN + CONTENT_W, y + 30).lineWidth(0.4).strokeColor(LIGHT).stroke();
  return y + 38;
}

export async function buildBusinessMissionPdf(data: ClaimExportData, opts: ClaimPdfOptions): Promise<Buffer> {
  const font = regFont(opts, opts.fontName, "Helvetica");
  const fontBold = regFont(opts, opts.fontNameBold, "Helvetica-Bold");

  const doc: Doc = new PDFDocument({ size: "A4", margin: MARGIN });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  let y = drawHeader(doc, opts, "Trainer Business Mission", "طلب رحلة عمل للمدرب", data.refNumber);

  // Mission overview.
  doc.font(fontBold).fontSize(11).fillColor(DARK).text("Mission Overview / تفاصيل الرحلة", MARGIN, y, { width: CONTENT_W, lineBreak: false });
  y += 22;

  const from = new Date(`${data.periodFrom.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const to = new Date(`${data.periodTo.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const engagementLabel = data.engagementType === "CONTRACTOR" ? "Contractor" : "Employee";
  const engagementAr = data.engagementType === "CONTRACTOR" ? "مقاول" : "موظف";

  y = labelRow(doc, opts, y, "Trainer", "اسم المدرب", data.trainerNameEn + (data.trainerNameAr ? ` (${data.trainerNameAr})` : ""), "Engagement Type", "نوع التعاقد", engagementLabel + " / " + engagementAr);
  y = labelRow(doc, opts, y, "Period From", "من تاريخ", fmtDate(from), "Period To", "إلى تاريخ", fmtDate(to));
  y = labelRow(doc, opts, y, "Main Location", "موقع العمل الأساسي", data.mainLocation ?? "—", "Destination", "الوجهة", data.items.find((i) => i.location)?.location ?? "—");
  y = labelRow(doc, opts, y, "Daily Allowance", "بدل يومي", `${data.currency} ${data.dailyAllowance ?? 0}`, "Total Days", "إجمالي الأيام", String(data.totalDays));

  // Mission days table.
  y += 8;
  doc.font(fontBold).fontSize(11).fillColor(DARK).text("Mission Days / أيام الرحلة", MARGIN, y, { width: CONTENT_W, lineBreak: false });
  y += 20;

  const columns: Array<{ label: string; w: number; align: "left" | "center" }> = [
    { label: "Training", w: 130, align: "left" },
    { label: "Location", w: 90, align: "left" },
    { label: "DATE", w: 70, align: "center" },
    { label: "Day", w: 60, align: "center" },
    { label: "Session", w: 55, align: "center" },
    { label: "Days", w: 45, align: "center" },
    { label: "Rate (SAR)", w: 65, align: "center" },
    { label: "Amount (SAR)", w: 75, align: "center" },
  ];
  const headerH = 16;
  let x = MARGIN;
  doc.rect(MARGIN, y, CONTENT_W, headerH).fill(HEADER_FILL);
  doc.font(fontBold).fontSize(7.5).fillColor(DARK);
  for (const col of columns) {
    doc.text(col.label, x + 2, y + 4, { width: col.w - 4, align: col.align as any, lineBreak: false });
    x += col.w;
  }
  y += headerH;

  const rowH = 14;
  doc.font(font).fontSize(8).fillColor(DARK);
  for (const item of data.items) {
    if (y + rowH + 10 > PAGE_H - 40) {
      drawFooter(doc, opts, data.refNumber);
      doc.addPage();
      y = MARGIN;
    }
    const day = new Date(`${item.date}T00:00:00.000Z`);
    const cells = [
      item.courseTitle ?? item.courseCode ?? "",
      item.location ?? "",
      fmtMonthDay(day),
      weekdayName(day.getUTCDay()),
      item.shift ?? "",
      String(item.finalValue),
      String(item.rate ?? 0),
      String(item.amount ?? 0),
    ];
    x = MARGIN;
    cells.forEach((text, i) => {
      doc.text(text, x + 2, y + 3, { width: columns[i].w - 4, align: columns[i].align as any, lineBreak: false });
      x += columns[i].w;
    });
    y += rowH;
  }

  // Totals.
  y += 4;
  doc.rect(MARGIN, y, CONTENT_W, 18).fill(TOTAL_FILL);
  doc.font(fontBold).fontSize(9).fillColor(DARK);
  doc.text("Total Mission Days / Amount", MARGIN + 3, y + 5, { width: 200, lineBreak: false });
  doc.text(`${data.currency} ${data.totalAmount.toLocaleString("en-US")}`, MARGIN + CONTENT_W - 110, y + 5, { width: 100, align: "right", lineBreak: false });
  y += 24;

  // Purpose / notes.
  if (data.items.length > 0) {
    const flagged = data.items.filter((i) => i.locationFlagged);
    if (flagged.length > 0) {
      doc.font(font).fontSize(8).fillColor("#8a6d3b");
      doc.text("Note: some locations are unrecorded/mixed in the training sessions and were conservatively counted. Review before approval.", MARGIN, y, { width: CONTENT_W, lineBreak: true });
      y += 24;
    }
  }

  // Signatures.
  const sigY = Math.max(y + 28, PAGE_H - 110);
  const sigW = (CONTENT_W - 20) / 3;
  const sigs: Array<[string, string, string]> = [
    ["Requested By", "المقدّم من", data.requestedByName],
    ["Assigned To", "المكلف به", data.assignedToName],
    ["Approved By", "المعتمد من", data.approvedByName],
  ];
  x = MARGIN;
  for (const [label, ar, name] of sigs) {
    doc.font(fontBold).fontSize(8.5).fillColor(GRAY).text(label, x, sigY - 16, { width: sigW, lineBreak: false });
    doc.font(font).fontSize(7.5).fillColor(LIGHT).text(orderTextForLtr(ar), x, sigY - 7, { width: sigW, lineBreak: false });
    doc.moveTo(x, sigY).lineTo(x + sigW - 10, sigY).lineWidth(0.75).strokeColor(DARK).stroke();
    doc.font(font).fontSize(9).fillColor(DARK).text(name, x, sigY + 4, { width: sigW - 10, lineBreak: false });
    x += sigW + 10;
  }

  drawFooter(doc, opts, data.refNumber);
  doc.end();
  return done;
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly summary
// ─────────────────────────────────────────────────────────────────────────────

export interface SummaryRow {
  trainerRef: string;
  trainerNameEn: string;
  trainerNameAr: string | null;
  engagementType: string;
  claimRef: string;
  status: string;
  periodFrom: string;
  periodTo: string;
  totalHours: number;
  totalDays: number;
  totalAmount: number;
  currency: string;
}

export async function buildSummaryPdf(
  month: string,
  summary: SummaryRow[],
  opts: ClaimPdfOptions,
): Promise<Buffer> {
  const font = regFont(opts, opts.fontName, "Helvetica");
  const fontBold = regFont(opts, opts.fontNameBold, "Helvetica-Bold");

  const doc: Doc = new PDFDocument({ size: "A4", margin: MARGIN });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  let y = drawHeader(doc, opts, `Monthly Trainer Claims — ${month}`, `ملخص مطالبات المدربين — ${month}`, month);

  const otRows = summary.filter((s) => s.totalHours > 0);
  const bmRows = summary.filter((s) => s.totalDays > 0);

  doc.font(fontBold).fontSize(11).fillColor(DARK).text("Overtime Summary / ملخص العمل الإضافي", MARGIN, y, { width: CONTENT_W, lineBreak: false });
  y += 20;

  const otCols: Array<{ label: string; w: number }> = [
    { label: "Trainer Ref", w: 80 },
    { label: "Trainer Name", w: 150 },
    { label: "Engagement", w: 70 },
    { label: "Claim", w: 110 },
    { label: "Status", w: 60 },
    { label: "Period", w: 140 },
    { label: "Hours", w: 45 },
  ];
  let x = MARGIN;
  doc.rect(MARGIN, y, CONTENT_W, 16).fill(HEADER_FILL);
  doc.font(fontBold).fontSize(8).fillColor(DARK);
  for (const col of otCols) {
    doc.text(col.label, x + 2, y + 5, { width: col.w - 4, lineBreak: false });
    x += col.w;
  }
  y += 16;
  doc.font(font).fontSize(8).fillColor(DARK);
  for (const row of otRows) {
    if (y + 15 > PAGE_H - 40) {
      drawFooter(doc, opts, month);
      doc.addPage();
      y = MARGIN;
    }
    const cells = [row.trainerRef, row.trainerNameEn, row.engagementType, row.claimRef, row.status, `${row.periodFrom} → ${row.periodTo}`, String(row.totalHours)];
    x = MARGIN;
    cells.forEach((text, i) => {
      doc.text(text, x + 2, y + 4, { width: otCols[i].w - 4, lineBreak: false });
      x += otCols[i].w;
    });
    y += 15;
  }
  if (otRows.length === 0) {
    doc.font(font).fontSize(8).fillColor(GRAY).text("No overtime claims for this period.", MARGIN, y, { width: CONTENT_W, lineBreak: false });
    y += 16;
  }
  y += 14;

  doc.font(fontBold).fontSize(11).fillColor(DARK).text("Business Mission Summary / ملخص رحلات العمل", MARGIN, y, { width: CONTENT_W, lineBreak: false });
  y += 20;

  const bmCols: Array<{ label: string; w: number }> = [
    { label: "Trainer Ref", w: 80 },
    { label: "Trainer Name", w: 150 },
    { label: "Engagement", w: 70 },
    { label: "Claim", w: 110 },
    { label: "Status", w: 60 },
    { label: "Period", w: 140 },
    { label: "Days", w: 40 },
    { label: "Amount", w: 70 },
  ];
  x = MARGIN;
  doc.rect(MARGIN, y, CONTENT_W, 16).fill(HEADER_FILL);
  doc.font(fontBold).fontSize(8).fillColor(DARK);
  for (const col of bmCols) {
    doc.text(col.label, x + 2, y + 5, { width: col.w - 4, lineBreak: false });
    x += col.w;
  }
  y += 16;
  doc.font(font).fontSize(8).fillColor(DARK);
  for (const row of bmRows) {
    if (y + 15 > PAGE_H - 40) {
      drawFooter(doc, opts, month);
      doc.addPage();
      y = MARGIN;
    }
    const cells = [row.trainerRef, row.trainerNameEn, row.engagementType, row.claimRef, row.status, `${row.periodFrom} → ${row.periodTo}`, String(row.totalDays), `${row.currency} ${row.totalAmount}`];
    x = MARGIN;
    cells.forEach((text, i) => {
      doc.text(text, x + 2, y + 4, { width: bmCols[i].w - 4, lineBreak: false });
      x += bmCols[i].w;
    });
    y += 15;
  }
  if (bmRows.length === 0) {
    doc.font(font).fontSize(8).fillColor(GRAY).text("No business mission claims for this period.", MARGIN, y, { width: CONTENT_W, lineBreak: false });
  }

  drawFooter(doc, opts, month);
  doc.end();
  return done;
}

// ─────────────────────────────────────────────────────────────────────────────
// HRD-FO-052 — Extended Overtime Request & Employee Acknowledgment Form
// ─────────────────────────────────────────────────────────────────────────────

const ACKNOWLEDGMENT_CLAUSES: string[] = [
  "I confirm that I have voluntarily requested and/or agreed to perform the extended overtime described above. I acknowledge and confirm that:",
  "I am physically capable and properly trained of performing extended working hours (overtime).",
  "I understand the risks associated with the assigned tasks and will ensure compliance with the required safety protocols.",
  "I am aware of the foreseeable emergencies scenarios and will act in accordance with prescribed emergency action plan of the workplace location.",
  "I will report any unsafe acts or conditions to designated immediate Supervisor that could jeopardize my personal and workplace safety.",
  "I am oriented of the GCC Lab Stop Work Policy and will refrain from any activity that could result in imminent personal injury and illness.",
  "I have not been forced or improperly pressured to request or agree to the extended overtime.",
  "At the time of signing, to the best of my knowledge, I am able to perform the additional working hours safely.",
  "I understand that extended working hours may result in fatigue and may affect concentration, alertness, and the ability to perform work safely.",
  "I undertake to immediately inform my Line Manager, HR and/or QHSE if I experience excessive fatigue or any condition that may affect my ability to continue working safely.",
  "I will comply with all applicable Company policies and procedures relating to health, safety, working hours, rest periods, and fatigue management.",
  "The Company may reduce, suspend or discontinue overtime at any time due to health, safety, operational, legal or business considerations.",
  "I understand that rest periods between working days will be maintained in accordance with applicable labor regulations and Company policy.",
  "This extended overtime arrangement is subject to and shall be governed by the Saudi Labor Law and its Implementing Regulations.",
  "Nothing in this form shall be construed as a waiver of any rights or protections afforded to me under applicable law or Company policy.",
  "The Company retains full discretion to modify or terminate the overtime arrangement at any time.",
  "I certify that the information provided in this form is true and accurate to the best of my knowledge.",
];

const LINE_MANAGER_CHECKLIST: string[] = [
  "Extended overtime is operationally required / justified.",
  "Employee workload and proposed working hours have been reviewed.",
  "The employee has been informed of the extended overtime requirements and agrees.",
  "Appropriate rest periods will be provided.",
  "Overtime records will be monitored throughout the approved period.",
  "Alternative staffing arrangements have been considered where reasonably possible.",
  "Budget availability has been reviewed and confirmed.",
  "The arrangement will be reassessed periodically.",
  "QHSE recommendations and legal requirements are considered.",
  "Ensure working hours and rest days adhere to Saudi Arabia local regulations.",
  "I confirm agreement with the above assessment.",
];

function drawSectionTitle(doc: Doc, opts: ClaimPdfOptions, y: number, title: string): number {
  const fontBold = regFont(opts, opts.fontNameBold, "Helvetica-Bold");
  doc.font(fontBold).fontSize(10).fillColor(BURGUNDY);
  doc.text(title, MARGIN, y, { width: CONTENT_W, lineBreak: false });
  y += 14;
  doc.moveTo(MARGIN, y).lineTo(MARGIN + CONTENT_W, y).lineWidth(0.5).strokeColor(BURGUNDY).stroke();
  return y + 6;
}

function drawFieldPair(
  doc: Doc,
  opts: ClaimPdfOptions,
  y: number,
  leftLabel: string,
  leftValue: string,
  rightLabel: string,
  rightValue: string,
): number {
  const font = regFont(opts, opts.fontName, "Helvetica");
  const fontBold = regFont(opts, opts.fontNameBold, "Helvetica-Bold");
  const halfW = CONTENT_W / 2 - 6;

  doc.font(fontBold).fontSize(7.5).fillColor(GRAY).text(leftLabel, MARGIN, y, { width: halfW, lineBreak: false });
  doc.font(font).fontSize(9).fillColor(DARK).text(leftValue || "—", MARGIN, y + 10, { width: halfW, lineBreak: false });

  doc.font(fontBold).fontSize(7.5).fillColor(GRAY).text(rightLabel, MARGIN + halfW + 12, y, { width: halfW, lineBreak: false });
  doc.font(font).fontSize(9).fillColor(DARK).text(rightValue || "—", MARGIN + halfW + 12, y + 10, { width: halfW, lineBreak: false });

  return y + 26;
}

function drawCheckboxLine(doc: Doc, opts: ClaimPdfOptions, y: number, text: string, checked: boolean, maxW?: number): number {
  const font = regFont(opts, opts.fontName, "Helvetica");
  const w = maxW ?? CONTENT_W;
  const box = checked ? "☑" : "☐";
  doc.font(font).fontSize(8).fillColor(DARK).text(`${box}  ${text}`, MARGIN, y, { width: w, lineBreak: false });
  return y + 14;
}

function drawDecisionRow(
  doc: Doc,
  opts: ClaimPdfOptions,
  y: number,
  label: string,
  options: string[],
  selected?: string,
): number {
  const font = regFont(opts, opts.fontName, "Helvetica");
  const fontBold = regFont(opts, opts.fontNameBold, "Helvetica-Bold");
  doc.font(fontBold).fontSize(8).fillColor(DARK).text(label, MARGIN, y, { width: CONTENT_W, lineBreak: false });
  y += 12;
  let x = MARGIN;
  for (const opt of options) {
    const checked = selected === opt;
    doc.font(font).fontSize(8).fillColor(DARK).text(`${checked ? "☑" : "☐"} ${opt}`, x, y, { width: 170, lineBreak: false });
    x += 170;
    if (x > PAGE_W - MARGIN) {
      x = MARGIN;
      y += 13;
    }
  }
  return y + 18;
}

function drawSignatureBlock(
  doc: Doc,
  opts: ClaimPdfOptions,
  y: number,
  fields: Array<{ label: string; value: string }>,
): number {
  const font = regFont(opts, opts.fontName, "Helvetica");
  const fontBold = regFont(opts, opts.fontNameBold, "Helvetica-Bold");
  const colW = (CONTENT_W - (fields.length - 1) * 12) / fields.length;
  for (let i = 0; i < fields.length; i++) {
    const x = MARGIN + i * (colW + 12);
    doc.font(fontBold).fontSize(7.5).fillColor(GRAY).text(fields[i].label, x, y, { width: colW, lineBreak: false });
    doc.moveTo(x, y + 14).lineTo(x + colW - 4, y + 14).lineWidth(0.75).strokeColor(DARK).stroke();
    doc.font(font).fontSize(8.5).fillColor(DARK).text(fields[i].value || "", x, y + 17, { width: colW - 4, lineBreak: false });
  }
  return y + 36;
}

function fmtDecisionLabel(d?: string): string {
  if (!d) return "—";
  return d.replace(/_/g, " ");
}

function fmtDateShort(d?: string | Date): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

export async function buildHrdFo052Pdf(data: ClaimExportData, opts: ClaimPdfOptions): Promise<Buffer> {
  const font = regFont(opts, opts.fontName, "Helvetica");
  const fontBold = regFont(opts, opts.fontNameBold, "Helvetica-Bold");

  const doc: Doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  let y = MARGIN;

  // Header banner.
  doc.rect(MARGIN, y, CONTENT_W, 32).fill(BURGUNDY);
  doc.font(fontBold).fontSize(11).fillColor("#ffffff");
  doc.text("HRD-FO-052 | EXTENDED OVERTIME REQUEST & EMPLOYEE ACKNOWLEDGMENT FORM", MARGIN + 8, y + 4, { width: CONTENT_W - 16, lineBreak: false });
  y += 36;
  doc.font(font).fontSize(7.5).fillColor(GRAY);
  doc.text(`Issue Date: ${fmtDateShort(new Date())}    Revision: 1.0`, MARGIN, y, { width: CONTENT_W, lineBreak: false });
  y += 14;
  doc.moveTo(MARGIN, y).lineTo(PAGE_W - MARGIN, y).lineWidth(0.5).strokeColor(BURGUNDY).stroke();
  y += 8;

  // Section 1: Employee Information
  y = drawSectionTitle(doc, opts, y, "Section 1 — Employee Information");
  y = drawFieldPair(doc, opts, y, "Employee Name", data.assignedToName, "Employee ID", data.employeeId ?? "");
  y = drawFieldPair(doc, opts, y, "Job Title", data.employeeJobTitle ?? "", "Department / Company", data.employeeDepartment ?? "");
  y = drawFieldPair(doc, opts, y, "Project / Work Location", data.employeeProject ?? "", "Line Manager", data.employeeLineManager ?? "");
  y += 4;

  // Section 2: Extended Overtime Details
  y = drawSectionTitle(doc, opts, y, "Section 2 — Extended Overtime Details");
  const from = new Date(`${data.periodFrom.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const to = new Date(`${data.periodTo.toISOString().slice(0, 10)}T00:00:00.000Z`);
  y = drawFieldPair(doc, opts, y, "Requested OT Period", `${fmtDateShort(from)} → ${fmtDateShort(to)}`, "Requested / Initiated By", data.requestedBy ?? "");
  y = drawFieldPair(doc, opts, y, "Normal Working Hours / Day", String(data.normalWorkingHoursPerDay ?? "—"), "Estimated OT / Day", String(data.estimatedOtPerDay ?? "—"));
  y += 2;

  // Reason.
  doc.font(regFont(opts, opts.fontNameBold, "Helvetica-Bold")).fontSize(7.5).fillColor(GRAY).text("Reason", MARGIN, y, { width: CONTENT_W, lineBreak: false });
  y += 10;
  doc.font(font).fontSize(8.5).fillColor(DARK).text(data.reason || "—", MARGIN, y, { width: CONTENT_W, lineBreak: true });
  y = doc.y + 6;

  // OT Calculation Table.
  y = drawSectionTitle(doc, opts, y, "OT Calculation Table");
  const otColumns: Array<{ label: string; w: number; align: "left" | "center" }> = [
    { label: "Training", w: 115, align: "left" },
    { label: "Location", w: 85, align: "left" },
    { label: "Requested by", w: 100, align: "left" },
    { label: "Assigned to", w: 100, align: "left" },
    { label: "DATE", w: 65, align: "center" },
    { label: "Day", w: 55, align: "center" },
    { label: "Hours", w: 50, align: "center" },
  ];
  const headerH = 16;
  let x = MARGIN;
  doc.rect(MARGIN, y, CONTENT_W, headerH).fill(HEADER_FILL);
  doc.font(fontBold).fontSize(7.5).fillColor(DARK);
  for (const col of otColumns) {
    doc.text(col.label, x + 2, y + 4, { width: col.w - 4, align: col.align as any, lineBreak: false });
    x += col.w;
  }
  y += headerH;

  const rowH = 14;
  doc.font(font).fontSize(8).fillColor(DARK);
  for (const item of data.items) {
    if (y + rowH + 8 > PAGE_H - 40) {
      drawFooter(doc, opts, data.refNumber);
      doc.addPage();
      y = MARGIN;
      x = MARGIN;
      doc.rect(MARGIN, y, CONTENT_W, headerH).fill(HEADER_FILL);
      doc.font(fontBold).fontSize(7.5).fillColor(DARK);
      for (const col of otColumns) {
        doc.text(col.label, x + 2, y + 4, { width: col.w - 4, align: col.align as any, lineBreak: false });
        x += col.w;
      }
      y += headerH;
      doc.font(font).fontSize(8).fillColor(DARK);
    }
    const day = new Date(`${item.date}T00:00:00.000Z`);
    const cells = [
      item.courseTitle ?? item.courseCode ?? "",
      item.location ?? "",
      data.requestedBy ?? "",
      data.assignedToName,
      fmtMonthDay(day),
      weekdayName(day.getUTCDay()),
      String(item.finalValue),
    ];
    x = MARGIN;
    cells.forEach((text, i) => {
      doc.text(text, x + 2, y + 3, { width: otColumns[i].w - 4, align: otColumns[i].align as any, lineBreak: false });
      x += otColumns[i].w;
    });
    y += rowH;
  }

  // Total OT Hours.
  y += 4;
  doc.rect(MARGIN, y, CONTENT_W, 16).fill(TOTAL_FILL);
  doc.font(fontBold).fontSize(9).fillColor(DARK);
  doc.text("Total OT Hours", MARGIN + 3, y + 4, { width: 140, lineBreak: false });
  doc.text(String(data.totalHours), MARGIN + CONTENT_W - 60, y + 4, { width: 50, align: "right", lineBreak: false });
  y += 22;

  // Section 3: Employee Acknowledgment
  if (y + 120 > PAGE_H - 40) {
    drawFooter(doc, opts, data.refNumber);
    doc.addPage();
    y = MARGIN;
  }
  y = drawSectionTitle(doc, opts, y, "Section 3 — Employee Acknowledgment");
  doc.font(font).fontSize(7.5).fillColor(DARK);
  for (let i = 0; i < ACKNOWLEDGMENT_CLAUSES.length; i++) {
    if (y + 14 > PAGE_H - 40) {
      drawFooter(doc, opts, data.refNumber);
      doc.addPage();
      y = MARGIN;
    }
    const num = `${i + 1}.`;
    doc.font(fontBold).fontSize(7.5).fillColor(DARK).text(num, MARGIN, y, { width: 18, lineBreak: false });
    doc.font(font).fontSize(7.5).fillColor(DARK).text(ACKNOWLEDGMENT_CLAUSES[i], MARGIN + 18, y, { width: CONTENT_W - 18, lineBreak: true });
    y = doc.y + 3;
  }
  y += 4;

  // Employee signature.
  if (y + 50 > PAGE_H - 40) {
    drawFooter(doc, opts, data.refNumber);
    doc.addPage();
    y = MARGIN;
  }
  y = drawSignatureBlock(doc, opts, y, [
    { label: "Employee Name", value: data.assignedToName },
    { label: "Signature", value: "" },
    { label: "Date", value: "" },
  ]);
  y += 4;

  // Section 4: Line Manager Review & Approval
  if (y + 160 > PAGE_H - 40) {
    drawFooter(doc, opts, data.refNumber);
    doc.addPage();
    y = MARGIN;
  }
  y = drawSectionTitle(doc, opts, y, "Section 4 — Line Manager Review & Approval");
  for (const item of LINE_MANAGER_CHECKLIST) {
    if (y + 14 > PAGE_H - 40) {
      drawFooter(doc, opts, data.refNumber);
      doc.addPage();
      y = MARGIN;
    }
    y = drawCheckboxLine(doc, opts, y, item, false);
  }
  y += 4;

  if (y + 80 > PAGE_H - 40) {
    drawFooter(doc, opts, data.refNumber);
    doc.addPage();
    y = MARGIN;
  }
  y = drawDecisionRow(doc, opts, y, "Decision:", ["Approved", "Approved with Conditions", "Not Approved"], fmtDecisionLabel(data.lineManagerDecision));
  y = drawFieldPair(doc, opts, y, "Manager Name", data.lineManagerSignatureBy ?? "", "Comments / Conditions", data.lineManagerComments ?? "");
  y = drawSignatureBlock(doc, opts, y, [
    { label: "Manager Name", value: data.lineManagerSignatureBy ?? "" },
    { label: "Signature", value: "" },
    { label: "Date", value: fmtDateShort(data.lineManagerSignatureAt) },
    { label: "Comments / Conditions", value: data.lineManagerComments ?? "" },
  ]);
  y += 4;

  // Section 5: QHSE Review
  if (y + 100 > PAGE_H - 40) {
    drawFooter(doc, opts, data.refNumber);
    doc.addPage();
    y = MARGIN;
  }
  y = drawSectionTitle(doc, opts, y, "Section 5 — QHSE Review");
  y = drawDecisionRow(
    doc,
    opts,
    y,
    "Assessment:",
    ["Acceptable", "Acceptable with Controls", "Further Assessment Required", "Not Recommended"],
    fmtDecisionLabel(data.qhseAssessment),
  );
  if (data.qhseControls) {
    doc.font(regFont(opts, opts.fontNameBold, "Helvetica-Bold")).fontSize(7.5).fillColor(GRAY).text("Required Controls / Comments", MARGIN, y, { width: CONTENT_W, lineBreak: false });
    y += 10;
    doc.font(font).fontSize(8.5).fillColor(DARK).text(data.qhseControls, MARGIN, y, { width: CONTENT_W, lineBreak: true });
    y = doc.y + 6;
  }
  y = drawSignatureBlock(doc, opts, y, [
    { label: "QHSE Representative", value: data.qhseSignatureBy ?? "" },
    { label: "Signature", value: "" },
    { label: "Date", value: fmtDateShort(data.qhseSignatureAt) },
  ]);
  y += 4;

  // Section 6: Human Resources Review
  if (y + 100 > PAGE_H - 40) {
    drawFooter(doc, opts, data.refNumber);
    doc.addPage();
    y = MARGIN;
  }
  y = drawSectionTitle(doc, opts, y, "Section 6 — Human Resources Review");
  y = drawDecisionRow(doc, opts, y, "Decision:", ["Approved", "Approved with Conditions", "Not Approved"], fmtDecisionLabel(data.hrDecision));
  y = drawFieldPair(
    doc,
    opts,
    y,
    "Maximum Approved OT (hours)",
    data.hrMaxApprovedOt != null ? String(data.hrMaxApprovedOt) : "—",
    "Approved Period",
    `${fmtDateShort(data.hrApprovedPeriodFrom)} → ${fmtDateShort(data.hrApprovedPeriodTo)}`,
  );
  if (data.hrComments) {
    doc.font(regFont(opts, opts.fontNameBold, "Helvetica-Bold")).fontSize(7.5).fillColor(GRAY).text("Comments / Conditions", MARGIN, y, { width: CONTENT_W, lineBreak: false });
    y += 10;
    doc.font(font).fontSize(8.5).fillColor(DARK).text(data.hrComments, MARGIN, y, { width: CONTENT_W, lineBreak: true });
    y = doc.y + 6;
  }
  y = drawSignatureBlock(doc, opts, y, [
    { label: "HR Representative", value: data.hrSignatureBy ?? "" },
    { label: "Signature", value: "" },
    { label: "Date", value: fmtDateShort(data.hrSignatureAt) },
  ]);
  y += 8;

  // Important Notice.
  if (y + 60 > PAGE_H - 40) {
    drawFooter(doc, opts, data.refNumber);
    doc.addPage();
    y = MARGIN;
  }
  doc.rect(MARGIN, y, CONTENT_W, 36).fill("#fff8e1");
  doc.font(font).fontSize(6.5).fillColor("#6d5a00");
  doc.text(
    "Important Notice: Approval under this form is temporary and limited to the period and hours specified above. The Company reserves the right to reduce, suspend or cancel approved overtime if continued overtime may create a health, safety, legal, operational or employee-welfare concern. Completion of this form does not override Saudi Labor Law, its Implementing Regulations, occupational health and safety requirements, or applicable Company policy.",
    MARGIN + 6,
    y + 4,
    { width: CONTENT_W - 12, lineBreak: true },
  );
  y += 42;

  drawFooter(doc, opts, data.refNumber);
  doc.end();
  return done;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contractor / Independent Consultant — Invoice + Timesheet
// ─────────────────────────────────────────────────────────────────────────────

export async function buildContractorTimesheetPdf(data: ClaimExportData, opts: ClaimPdfOptions): Promise<Buffer> {
  const font = regFont(opts, opts.fontName, "Helvetica");
  const fontBold = regFont(opts, opts.fontNameBold, "Helvetica-Bold");

  const doc: Doc = new PDFDocument({ size: "A4", margin: MARGIN, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  // ── Sheet 1: Invoice ──
  let y = MARGIN;

  // Header band.
  doc.rect(MARGIN, y, CONTENT_W, 32).fill(BURGUNDY);
  doc.font(fontBold).fontSize(12).fillColor("#ffffff");
  doc.text("GCCLAB | Consultancy Service Invoice", MARGIN + 8, y + 8, { width: CONTENT_W - 16, lineBreak: false });
  y += 38;

  const from = new Date(`${data.periodFrom.toISOString().slice(0, 10)}T00:00:00.000Z`);
  const to = new Date(`${data.periodTo.toISOString().slice(0, 10)}T00:00:00.000Z`);

  y = drawFieldPair(doc, opts, y, "Invoice Period", `${fmtDateShort(from)} → ${fmtDateShort(to)}`, "Invoice No.", data.contractorInvoiceNumber ?? "");
  y = drawFieldPair(doc, opts, y, "Date", fmtDateShort(data.createdAt), "From (Consultant)", data.assignedToName);
  y = drawFieldPair(doc, opts, y, "To (Company)", "GCC Lab", "Rate / Day", data.contractorRatePerDay != null ? `${data.currency} ${data.contractorRatePerDay}` : "—");
  y += 4;

  // Invoice table.
  const invColumns: Array<{ label: string; w: number; align: "left" | "center" }> = [
    { label: "DATE", w: 70, align: "center" },
    { label: "PROJECT", w: 95, align: "left" },
    { label: "SERVICE DESCRIPTION", w: 160, align: "left" },
    { label: "Month", w: 55, align: "center" },
    { label: "Rate", w: 60, align: "center" },
    { label: "Amount", w: 70, align: "center" },
  ];
  const headerH = 16;
  let x = MARGIN;
  doc.rect(MARGIN, y, CONTENT_W, headerH).fill(HEADER_FILL);
  doc.font(fontBold).fontSize(7.5).fillColor(DARK);
  for (const col of invColumns) {
    doc.text(col.label, x + 2, y + 4, { width: col.w - 4, align: col.align as any, lineBreak: false });
    x += col.w;
  }
  y += headerH;

  const rowH = 14;
  doc.font(font).fontSize(8).fillColor(DARK);
  for (const item of data.items) {
    if (y + rowH + 8 > PAGE_H - 40) {
      drawFooter(doc, opts, data.refNumber);
      doc.addPage();
      y = MARGIN;
      x = MARGIN;
      doc.rect(MARGIN, y, CONTENT_W, headerH).fill(HEADER_FILL);
      doc.font(fontBold).fontSize(7.5).fillColor(DARK);
      for (const col of invColumns) {
        doc.text(col.label, x + 2, y + 4, { width: col.w - 4, align: col.align as any, lineBreak: false });
        x += col.w;
      }
      y += headerH;
      doc.font(font).fontSize(8).fillColor(DARK);
    }
    const day = new Date(`${item.date}T00:00:00.000Z`);
    const monthLabel = day.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    const cells = [
      fmtMonthDay(day),
      item.courseTitle ?? item.courseCode ?? "",
      item.location ?? "",
      monthLabel,
      item.rate != null ? String(item.rate) : "—",
      item.amount != null ? String(item.amount) : "—",
    ];
    x = MARGIN;
    cells.forEach((text, i) => {
      doc.text(text, x + 2, y + 3, { width: invColumns[i].w - 4, align: invColumns[i].align as any, lineBreak: false });
      x += invColumns[i].w;
    });
    y += rowH;
  }

  // Sub-total.
  y += 4;
  doc.rect(MARGIN, y, CONTENT_W, 16).fill(HEADER_FILL);
  doc.font(fontBold).fontSize(9).fillColor(DARK);
  doc.text("Sub-total", MARGIN + 3, y + 4, { width: 140, lineBreak: false });
  doc.text(`${data.currency} ${data.totalAmount.toLocaleString("en-US")}`, MARGIN + CONTENT_W - 110, y + 4, { width: 100, align: "right", lineBreak: false });
  y += 20;

  // Reimbursable Expenses (empty rows).
  y = drawSectionTitle(doc, opts, y, "Reimbursable Expenses");
  const emptyCols = [
    { label: "DATE", w: 90, align: "center" as const },
    { label: "DESCRIPTION", w: 260, align: "left" as const },
    { label: "AMOUNT", w: 110, align: "center" as const },
  ];
  x = MARGIN;
  doc.rect(MARGIN, y, CONTENT_W, 14).fill(HEADER_FILL);
  doc.font(fontBold).fontSize(7.5).fillColor(DARK);
  for (const col of emptyCols) {
    doc.text(col.label, x + 2, y + 3, { width: col.w - 4, align: col.align, lineBreak: false });
    x += col.w;
  }
  y += 14;
  for (let i = 0; i < 4; i++) {
    doc.moveTo(MARGIN, y + 14).lineTo(MARGIN + CONTENT_W, y + 14).lineWidth(0.3).strokeColor(LIGHT).stroke();
    y += 16;
  }

  // Total.
  y += 4;
  doc.rect(MARGIN, y, CONTENT_W, 18).fill(TOTAL_FILL);
  doc.font(fontBold).fontSize(10).fillColor(DARK);
  doc.text("Total", MARGIN + 3, y + 4, { width: 140, lineBreak: false });
  doc.text(`${data.currency} ${data.totalAmount.toLocaleString("en-US")}`, MARGIN + CONTENT_W - 110, y + 4, { width: 100, align: "right", lineBreak: false });
  y += 28;

  // Signature blocks.
  const sigLabels = ["Consultant", "Project Manager", "Direct Manager", "HR Manager", "CXO"];
  const sigW = (CONTENT_W - 4 * 10) / 5;
  x = MARGIN;
  for (const label of sigLabels) {
    doc.font(fontBold).fontSize(7).fillColor(GRAY).text(label, x, y, { width: sigW, lineBreak: false });
    doc.moveTo(x, y + 16).lineTo(x + sigW - 4, y + 16).lineWidth(0.75).strokeColor(DARK).stroke();
    doc.font(font).fontSize(7).fillColor(GRAY).text("Name / Date", x, y + 20, { width: sigW - 4, lineBreak: false });
    x += sigW + 10;
  }
  y += 38;

  drawFooter(doc, opts, data.refNumber);

  // ── Sheet 2: Timesheet ──
  doc.addPage();
  y = MARGIN;

  doc.rect(MARGIN, y, CONTENT_W, 28).fill(BURGUNDY);
  doc.font(fontBold).fontSize(12).fillColor("#ffffff");
  doc.text("Independent Consultant Timesheet", MARGIN + 8, y + 7, { width: CONTENT_W - 16, lineBreak: false });
  y += 34;

  y = drawFieldPair(doc, opts, y, "Client", "GCC Lab Operations", "Consultant's Name", data.assignedToName);
  y = drawFieldPair(doc, opts, y, "Month / Year", from.toLocaleDateString("en-US", { month: "long", year: "numeric" }), "", "");
  y += 4;

  // Timesheet grid (days 1-31).
  const colDayW = 15;
  const labelW = 70;
  const gridW = labelW + 31 * colDayW;

  // Day numbers header.
  doc.rect(MARGIN, y, gridW, 14).fill(HEADER_FILL);
  doc.font(fontBold).fontSize(6.5).fillColor(DARK);
  doc.text("Day", MARGIN + 2, y + 3, { width: labelW - 4, lineBreak: false });
  for (let d = 1; d <= 31; d++) {
    doc.text(String(d), MARGIN + labelW + (d - 1) * colDayW, y + 3, { width: colDayW, align: "center", lineBreak: false });
  }
  y += 14;

  // Regular hours row.
  doc.rect(MARGIN, y, gridW, 14).fill("#ffffff");
  doc.font(fontBold).fontSize(7).fillColor(DARK);
  doc.text("Regular", MARGIN + 2, y + 3, { width: labelW - 4, lineBreak: false });
  for (let d = 1; d <= 31; d++) {
    const dayDate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), d));
    if (dayDate.getUTCMonth() !== from.getUTCMonth()) {
      doc.rect(MARGIN + labelW + (d - 1) * colDayW, y, colDayW, 14).fill("#f0f0f0");
    } else {
      const matchingItem = data.items.find((item) => {
        const itemDate = new Date(`${item.date}T00:00:00.000Z`);
        return itemDate.getUTCDate() === d && item.unit === "HOURS";
      });
      if (matchingItem) {
        doc.text(String(matchingItem.finalValue), MARGIN + labelW + (d - 1) * colDayW, y + 3, { width: colDayW, align: "center", lineBreak: false });
      }
    }
    doc.moveTo(MARGIN + labelW + d * colDayW, y).lineTo(MARGIN + labelW + d * colDayW, y + 14).lineWidth(0.2).strokeColor(LIGHT).stroke();
  }
  y += 14;

  // OT hours row.
  doc.rect(MARGIN, y, gridW, 14).fill("#fafafa");
  doc.font(fontBold).fontSize(7).fillColor(DARK);
  doc.text("OT", MARGIN + 2, y + 3, { width: labelW - 4, lineBreak: false });
  for (let d = 1; d <= 31; d++) {
    const dayDate = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), d));
    if (dayDate.getUTCMonth() !== from.getUTCMonth()) {
      doc.rect(MARGIN + labelW + (d - 1) * colDayW, y, colDayW, 14).fill("#f0f0f0");
    } else {
      const matchingItem = data.items.find((item) => {
        const itemDate = new Date(`${item.date}T00:00:00.000Z`);
        return itemDate.getUTCDate() === d && item.unit === "HOURS";
      });
      if (matchingItem) {
        doc.text(String(matchingItem.finalValue), MARGIN + labelW + (d - 1) * colDayW, y + 3, { width: colDayW, align: "center", lineBreak: false });
      }
    }
    doc.moveTo(MARGIN + labelW + d * colDayW, y).lineTo(MARGIN + labelW + d * colDayW, y + 14).lineWidth(0.2).strokeColor(LIGHT).stroke();
  }
  y += 14;

  // Total Hours row.
  doc.rect(MARGIN, y, gridW, 16).fill(TOTAL_FILL);
  doc.font(fontBold).fontSize(8).fillColor(DARK);
  doc.text("Total Hours", MARGIN + 2, y + 4, { width: labelW - 4, lineBreak: false });
  doc.text(String(data.totalHours), MARGIN + gridW - 50, y + 4, { width: 45, align: "right", lineBreak: false });
  y += 24;

  // Submission signatures.
  y = drawSignatureBlock(doc, opts, y, [
    { label: "Submitted by (Consultant)", value: data.assignedToName },
    { label: "Project Manager", value: "" },
    { label: "Date", value: "" },
  ]);

  drawFooter(doc, opts, data.refNumber);
  doc.end();
  return done;
}

function titlePeriod(from: Date, to: Date): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).toUpperCase();
  return `${fmt(from)} TO ${fmt(to)}`;
}
