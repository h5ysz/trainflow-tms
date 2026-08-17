// GCCLAB TMS — Claim Excel export builders
// =====================================================================
// Generates Excel workbooks mirroring the real reference sheets:
//   • Overtime claim   → "OT Approval Sheet" (title row, headers B–I:
//     Training, Location, Requested by, Assigned to, DATE, Day, Hours,
//     Session), one row per day, total hours row, signature block, and a
//     "Sheet1" legend sheet — exactly the Yasser Khafji reference layout.
//   • Contractor OT    → the same sheet structure, labeled "Regular Hours"
//     (contractors have no overtime).
//   • Business mission → a "Business Mission" sheet with days/rate/amount.
//   • Summary          → separate Overtime and Business Mission summary sheets
//     per trainer for a month.
// Pure builders: all display data (names, locations, rates) arrives via opts.

import ExcelJS from "exceljs";
import { dayKey, weekdayName } from "../engine";
import type { ClaimListFilters } from "../service";

export interface ClaimExportRow {
  id: string;
  date: string; // YYYY-MM-DD
  courseCode: string | null;
  courseTitle: string | null;
  location: string | null;
  shift: string | null;
  actualHours: number;
  originalValue: number;
  finalValue: number;
  unit: string;
  rate: number | null;
  amount: number | null;
  locationFlagged: boolean;
  coordinatorName: string | null;
}

export interface ClaimExportData {
  refNumber: string;
  claimType: "OVERTIME" | "BUSINESS_MISSION";
  engagementType: "EMPLOYEE" | "CONTRACTOR";
  status: string;
  periodFrom: Date;
  periodTo: Date;
  mainLocation: string | null;
  dailyAllowance: number | null;
  totalHours: number;
  totalDays: number;
  totalAmount: number;
  currency: string;
  requestedByName: string;
  assignedToName: string;
  approvedByName: string;
  trainerNameEn: string;
  trainerNameAr: string | null;
  items: ClaimExportRow[];
  // HRD-FO-052 Employee Overtime fields
  employeeId?: string;
  employeeJobTitle?: string;
  employeeDepartment?: string;
  employeeProject?: string;
  employeeLineManager?: string;
  normalWorkingHoursPerDay?: number;
  estimatedOtPerDay?: number;
  requestedBy?: string;
  reason?: string;
  acknowledgmentAccepted?: boolean;
  lineManagerDecision?: string;
  lineManagerComments?: string;
  lineManagerSignatureBy?: string;
  lineManagerSignatureAt?: string;
  qhseAssessment?: string;
  qhseControls?: string;
  qhseSignatureBy?: string;
  qhseSignatureAt?: string;
  hrDecision?: string;
  hrMaxApprovedOt?: number;
  hrApprovedPeriodFrom?: string;
  hrApprovedPeriodTo?: string;
  hrSignatureBy?: string;
  hrSignatureAt?: string;
  hrComments?: string;
  // Contractor fields
  contractorInvoiceNumber?: string;
  contractorClient?: string;
  contractorRatePerDay?: number;
  createdAt?: Date;
}

function fmtSheetDate(date: Date): string {
  // Excel display dates in the reference are M/D/YYYY (US locale).
  const m = date.getUTCMonth() + 1;
  const d = date.getUTCDate();
  const y = date.getUTCFullYear();
  return `${m}/${d}/${y}`;
}

function titlePeriod(from: Date, to: Date): string {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).toUpperCase();
  return `${fmt(from)} TO ${fmt(to)}`;
}

const HEADER_COLOR = "FFD9E2F3";
const TOTAL_COLOR = "FFFFF2CC";
const BORDER_COLOR = "FF444444";

function headerCell(cell: ExcelJS.Cell) {
  cell.font = { bold: true, size: 11 };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_COLOR } };
  cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  cell.border = { top: { style: "thin", color: { argb: BORDER_COLOR } }, bottom: { style: "thin", color: { argb: BORDER_COLOR } }, left: { style: "thin", color: { argb: BORDER_COLOR } }, right: { style: "thin", color: { argb: BORDER_COLOR } } };
}

function bodyCell(cell: ExcelJS.Cell) {
  cell.font = { size: 10 };
  cell.alignment = { horizontal: "left", vertical: "middle" };
  cell.border = { bottom: { style: "hair", color: { argb: "FFCCCCCC" } } };
}

