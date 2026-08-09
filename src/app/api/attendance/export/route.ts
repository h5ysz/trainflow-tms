// /api/attendance/export — Professional Enterprise Attendance Sheet
// =====================================================================
// Generates a printable A4 landscape attendance sheet for a training session.
//
// Based on the original GCCLAB attendance template with professional improvements:
// - GCCLAB branding header (logo placeholder + bilingual company name)
// - Training information section (11 fields)
// - Trainee table (9 columns, frozen header, alternating rows)
// - Footer with trainer + company rep signatures + attendance summary
// - A4 landscape, fit-to-width, clean print layout
// - Grid lines hidden for professional appearance
//
// Query: sessionId (required)
// Auth: attendance.view
import { NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { withModuleAction, fail } from "@/lib/auth/api";

export const GET = withModuleAction("attendance", "view", async ({ req }) => {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) return fail("sessionId is required", 422, "VALIDATION_ERROR");

  const session = await db.trainingSession.findUnique({
    where: { id: sessionId },
    include: {
      course: { select: { id: true, title: true, code: true, durationHours: true } },
      trainer: { select: { id: true, nameEn: true, refNumber: true } },
      attendance: {
        where: { deletedAt: null },
        orderBy: { traineeName: "asc" },
      },
    },
  });
  if (!session || session.deletedAt) return fail("Session not found", 404, "NOT_FOUND");

  // ── Workbook ────────────────────────────────────────────────────────
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GCCLAB TMS";
  workbook.created = new Date();
  workbook.title = "Attendance Sheet";

  const sheet = workbook.addWorksheet("Attendance", {
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    },
    properties: { defaultRowHeight: 20 },
    views: [{ showGridLines: false }],
  });

  // ── Column widths (9 columns) ───────────────────────────────────────
  sheet.columns = [
    { width: 6 },   // A: No.
    { width: 32 },  // B: Full Name
    { width: 18 },  // C: National ID / Iqama
    { width: 22 },  // D: Company
    { width: 18 },  // E: Job Title
    { width: 16 },  // F: Mobile
    { width: 18 },  // G: Morning Signature
    { width: 18 },  // H: Check-Out Signature
    { width: 22 },  // I: Remarks
  ];

  const BURGUNDY = "FF7B1E2B";
  const LIGHT_BG = "FFF5E6E8";
  const GOLD = "FFC9A961";
  const WHITE = "FFFFFFFF";
  const DARK = "FF333333";
  const GRAY_BG = "FFF8F8F8";
  const BORDER = "FFCCCCCC";
  const HAIR = "FFDDDDDD";

  const fmtDate = (d: Date | null) => d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—";
  const fmtTime = (d: Date | null) => d ? new Date(d).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "—";

  // Helper: apply border to a cell
  const setBorder = (cell: ExcelJS.Cell, sides: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean }, style: "thin" | "medium" = "thin", color = BORDER) => {
    cell.border = {
      top: sides.top ? { style, color: { argb: color } } : cell.border?.top,
      bottom: sides.bottom ? { style, color: { argb: color } } : cell.border?.bottom,
      left: sides.left ? { style, color: { argb: color } } : cell.border?.left,
      right: sides.right ? { style, color: { argb: color } } : cell.border?.right,
    };
  };

  let r = 1;

  // ════════════════════════════════════════════════════════════════════
  // SECTION 1: GCCLAB HEADER (rows 1-3)
  // ════════════════════════════════════════════════════════════════════

  // Row 1: [Logo placeholder] | [Company name]
  sheet.mergeCells(`A${r}:B${r}`);
  const logoCell = sheet.getCell(`A${r}`);
  logoCell.value = "[ GCCLAB LOGO ]";
  logoCell.font = { bold: true, size: 11, color: { argb: BURGUNDY } };
  logoCell.alignment = { horizontal: "center", vertical: "middle" };
  logoCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BG } };
  setBorder(logoCell, { top: true, left: true, right: true });

  sheet.mergeCells(`C${r}:I${r}`);
  const titleCell = sheet.getCell(`C${r}`);
  titleCell.value = "GULF CALIBRATION LABORATORY";
  titleCell.font = { bold: true, size: 18, color: { argb: BURGUNDY } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BG } };
  setBorder(titleCell, { top: true, right: true });

  sheet.getRow(r).height = 32;
  r++;

  // Row 2: Bilingual subtitle
  sheet.mergeCells(`A${r}:I${r}`);
  const subCell = sheet.getCell(`A${r}`);
  subCell.value = "المختبر الخليجي للمعايرة  —  TRAINING ATTENDANCE SHEET";
  subCell.font = { bold: true, size: 11, color: { argb: DARK } };
  subCell.alignment = { horizontal: "center", vertical: "middle" };
  subCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BG } };
  setBorder(subCell, { left: true, right: true, bottom: true });
  sheet.getRow(r).height = 22;
  r++;

  // Spacer
  sheet.getRow(r).height = 6;
  r++;

  // ════════════════════════════════════════════════════════════════════
  // SECTION 2: TRAINING INFORMATION (5 rows × 2 columns each)
  // ════════════════════════════════════════════════════════════════════

  const infoPairs: Array<[string, string, string, string]> = [
    ["Training Course", session.course?.title ?? "—", "Session Number", session.refNumber ?? "—"],
    ["Training Request", session.requestId ?? "—", "Company Name", "—"],
    ["Trainer Name", session.trainer?.nameEn ?? "—", "Training Location", session.location ?? session.venue ?? session.city ?? "—"],
    ["Start Date", fmtDate(session.startDate), "End Date", fmtDate(session.endDate)],
    ["Start Time", fmtTime(session.startDate), "End Time", fmtTime(session.endDate)],
  ];

  for (const [label1, value1, label2, value2] of infoPairs) {
    // Label 1 (A-B)
    sheet.mergeCells(`A${r}:B${r}`);
    const l1 = sheet.getCell(`A${r}`);
    l1.value = label1;
    l1.font = { bold: true, size: 9, color: { argb: BURGUNDY } };
    l1.alignment = { horizontal: "right", vertical: "middle" };
    l1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_BG } };
    setBorder(l1, { top: true, left: true });

    // Value 1 (C-E)
    sheet.mergeCells(`C${r}:E${r}`);
    const v1 = sheet.getCell(`C${r}`);
    v1.value = value1;
    v1.font = { size: 10, color: { argb: DARK } };
    v1.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    setBorder(v1, { top: true });

    // Label 2 (F)
    const l2 = sheet.getCell(`F${r}`);
    l2.value = label2;
    l2.font = { bold: true, size: 9, color: { argb: BURGUNDY } };
    l2.alignment = { horizontal: "right", vertical: "middle" };
    l2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_BG } };
    setBorder(l2, { top: true });

    // Value 2 (G-I)
    sheet.mergeCells(`G${r}:I${r}`);
    const v2 = sheet.getCell(`G${r}`);
    v2.value = value2;
    v2.font = { size: 10, color: { argb: DARK } };
    v2.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    setBorder(v2, { top: true, right: true });

    sheet.getRow(r).height = 18;
    r++;
  }

  // Total registered trainees (full-width highlighted row)
  sheet.mergeCells(`A${r}:B${r}`);
  const totLbl = sheet.getCell(`A${r}`);
  totLbl.value = "Total Registered Trainees";
  totLbl.font = { bold: true, size: 9, color: { argb: BURGUNDY } };
  totLbl.alignment = { horizontal: "right", vertical: "middle" };
  totLbl.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_BG } };
  setBorder(totLbl, { top: true, left: true, bottom: true });

  sheet.mergeCells(`C${r}:E${r}`);
  const totVal = sheet.getCell(`C${r}`);
  totVal.value = session.attendance.length;
  totVal.font = { bold: true, size: 13, color: { argb: BURGUNDY } };
  totVal.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  setBorder(totVal, { top: true, bottom: true });

  sheet.mergeCells(`F${r}:I${r}`);
  const spacer = sheet.getCell(`F${r}`);
  setBorder(spacer, { top: true, right: true, bottom: true });

  sheet.getRow(r).height = 22;
  r++;

  // Spacer
  sheet.getRow(r).height = 6;
  r++;

  // ════════════════════════════════════════════════════════════════════
  // SECTION 3: TRAINEE TABLE (frozen header + data rows)
  // ════════════════════════════════════════════════════════════════════

  const headerRowNum = r;
  const headers = ["No.", "Full Name", "National ID / Iqama", "Company", "Job Title", "Mobile", "Morning Signature", "Check-Out Signature", "Remarks"];

  const headerRow = sheet.getRow(headerRowNum);
  headers.forEach((h, i) => {
    const cell = headerRow.getCell(i + 1);
    cell.value = h;
    cell.font = { bold: true, size: 9, color: { argb: WHITE } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BURGUNDY } };
    setBorder(cell, { top: true, bottom: true, left: true, right: true }, "medium", GOLD);
  });
  headerRow.height = 32;

  // Freeze: everything above header row stays when scrolling
  sheet.views = [{ showGridLines: false, state: "frozen", ySplit: headerRowNum }];
  r++;

  // Data rows
  session.attendance.forEach((att, idx) => {
    const row = sheet.getRow(r);
    const bg = idx % 2 === 0 ? WHITE : GRAY_BG;
    const values = [
      idx + 1,
      att.traineeName || "—",
      att.traineeIdNational || "—",
      att.company || "—",
      "—", // Job Title (not stored on Attendance)
      att.traineePhone || "—",
      "", // Morning Signature
      "", // Check-Out Signature
      "", // Remarks
    ];

    values.forEach((val, i) => {
      const cell = row.getCell(i + 1);
      cell.value = val;
      cell.font = { size: 10, color: { argb: DARK } };
      cell.alignment = {
        horizontal: i === 0 ? "center" : i <= 2 ? "left" : "center",
        vertical: "middle",
        indent: i >= 1 && i <= 2 ? 1 : 0,
      };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      setBorder(cell, { top: true, bottom: true, left: true, right: true }, "thin", HAIR);
    });
    row.height = 30; // tall for handwritten signatures
    r++;
  });

  // Empty state
  if (session.attendance.length === 0) {
    sheet.mergeCells(`A${r}:I${r}`);
    const empty = sheet.getCell(`A${r}`);
    empty.value = "No trainees registered for this session.";
    empty.font = { italic: true, size: 10, color: { argb: "FF999999" } };
    empty.alignment = { horizontal: "center", vertical: "middle" };
    setBorder(empty, { top: true, bottom: true, left: true, right: true });
    sheet.getRow(r).height = 30;
    r++;
  }

  // Spacer
  sheet.getRow(r).height = 8;
  r++;

  // ════════════════════════════════════════════════════════════════════
  // SECTION 4: FOOTER — Signatures + Attendance Summary
  // ════════════════════════════════════════════════════════════════════

  const present = session.attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length;
  const absent = session.attendance.filter((a) => a.status === "ABSENT").length;
  const notIn = session.attendance.filter((a) => a.status === "NOT_STARTED").length;

  // Row: Signature labels + Summary header
  sheet.mergeCells(`A${r}:C${r}`);
  const tSig = sheet.getCell(`A${r}`);
  tSig.value = "Trainer Signature:";
  tSig.font = { bold: true, size: 9, color: { argb: BURGUNDY } };
  tSig.alignment = { horizontal: "left", vertical: "bottom" };
  setBorder(tSig, { top: true });

  sheet.mergeCells(`D${r}:F${r}`);
  const cSig = sheet.getCell(`D${r}`);
  cSig.value = "Company Representative Signature:";
  cSig.font = { bold: true, size: 9, color: { argb: BURGUNDY } };
  cSig.alignment = { horizontal: "left", vertical: "bottom" };
  setBorder(cSig, { top: true });

  sheet.mergeCells(`G${r}:I${r}`);
  const sHdr = sheet.getCell(`G${r}`);
  sHdr.value = "Attendance Summary";
  sHdr.font = { bold: true, size: 9, color: { argb: WHITE } };
  sHdr.alignment = { horizontal: "center", vertical: "middle" };
  sHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BURGUNDY } };
  setBorder(sHdr, { top: true, right: true });

  sheet.getRow(r).height = 20;
  r++;

  // Row: Name lines + Summary data
  sheet.mergeCells(`A${r}:C${r}`);
  const tName = sheet.getCell(`A${r}`);
  tName.value = `Name: ${session.trainer?.nameEn ?? "________________________"}`;
  tName.font = { size: 9, color: { argb: "FF666666" } };
  tName.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  setBorder(tName, { bottom: true });

  sheet.mergeCells(`D${r}:F${r}`);
  const cName = sheet.getCell(`D${r}`);
  cName.value = "Name: ____________________________";
  cName.font = { size: 9, color: { argb: "FF666666" } };
  cName.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  setBorder(cName, { bottom: true });

  sheet.mergeCells(`G${r}:I${r}`);
  const sData = sheet.getCell(`G${r}`);
  sData.value = `Total: ${session.attendance.length}  |  Present: ${present}  |  Absent: ${absent}  |  Not Checked-In: ${notIn}`;
  sData.font = { size: 9, color: { argb: DARK } };
  sData.alignment = { horizontal: "center", vertical: "middle" };
  setBorder(sData, { right: true });

  sheet.getRow(r).height = 22;
  r++;

  // Row: Date lines
  sheet.mergeCells(`A${r}:C${r}`);
  const tDate = sheet.getCell(`A${r}`);
  tDate.value = "Date: ____________________________";
  tDate.font = { size: 9, color: { argb: "FF666666" } };
  tDate.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  setBorder(tDate, { bottom: true });

  sheet.mergeCells(`D${r}:F${r}`);
  const cDate = sheet.getCell(`D${r}`);
  cDate.value = "Date: ____________________________";
  cDate.font = { size: 9, color: { argb: "FF666666" } };
  cDate.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  setBorder(cDate, { bottom: true });

  sheet.mergeCells(`G${r}:I${r}`);
  const sNote = sheet.getCell(`G${r}`);
  sNote.value = "Note: 10% absence cancels the course for the trainee.";
  sNote.font = { italic: true, size: 8, color: { argb: "FF999999" } };
  sNote.alignment = { horizontal: "center", vertical: "middle" };
  setBorder(sNote, { right: true, bottom: true });

  sheet.getRow(r).height = 22;
  r++;

  // Footer note
  r++;
  sheet.mergeCells(`A${r}:I${r}`);
  const footer = sheet.getCell(`A${r}`);
  footer.value = "This attendance sheet has been digitally generated by GCCLAB Training Management System.  |  المختبر الخليجي للمعايرة";
  footer.font = { italic: true, size: 8, color: { argb: "FF999999" } };
  footer.alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(r).height = 16;

  // ── Print settings ──────────────────────────────────────────────────
  sheet.pageSetup.printArea = `A1:I${r}`;
  sheet.pageSetup.horizontalCentered = true;

  // ── Generate buffer ─────────────────────────────────────────────────
  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `attendance-sheet_${session.refNumber}_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