function setColWidths(sheet: ExcelJS.Worksheet, widths: Array<[string, number]>) {
  for (const [col, width] of widths) {
    sheet.getColumn(col).width = width;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// OT / Regular Hours approval sheet
// ─────────────────────────────────────────────────────────────────────────────

function overtimeSheet(workbook: ExcelJS.Workbook, data: ClaimExportData): ExcelJS.Worksheet {
  const isContractor = data.engagementType === "CONTRACTOR";
  const sheet = workbook.addWorksheet(isContractor ? "Regular Hours" : "OT Approval Sheet");

  // Title row (A1), styled to match the reference: bold, centered across B:I.
  const title = `${isContractor ? "REGULAR HOURS" : "OT APPROVAL"} SHEET ${titlePeriod(data.periodFrom, data.periodTo)} ${(data.mainLocation ?? "").toUpperCase()}`.trim();
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.mergeCells("A1:I1");
  sheet.getRow(1).height = 28;

  // Headers (row 2), columns B–I exactly like the reference sheet.
  const headers = ["Training", "Location", "Requested by", "Assigned to", "DATE", "Day", "Hours", "Session"];
  const colLetters = ["B", "C", "D", "E", "F", "G", "H", "I"];
  headers.forEach((h, i) => {
    sheet.getCell(`${colLetters[i]}2`).value = h;
    headerCell(sheet.getCell(`${colLetters[i]}2`));
  });
  sheet.getRow(2).height = 24;

  let r = 3;
  for (const item of data.items) {
    const day = new Date(`${item.date}T00:00:00.000Z`);
    // Employee: weekend single-session days render "M/E" (morning+evening) as in
    // the reference; weekday rows keep their shift. Contractor rows keep shift.
    const isWeekend = day.getUTCDay() === 5 || day.getUTCDay() === 6;
    const sessionLabel =
      !isContractor && isWeekend && item.finalValue >= 12 ? "M/E" : item.shift ?? "";
    const row = sheet.getRow(r);
    row.getCell("B").value = item.courseTitle ?? item.courseCode ?? "";
    row.getCell("C").value = item.location ?? "";
    row.getCell("D").value = data.requestedByName;
    row.getCell("E").value = data.assignedToName;
    row.getCell("F").value = fmtSheetDate(day);
    row.getCell("G").value = weekdayName(day.getUTCDay());
    row.getCell("H").value = item.finalValue;
    row.getCell("I").value = sessionLabel;
    ["B", "C", "D", "E", "F", "G", "H", "I"].forEach((c) => bodyCell(row.getCell(c)));
    row.getCell("F").alignment = { horizontal: "center" };
    row.getCell("G").alignment = { horizontal: "center" };
    row.getCell("H").alignment = { horizontal: "center" };
    row.getCell("I").alignment = { horizontal: "center" };
    r++;
  }

  // Total row.
  const totalLabel = isContractor ? "Total Regular Hours" : "Total OT Hours";
  sheet.getCell(`B${r}`).value = totalLabel;
  sheet.getCell(`B${r}`).font = { bold: true };
  sheet.getCell(`H${r}`).value = { formula: `SUM(H3:H${r - 1})` };
  sheet.getCell(`H${r}`).font = { bold: true };
  ["B", "C", "D", "E", "F", "G", "H", "I"].forEach((c) => {
    sheet.getCell(`${c}${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_COLOR } };
    sheet.getCell(`${c}${r}`).border = { top: { style: "thin", color: { argb: BORDER_COLOR } }, bottom: { style: "thin", color: { argb: BORDER_COLOR } } };
  });
  const totalRow = r;
  r += 2;

  // Signature block (per spec §19 + sheet headers): Requested By = Coordinator,
  // Assigned To = Trainer, Approved By = Authorized Approver.
  sheet.getCell(`B${r}`).value = "Requested By";
  sheet.getCell(`C${r}`).value = data.requestedByName;
  sheet.getCell(`F${r}`).value = "Approved By:";
  sheet.getCell(`G${r}`).value = data.approvedByName;
  ["B", "C", "F", "G"].forEach((c) => {
    sheet.getCell(`${c}${r}`).font = { bold: true };
  });

  setColWidths(sheet, [
    ["A", 2],
    ["B", 26],
    ["C", 16],
    ["D", 22],
    ["E", 22],
    ["F", 12],
    ["G", 12],
    ["H", 9],
    ["I", 12],
  ]);

  sheet.views = [{ state: "frozen", ySplit: 2 }];
  return sheet;
}

function legendSheet(workbook: ExcelJS.Workbook, data: ClaimExportData): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("Sheet1");
  const sections: Array<[string, string[]]> = [
    ["Assigned By", [data.requestedByName]],
    ["Assigned To", [data.trainerNameEn]],
    ["Locations", data.mainLocation ? [data.mainLocation] : []],
    ["Week Days", ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]],
    ["OT Hours", ["0", "4", "12"]],
  ];
  let r = 1;
  for (const [title, values] of sections) {
    sheet.getCell(`A${r}`).value = title;
    sheet.getCell(`A${r}`).font = { bold: true };
    values.forEach((v, i) => {
      sheet.getCell(`B${r + i}`).value = v;
    });
    r += Math.max(values.length, 1) + 1;
  }
  return sheet;
}

// ─────────────────────────────────────────────────────────────────────────────
// Business mission sheet
// ─────────────────────────────────────────────────────────────────────────────

function businessMissionSheet(workbook: ExcelJS.Workbook, data: ClaimExportData): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("Business Mission");

  sheet.getCell("A1").value = `BUSINESS MISSION SHEET ${titlePeriod(data.periodFrom, data.periodTo)} ${(data.mainLocation ?? "").toUpperCase()}`.trim();
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.mergeCells("A1:I1");
  sheet.getRow(1).height = 28;

  const headers = ["Training", "Location", "Requested by", "Assigned to", "DATE", "Day", "Session", "Days", "Rate (SAR)", "Amount (SAR)"];
  const colLetters = ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"];
  headers.forEach((h, i) => {
    sheet.getCell(`${colLetters[i]}2`).value = h;
    headerCell(sheet.getCell(`${colLetters[i]}2`));
  });
  sheet.getRow(2).height = 24;

  let r = 3;
  for (const item of data.items) {
    const day = new Date(`${item.date}T00:00:00.000Z`);
    const row = sheet.getRow(r);
    row.getCell("B").value = item.courseTitle ?? item.courseCode ?? "";
    row.getCell("C").value = item.location ?? "";
    row.getCell("D").value = data.requestedByName;
    row.getCell("E").value = data.assignedToName;
    row.getCell("F").value = fmtSheetDate(day);
    row.getCell("G").value = weekdayName(day.getUTCDay());
    row.getCell("H").value = item.shift ?? "";
    row.getCell("I").value = item.finalValue;
    row.getCell("J").value = item.rate ?? "";
    row.getCell("K").value = item.amount ?? "";
    colLetters.forEach((c) => bodyCell(row.getCell(c)));
    ["F", "G", "H", "I", "J", "K"].forEach((c) => (row.getCell(c).alignment = { horizontal: "center" }));
    r++;
  }

  sheet.getCell(`B${r}`).value = "Total Mission Days / Amount";
  sheet.getCell(`B${r}`).font = { bold: true };
  sheet.getCell(`I${r}`).value = data.totalDays;
  sheet.getCell(`K${r}`).value = data.totalAmount;
  ["B", "C", "D", "E", "F", "G", "H", "I", "J", "K"].forEach((c) => {
    sheet.getCell(`${c}${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_COLOR } };
    sheet.getCell(`${c}${r}`).font = { bold: true };
  });
  r += 2;

  sheet.getCell(`B${r}`).value = "Requested By";
  sheet.getCell(`C${r}`).value = data.requestedByName;
  sheet.getCell(`F${r}`).value = "Approved By:";
  sheet.getCell(`G${r}`).value = data.approvedByName;
  ["B", "C", "F", "G"].forEach((c) => (sheet.getCell(`${c}${r}`).font = { bold: true }));

  setColWidths(sheet, [
    ["A", 2],
    ["B", 26],
    ["C", 16],
    ["D", 22],
    ["E", 22],
    ["F", 12],
    ["G", 12],
    ["H", 12],
    ["I", 9],
    ["J", 12],
    ["K", 14],
  ]);
  return sheet;
}

// ─────────────────────────────────────────────────────────────────────────────
// HRD-FO-052 Extended Overtime Request & Employee Acknowledgment Form
// ─────────────────────────────────────────────────────────────────────────────

function hrdFo052Sheet(workbook: ExcelJS.Workbook, data: ClaimExportData): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("HRD-FO-052");

  // Row 1 — Title
  sheet.mergeCells("A1:G1");
  sheet.getCell("A1").value = "HRD-FO-052 | EXTENDED OVERTIME REQUEST & EMPLOYEE ACKNOWLEDGMENT FORM";
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 30;

  // Row 2 — Issue Date & Revision
  sheet.mergeCells("A2:G2");
  const today = new Date();
  const issueDate = `${today.getUTCMonth() + 1}/${today.getUTCDate()}/${today.getUTCFullYear()}`;
  sheet.getCell("A2").value = `Issue Date: ${issueDate} | Revision: 00`;
  sheet.getCell("A2").font = { size: 10, italic: true };
  sheet.getCell("A2").alignment = { horizontal: "center" };

  // ── Section 1: Employee Information ──
  let r = 4;
  sheet.mergeCells(`A${r}:G${r}`);
  sheet.getCell(`A${r}`).value = "Section 1: Employee Information";
  sheet.getCell(`A${r}`).font = { bold: true, size: 11 };
  sheet.getCell(`A${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_COLOR } };
  sheet.getCell(`A${r}`).border = { top: { style: "thin", color: { argb: BORDER_COLOR } }, bottom: { style: "thin", color: { argb: BORDER_COLOR } } };

  const empInfo: Array<[string, string, string, string]> = [
    ["Employee Name", data.assignedToName, "Employee ID", data.employeeId ?? ""],
    ["Job Title", data.employeeJobTitle ?? "", "Department / Company", data.employeeDepartment ?? ""],
    ["Project / Work Location", data.employeeProject ?? "", "Line Manager", data.employeeLineManager ?? ""],
  ];
  for (const [l1, v1, l2, v2] of empInfo) {
    r++;
    sheet.getCell(`A${r}`).value = l1;
    sheet.getCell(`A${r}`).font = { bold: true, size: 10 };
    sheet.getCell(`B${r}`).value = v1;
    sheet.getCell(`B${r}`).font = { size: 10 };
    sheet.getCell(`D${r}`).value = l2;
    sheet.getCell(`D${r}`).font = { bold: true, size: 10 };
    sheet.getCell(`E${r}`).value = v2;
    sheet.getCell(`E${r}`).font = { size: 10 };
  }

  // ── Section 2: Extended Overtime Details ──
  r += 2;
  sheet.mergeCells(`A${r}:G${r}`);
  sheet.getCell(`A${r}`).value = "Section 2: Extended Overtime Details";
  sheet.getCell(`A${r}`).font = { bold: true, size: 11 };
  sheet.getCell(`A${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_COLOR } };
  sheet.getCell(`A${r}`).border = { top: { style: "thin", color: { argb: BORDER_COLOR } }, bottom: { style: "thin", color: { argb: BORDER_COLOR } } };

  r++;
  sheet.getCell(`A${r}`).value = "Requested OT Period";
  sheet.getCell(`A${r}`).font = { bold: true, size: 10 };
  sheet.mergeCells(`B${r}:E${r}`);
  sheet.getCell(`B${r}`).value = `From ${fmtSheetDate(data.periodFrom)} To ${fmtSheetDate(data.periodTo)}`;
  sheet.getCell(`B${r}`).font = { size: 10 };

  r++;
  sheet.getCell(`A${r}`).value = "Normal Working Hours / Day";
  sheet.getCell(`A${r}`).font = { bold: true, size: 10 };
  sheet.getCell(`B${r}`).value = data.normalWorkingHoursPerDay ?? "";
  sheet.getCell(`B${r}`).font = { size: 10 };
  sheet.getCell(`D${r}`).value = "Estimated OT / Day";
  sheet.getCell(`D${r}`).font = { bold: true, size: 10 };
  sheet.getCell(`E${r}`).value = data.estimatedOtPerDay ?? "";
  sheet.getCell(`E${r}`).font = { size: 10 };

  r++;
  sheet.getCell(`A${r}`).value = "Requested / Initiated By";
  sheet.getCell(`A${r}`).font = { bold: true, size: 10 };
  sheet.getCell(`B${r}`).value = data.requestedBy ?? data.requestedByName;
  sheet.getCell(`B${r}`).font = { size: 10 };

  r++;
  sheet.getCell(`A${r}`).value = "Reason";
  sheet.getCell(`A${r}`).font = { bold: true, size: 10 };
  sheet.mergeCells(`B${r}:E${r}`);
  sheet.getCell(`B${r}`).value = data.reason ?? "";
  sheet.getCell(`B${r}`).font = { size: 10 };

  // ── OT Calculation Table ──
  r += 2;
  const otHeaders = ["Training", "Location", "Requested by", "Assigned to", "DATE", "Day", "Hours"];
  const otCols = ["A", "B", "C", "D", "E", "F", "G"];
  otHeaders.forEach((h, i) => {
    sheet.getCell(`${otCols[i]}${r}`).value = h;
    headerCell(sheet.getCell(`${otCols[i]}${r}`));
  });

  for (const item of data.items) {
    r++;
    const day = new Date(`${item.date}T00:00:00.000Z`);
    const row = sheet.getRow(r);
    row.getCell("A").value = item.courseTitle ?? item.courseCode ?? "";
    row.getCell("B").value = item.location ?? "";
    row.getCell("C").value = data.requestedBy ?? data.requestedByName;
    row.getCell("D").value = data.assignedToName;
    row.getCell("E").value = fmtSheetDate(day);
    row.getCell("F").value = weekdayName(day.getUTCDay());
    row.getCell("G").value = item.finalValue;
    otCols.forEach((c) => bodyCell(row.getCell(c)));
    ["E", "F", "G"].forEach((c) => (row.getCell(c).alignment = { horizontal: "center" }));
  }

  // Total OT Hours
  r++;
  sheet.getCell(`A${r}`).value = "Total OT Hours";
  sheet.getCell(`A${r}`).font = { bold: true };
  sheet.getCell(`G${r}`).value = data.totalHours;
  sheet.getCell(`G${r}`).font = { bold: true };
  otCols.forEach((c) => {
    sheet.getCell(`${c}${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_COLOR } };
    sheet.getCell(`${c}${r}`).border = { top: { style: "thin", color: { argb: BORDER_COLOR } }, bottom: { style: "thin", color: { argb: BORDER_COLOR } } };
  });

  // ── Section 3: Employee Acknowledgment ──
  r += 2;
  sheet.mergeCells(`A${r}:G${r}`);
  sheet.getCell(`A${r}`).value = "Section 3: Employee Acknowledgment";
  sheet.getCell(`A${r}`).font = { bold: true, size: 11 };
  sheet.getCell(`A${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_COLOR } };
  sheet.getCell(`A${r}`).border = { top: { style: "thin", color: { argb: BORDER_COLOR } }, bottom: { style: "thin", color: { argb: BORDER_COLOR } } };

  const clauses = [
    "1. I confirm that the overtime hours requested above were actually worked and are accurate.",
    "2. I understand that unauthorized overtime is not eligible for compensation.",
    "3. I acknowledge that this request is subject to approval by my Line Manager and HR.",
    "4. I understand that false claims may result in disciplinary action.",
  ];
  for (const clause of clauses) {
    r++;
    sheet.mergeCells(`A${r}:G${r}`);
    sheet.getCell(`A${r}`).value = clause;
    sheet.getCell(`A${r}`).font = { size: 10 };
  }

  r += 2;
  sheet.getCell(`A${r}`).value = "Employee Signature: ___________________";
  sheet.getCell(`A${r}`).font = { bold: true, size: 10 };
  sheet.getCell(`E${r}`).value = "Date: ___________";
  sheet.getCell(`E${r}`).font = { bold: true, size: 10 };

  // ── Sections 4-6: Signature blocks ──
  const sigSections = ["Section 4: Line Manager Approval", "Section 5: QHSE Review", "Section 6: HR Review"];
  for (const section of sigSections) {
    r += 2;
    sheet.mergeCells(`A${r}:G${r}`);
    sheet.getCell(`A${r}`).value = section;
    sheet.getCell(`A${r}`).font = { bold: true, size: 11 };
    sheet.getCell(`A${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_COLOR } };
    sheet.getCell(`A${r}`).border = { top: { style: "thin", color: { argb: BORDER_COLOR } }, bottom: { style: "thin", color: { argb: BORDER_COLOR } } };
    r += 2;
    sheet.getCell(`A${r}`).value = "Signature: ___________________";
    sheet.getCell(`A${r}`).font = { size: 10 };
    sheet.getCell(`E${r}`).value = "Date: ___________";
    sheet.getCell(`E${r}`).font = { size: 10 };
    r++;
    sheet.getCell(`A${r}`).value = "Name: ___________________";
    sheet.getCell(`A${r}`).font = { size: 10 };
  }

  setColWidths(sheet, [
    ["A", 24],
    ["B", 24],
    ["C", 3],
    ["D", 24],
    ["E", 22],
    ["F", 12],
    ["G", 10],
  ]);

  return sheet;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contractor Invoice
// ─────────────────────────────────────────────────────────────────────────────

function contractorInvoiceSheet(workbook: ExcelJS.Workbook, data: ClaimExportData): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("Contractor Invoice");

  // Row 1 — Form reference
  sheet.mergeCells("A1:F1");
  sheet.getCell("A1").value = "GCCLAB-095 (07/20)";
  sheet.getCell("A1").font = { bold: true, size: 12 };
  sheet.getCell("A1").alignment = { horizontal: "center" };

  // Row 2 — Title
  sheet.mergeCells("A2:F2");
  sheet.getCell("A2").value = "Consultancy Service Invoice";
  sheet.getCell("A2").font = { bold: true, size: 14 };
  sheet.getCell("A2").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(2).height = 28;

  // Row 3 — Invoice details
  sheet.mergeCells("A3:F3");
  const invoiceDate = data.createdAt ? fmtSheetDate(data.createdAt) : "";
  sheet.getCell("A3").value = `Invoice Period: ${titlePeriod(data.periodFrom, data.periodTo)} | Invoice No: ${data.contractorInvoiceNumber ?? ""} | Date: ${invoiceDate}`;
  sheet.getCell("A3").font = { size: 10 };
  sheet.getCell("A3").alignment = { horizontal: "center" };

  // Row 4 — From / To
  sheet.mergeCells("A4:F4");
  sheet.getCell("A4").value = `From: ${data.assignedToName} (Consultant) | To: ${data.contractorClient ?? "GCC Lab"} (Company)`;
  sheet.getCell("A4").font = { size: 10 };
  sheet.getCell("A4").alignment = { horizontal: "center" };

  // Row 6 — Table headers
  const invHeaders = ["DATE", "PROJECT", "SERVICE DESCRIPTION (LABOR)", "Month", "Rate", "Amount"];
  const invCols = ["A", "B", "C", "D", "E", "F"];
  let r = 6;
  invHeaders.forEach((h, i) => {
    sheet.getCell(`${invCols[i]}${r}`).value = h;
    headerCell(sheet.getCell(`${invCols[i]}${r}`));
  });

  for (const item of data.items) {
    r++;
    const day = new Date(`${item.date}T00:00:00.000Z`);
    const monthYear = `${day.getUTCMonth() + 1}/${day.getUTCFullYear()}`;
    const row = sheet.getRow(r);
    row.getCell("A").value = fmtSheetDate(day);
    row.getCell("B").value = item.courseTitle ?? item.courseCode ?? "";
    row.getCell("C").value = item.courseTitle ?? item.courseCode ?? "";
    row.getCell("D").value = monthYear;
    row.getCell("E").value = item.rate ?? "";
    row.getCell("F").value = item.amount ?? "";
    invCols.forEach((c) => bodyCell(row.getCell(c)));
    ["A", "D", "E", "F"].forEach((c) => (row.getCell(c).alignment = { horizontal: "center" }));
  }

  // Sub-total
  r++;
  sheet.mergeCells(`A${r}:E${r}`);
  sheet.getCell(`A${r}`).value = "Sub-total (SAR):";
  sheet.getCell(`A${r}`).font = { bold: true };
  sheet.getCell(`A${r}`).alignment = { horizontal: "right" };
  sheet.getCell(`F${r}`).value = data.totalAmount;
  sheet.getCell(`F${r}`).font = { bold: true };
  invCols.forEach((c) => {
    sheet.getCell(`${c}${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_COLOR } };
  });

  // Reimbursable Expenses
  r += 2;
  sheet.mergeCells(`A${r}:F${r}`);
  sheet.getCell(`A${r}`).value = "Reimbursable Expenses";
  sheet.getCell(`A${r}`).font = { bold: true, size: 11 };
  sheet.getCell(`A${r}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_COLOR } };
  sheet.getCell(`A${r}`).border = { top: { style: "thin", color: { argb: BORDER_COLOR } }, bottom: { style: "thin", color: { argb: BORDER_COLOR } } };

  r += 2;
  sheet.mergeCells(`A${r}:F${r}`);
  sheet.getCell(`A${r}`).value = "(None)";
  sheet.getCell(`A${r}`).font = { italic: true, size: 10 };

  // Total
  r += 2;
  sheet.mergeCells(`A${r}:E${r}`);
  sheet.getCell(`A${r}`).value = "Total (SAR):";
  sheet.getCell(`A${r}`).font = { bold: true, size: 12 };
  sheet.getCell(`A${r}`).alignment = { horizontal: "right" };
  sheet.getCell(`F${r}`).value = data.totalAmount;
  sheet.getCell(`F${r}`).font = { bold: true, size: 12 };

  // Signature blocks
  r += 2;
  const sigRoles = ["Consultant", "Project Manager", "Direct Manager", "HR Manager", "CXO"];
  for (const role of sigRoles) {
    sheet.getCell(`A${r}`).value = `${role}:`;
    sheet.getCell(`A${r}`).font = { bold: true, size: 10 };
    sheet.getCell(`C${r}`).value = "Signature: ___________________";
    sheet.getCell(`C${r}`).font = { size: 10 };
    sheet.getCell(`E${r}`).value = "Date: ___________";
    sheet.getCell(`E${r}`).font = { size: 10 };
    r += 2;
  }

  setColWidths(sheet, [
    ["A", 14],
    ["B", 22],
    ["C", 30],
    ["D", 12],
    ["E", 10],
    ["F", 14],
  ]);

  return sheet;
}

// ─────────────────────────────────────────────────────────────────────────────
// Contractor Timesheet
// ─────────────────────────────────────────────────────────────────────────────

function contractorTimesheetSheet(workbook: ExcelJS.Workbook, data: ClaimExportData): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet("Contractor Timesheet");

  // Header
  sheet.mergeCells("A1:AG1");
  sheet.getCell("A1").value = "Independent Consultant Timesheet";
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 28;

  // Client & Consultant info
  sheet.getCell("A2").value = `Client: ${data.contractorClient ?? "GCC Lab Operations"}`;
  sheet.getCell("A2").font = { bold: true, size: 10 };
  sheet.getCell("A3").value = `Consultant's Name: ${data.assignedToName}`;
  sheet.getCell("A3").font = { bold: true, size: 10 };
  sheet.getCell("A4").value = `Month: ${data.periodFrom.getUTCMonth() + 1}`;
  sheet.getCell("A4").font = { size: 10 };
  sheet.getCell("C4").value = `Year: ${data.periodFrom.getUTCFullYear()}`;
  sheet.getCell("C4").font = { size: 10 };

  // Day columns header (row 6)
  const hdrRow = 6;
  sheet.getCell(hdrRow, 1).value = "";
  headerCell(sheet.getCell(hdrRow, 1));
  for (let day = 1; day <= 31; day++) {
    const cell = sheet.getCell(hdrRow, day + 1);
    cell.value = day;
    headerCell(cell);
  }
  const totalColIdx = 33; // column AG
  const totalCell = sheet.getCell(hdrRow, totalColIdx);
  totalCell.value = "Total";
  headerCell(totalCell);

  // Group items by day
  const hoursByDay: Record<number, { regular: number; ot: number }> = {};
  for (const item of data.items) {
    const day = new Date(`${item.date}T00:00:00.000Z`);
    const dayNum = day.getUTCDate();
    if (!hoursByDay[dayNum]) hoursByDay[dayNum] = { regular: 0, ot: 0 };
    hoursByDay[dayNum].regular += item.finalValue;
  }

  // Regular Hours row
  const regRow = hdrRow + 1;
  sheet.getCell(regRow, 1).value = "Regular Hours";
  sheet.getCell(regRow, 1).font = { bold: true, size: 10 };
  let regTotal = 0;
  for (let day = 1; day <= 31; day++) {
    const cell = sheet.getCell(regRow, day + 1);
    const hrs = hoursByDay[day]?.regular ?? 0;
    cell.value = hrs > 0 ? hrs : "";
    cell.alignment = { horizontal: "center" };
    cell.font = { size: 9 };
    cell.border = { bottom: { style: "hair", color: { argb: "FFCCCCCC" } } };
    regTotal += hrs;
  }
  const regTotalCell = sheet.getCell(regRow, totalColIdx);
  regTotalCell.value = regTotal;
  regTotalCell.font = { bold: true, size: 9 };
  regTotalCell.alignment = { horizontal: "center" };
  regTotalCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_COLOR } };

  // OT Hours row
  const otRow = hdrRow + 2;
  sheet.getCell(otRow, 1).value = "OT Hours";
  sheet.getCell(otRow, 1).font = { bold: true, size: 10 };
  let otTotal = 0;
  for (let day = 1; day <= 31; day++) {
    const cell = sheet.getCell(otRow, day + 1);
    const hrs = hoursByDay[day]?.ot ?? 0;
    cell.value = hrs > 0 ? hrs : "";
    cell.alignment = { horizontal: "center" };
    cell.font = { size: 9 };
    cell.border = { bottom: { style: "hair", color: { argb: "FFCCCCCC" } } };
    otTotal += hrs;
  }
  const otTotalCell = sheet.getCell(otRow, totalColIdx);
  otTotalCell.value = otTotal;
  otTotalCell.font = { bold: true, size: 9 };
  otTotalCell.alignment = { horizontal: "center" };
  otTotalCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_COLOR } };

  // Total Hours row
  const totalRow = otRow + 1;
  sheet.getCell(totalRow, 1).value = "Total Hours";
  sheet.getCell(totalRow, 1).font = { bold: true, size: 10 };
  for (let day = 1; day <= 31; day++) {
    const cell = sheet.getCell(totalRow, day + 1);
    const hrs = (hoursByDay[day]?.regular ?? 0) + (hoursByDay[day]?.ot ?? 0);
    cell.value = hrs > 0 ? hrs : "";
    cell.alignment = { horizontal: "center" };
    cell.font = { bold: true, size: 9 };
    cell.border = { top: { style: "thin", color: { argb: BORDER_COLOR } }, bottom: { style: "thin", color: { argb: BORDER_COLOR } } };
  }
  const grandTotalCell = sheet.getCell(totalRow, totalColIdx);
  grandTotalCell.value = regTotal + otTotal;
  grandTotalCell.font = { bold: true, size: 9 };
  grandTotalCell.alignment = { horizontal: "center" };
  grandTotalCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TOTAL_COLOR } };

  // Set column widths
  sheet.getColumn(1).width = 16;
  for (let day = 1; day <= 31; day++) {
    sheet.getColumn(day + 1).width = 4;
  }
  sheet.getColumn(totalColIdx).width = 8;

  return sheet;
}

// ─────────────────────────────────────────────────────────────────────────────
// Monthly summary
// ─────────────────────────────────────────────────────────────────────────────

export interface SummaryRow {
  trainerId: string;
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

export function buildSummaryWorkbook(
  month: string,
  summary: SummaryRow[],
  opts: { mainLocation: string | null; requestedByName: string; approvedByName: string },
): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GCCLAB TMS";
  workbook.created = new Date();

  const ot = workbook.addWorksheet("Overtime Summary");
  const otHeaders = ["Trainer Ref", "Trainer Name", "Engagement", "Claim", "Status", "Period", "OT / Regular Hours", "Currency"];
  ot.getRow(1).values = ["Overtime Summary — " + month, ...otHeaders.slice(1)];
  ot.getCell("A1").font = { bold: true, size: 13 };
  ot.mergeCells("A1:H1");
  const otHeaderRow = ot.getRow(2);
  otHeaders.forEach((h, i) => {
    otHeaderRow.getCell(i + 1).value = h;
    headerCell(otHeaderRow.getCell(i + 1));
  });
  let r = 3;
  for (const row of summary.filter((s) => s.totalHours > 0)) {
    ot.getRow(r).values = [row.trainerRef, row.trainerNameEn, row.engagementType, row.claimRef, row.status, `${row.periodFrom} → ${row.periodTo}`, row.totalHours, row.currency];
    ot.getRow(r).eachCell((c) => bodyCell(c));
    r++;
  }

  const bm = workbook.addWorksheet("Business Mission Summary");
  const bmHeaders = ["Trainer Ref", "Trainer Name", "Engagement", "Claim", "Status", "Period", "Days", "Amount", "Currency"];
  bm.getRow(1).values = ["Business Mission Summary — " + month, ...bmHeaders.slice(1)];
  bm.getCell("A1").font = { bold: true, size: 13 };
  bm.mergeCells("A1:I1");
  const bmHeaderRow = bm.getRow(2);
  bmHeaders.forEach((h, i) => {
    bmHeaderRow.getCell(i + 1).value = h;
    headerCell(bmHeaderRow.getCell(i + 1));
  });
  r = 3;
  for (const row of summary.filter((s) => s.totalDays > 0)) {
    bm.getRow(r).values = [row.trainerRef, row.trainerNameEn, row.engagementType, row.claimRef, row.status, `${row.periodFrom} → ${row.periodTo}`, row.totalDays, row.totalAmount, row.currency];
    bm.getRow(r).eachCell((c) => bodyCell(c));
    r++;
  }

  const totalLabelRow = Math.max(r, 4);
  bm.getCell(`A${totalLabelRow}`).value = "Total (SAR)";
  bm.getCell(`A${totalLabelRow}`).font = { bold: true };
  bm.getCell(`I${totalLabelRow}`).value = { formula: `SUM(I3:I${totalLabelRow - 1})` };

  return workbook;
}

export async function workbookBuffer(workbook: ExcelJS.Workbook): Promise<Uint8Array> {
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

// ─────────────────────────────────────────────────────────────────────────────
// Workbook builder dispatch
// ─────────────────────────────────────────────────────────────────────────────

export function buildClaimWorkbook(data: ClaimExportData): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GCCLAB TMS";
  workbook.created = new Date();
  if (data.claimType === "BUSINESS_MISSION") {
    businessMissionSheet(workbook, data);
  } else if (data.engagementType === "CONTRACTOR") {
    contractorInvoiceSheet(workbook, data);
    contractorTimesheetSheet(workbook, data);
  } else {
    hrdFo052Sheet(workbook, data);
    overtimeSheet(workbook, data);
    legendSheet(workbook, data);
  }
  return workbook;
}

export function claimExportRows(data: ClaimExportData): ClaimExportRow[] {
  return data.items;
}

export type { ClaimListFilters };
