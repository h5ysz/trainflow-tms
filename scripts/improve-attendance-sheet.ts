/**
 * Improve the formatting of the uploaded Attendance Sheet Excel file.
 * Preserves ALL data, formulas, columns, merged cells, and sheet structure.
 * Only applies professional GCCLAB formatting improvements.
 */
import ExcelJS from "exceljs";
import path from "path";
import { readFile, writeFile } from "fs/promises";

const BURGUNDY = "FF7B1E2B";
const LIGHT_BURG = "FFF5E6E8";
const GOLD = "FFC9A961";
const WHITE = "FFFFFFFF";
const DARK = "FF333333";
const GRAY_BG = "FFF8F8F8";
const BORDER_CLR = "FFCCCCCC";
const HAIR_CLR = "FFDDDDDD";

async function main() {
  const srcPath = path.join(process.cwd(), "upload", "Attendance. 21-07-2026.xlsx");
  const outPath = path.join(process.cwd(), "download", "Attendance-GCCLAB-Improved.xlsx");

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(srcPath);

  const ws = wb.worksheets[0];

  // ── 1. PAGE SETUP: A4 Landscape, fit-to-width ──────────────────────
  ws.pageSetup = {
    paperSize: 9, // A4
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
    horizontalCentered: true,
  };
  ws.properties.defaultRowHeight = 18;

  // ── 2. ROW 1: Notice banner (improve styling) ──────────────────────
  const row1 = ws.getRow(1);
  row1.height = 28;
  for (let c = 1; c <= 32; c++) {
    const cell = row1.getCell(c);
    cell.font = { bold: true, size: 9, color: { argb: "FFCC0000" } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF0F0" } };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCC0000" } },
      bottom: { style: "thin", color: { argb: "FFCC0000" } },
      left: { style: "thin", color: { argb: "FFCC0000" } },
      right: { style: "thin", color: { argb: "FFCC0000" } },
    };
  }

  // ── 3. ROW 2: Course name + location (improve styling) ─────────────
  const row2 = ws.getRow(2);
  row2.height = 26;
  // A2:D2 = "اسم الدورة" label
  for (let c = 1; c <= 4; c++) {
    const cell = row2.getCell(c);
    cell.font = { bold: true, size: 10, color: { argb: BURGUNDY } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BURG } };
    cell.border = { top: { style: "thin", color: { argb: BORDER_CLR } }, bottom: { style: "thin", color: { argb: BORDER_CLR } }, left: { style: "thin", color: { argb: BORDER_CLR } } };
  }
  // E2:T2 = course value
  for (let c = 5; c <= 20; c++) {
    const cell = row2.getCell(c);
    cell.font = { bold: true, size: 11, color: { argb: DARK } };
    cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    cell.border = { top: { style: "thin", color: { argb: BORDER_CLR } }, bottom: { style: "thin", color: { argb: BORDER_CLR } } };
  }
  // U2:Y2 = "موقع انعقاد الدورة" label
  for (let c = 21; c <= 25; c++) {
    const cell = row2.getCell(c);
    cell.font = { bold: true, size: 10, color: { argb: BURGUNDY } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: LIGHT_BURG } };
    cell.border = { top: { style: "thin", color: { argb: BORDER_CLR } }, bottom: { style: "thin", color: { argb: BORDER_CLR } } };
  }
  // Z2:AF2 = location value
  for (let c = 26; c <= 32; c++) {
    const cell = row2.getCell(c);
    cell.font = { bold: true, size: 10, color: { argb: DARK } };
    cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    cell.border = { top: { style: "thin", color: { argb: BORDER_CLR } }, bottom: { style: "thin", color: { argb: BORDER_CLR } }, right: { style: "thin", color: { argb: BORDER_CLR } } };
  }

  // ── 4. ROW 3: Institution + dates (improve styling) ────────────────
  const row3 = ws.getRow(3);
  row3.height = 22;
  // A3:D3 = "الجهة المنفذة" label
  for (let c = 1; c <= 4; c++) {
    const cell = row3.getCell(c);
    cell.font = { bold: true, size: 9, color: { argb: BURGUNDY } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_BG } };
    cell.border = { bottom: { style: "thin", color: { argb: BORDER_CLR } }, left: { style: "thin", color: { argb: BORDER_CLR } } };
  }
  // E3:I3 = "GCC Lab" value
  for (let c = 5; c <= 9; c++) {
    const cell = row3.getCell(c);
    cell.font = { size: 10, color: { argb: DARK } };
    cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    cell.border = { bottom: { style: "thin", color: { argb: BORDER_CLR } } };
  }
  // J3:M3 = "تاريخ الدورة" label
  for (let c = 10; c <= 13; c++) {
    const cell = row3.getCell(c);
    cell.font = { bold: true, size: 9, color: { argb: BURGUNDY } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_BG } };
    cell.border = { bottom: { style: "thin", color: { argb: BORDER_CLR } } };
  }
  // N3:O3 = "من" label
  for (let c = 14; c <= 15; c++) {
    const cell = row3.getCell(c);
    cell.font = { bold: true, size: 9, color: { argb: BURGUNDY } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_BG } };
    cell.border = { bottom: { style: "thin", color: { argb: BORDER_CLR } } };
  }
  // P3:S3 = date value
  for (let c = 16; c <= 19; c++) {
    const cell = row3.getCell(c);
    cell.font = { size: 10, color: { argb: DARK } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: BORDER_CLR } } };
    if (cell.value && typeof cell.value === "object" && "result" in (cell.value as object)) {
      // It's a date — format it
      cell.numFmt = "DD/MM/YYYY";
    }
  }
  // T3:Y3 = "إلى" label
  for (let c = 20; c <= 25; c++) {
    const cell = row3.getCell(c);
    cell.font = { bold: true, size: 9, color: { argb: BURGUNDY } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_BG } };
    cell.border = { bottom: { style: "thin", color: { argb: BORDER_CLR } } };
  }
  // Z3:AC3 = date value
  for (let c = 26; c <= 29; c++) {
    const cell = row3.getCell(c);
    cell.font = { size: 10, color: { argb: DARK } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.border = { bottom: { style: "thin", color: { argb: BORDER_CLR } } };
    if (cell.value && typeof cell.value === "object" && "result" in (cell.value as object)) {
      cell.numFmt = "DD/MM/YYYY";
    }
  }
  // AD3:AE3 = "الكود" label
  for (let c = 30; c <= 31; c++) {
    const cell = row3.getCell(c);
    cell.font = { bold: true, size: 9, color: { argb: BURGUNDY } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_BG } };
    cell.border = { bottom: { style: "thin", color: { argb: BORDER_CLR } }, right: { style: "thin", color: { argb: BORDER_CLR } } };
  }
  // AF3 = formula (keep as-is, just style)
  const af3 = row3.getCell(32);
  af3.font = { size: 9, color: { argb: DARK } };
  af3.alignment = { horizontal: "center", vertical: "middle" };
  af3.border = { bottom: { style: "thin", color: { argb: BORDER_CLR } }, right: { style: "thin", color: { argb: BORDER_CLR } } };

  // ── 5. ROW 4: Classification + trainer + ID + duration ─────────────
  const row4 = ws.getRow(4);
  row4.height = 24;
  for (let c = 1; c <= 32; c++) {
    const cell = row4.getCell(c);
    cell.font = { bold: true, size: 9, color: { argb: BURGUNDY } };
    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GRAY_BG } };
    cell.border = {
      bottom: { style: "thin", color: { argb: BORDER_CLR } },
      left: { style: "hair", color: { argb: BORDER_CLR } },
      right: { style: "hair", color: { argb: BORDER_CLR } },
    };
  }
  // Values in row 4 (trainer name, etc.) — make non-label cells normal weight
  for (let c = 5; c <= 32; c++) {
    const cell = row4.getCell(c);
    const v = cell.value;
    if (v && typeof v === "string" && !["حضوري","تسليم الشهادات","الكتروني","اسم المدرب","الرقم الوظيفي","Morning","المدة (يوم)"].includes(v.trim())) {
      cell.font = { size: 10, color: { argb: DARK } };
      cell.alignment = { horizontal: "center", vertical: "middle" };
    }
  }

  // ── 6. ROWS 5-8: Table header (multi-row merged headers) ───────────
  for (let r = 5; r <= 8; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 32; c++) {
      const cell = row.getCell(c);
      cell.font = { bold: true, size: 9, color: { argb: WHITE } };
      cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BURGUNDY } };
      cell.border = {
        top: { style: "thin", color: { argb: GOLD } },
        bottom: { style: "thin", color: { argb: GOLD } },
        left: { style: "hair", color: { argb: GOLD } },
        right: { style: "hair", color: { argb: GOLD } },
      };
    }
  }
  // Row 6 is taller (41.25) — keep it
  ws.getRow(6).height = 38;

  // ── 7. DATA ROWS (9-84): alternating colors, borders, better fonts ─
  for (let r = 9; r <= 84; r++) {
    const row = ws.getRow(r);
    const isEven = (r - 9) % 2 === 0;
    const bg = isEven ? WHITE : GRAY_BG;
    const hasData = row.getCell(1).value !== null && row.getCell(1).value !== undefined;

    for (let c = 1; c <= 32; c++) {
      const cell = row.getCell(c);
      // Font
      if (hasData) {
        cell.font = { size: 10, color: { argb: DARK } };
      } else {
        cell.font = { size: 10, color: { argb: "FF999999" } };
      }
      // Alignment
      if (c === 1) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else if (c === 2) {
        cell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      } else if (c === 3) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else if (c >= 6 && c <= 26) {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      } else {
        cell.alignment = { horizontal: "center", vertical: "middle" };
      }
      // Background
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      // Borders
      cell.border = {
        top: { style: "hair", color: { argb: HAIR_CLR } },
        bottom: { style: "hair", color: { argb: HAIR_CLR } },
        left: { style: "hair", color: { argb: HAIR_CLR } },
        right: { style: "hair", color: { argb: HAIR_CLR } },
      };
    }

    // Row height — taller for data rows with content
    if (hasData) {
      row.height = 22;
    } else {
      row.height = 18;
    }
  }

  // ── 8. COLUMN WIDTHS — improve for readability ─────────────────────
  ws.getColumn(1).width = 5;       // No.
  ws.getColumn(2).width = 38;      // Name
  ws.getColumn(3).width = 20;      // National ID
  ws.getColumn(4).width = 28;      // Job Title
  ws.getColumn(5).width = 35;      // Company
  // Columns 6-26: attendance marks (narrow)
  for (let c = 6; c <= 26; c++) {
    ws.getColumn(c).width = 5.5;
  }
  ws.getColumn(27).width = 14;     // Notes
  ws.getColumn(28).width = 14;     // Nationality
  ws.getColumn(29).width = 14;     // Nationality (merged)
  ws.getColumn(30).width = 12;     // Pass/Fail
  ws.getColumn(31).width = 12;     // Pass/Fail (merged)
  ws.getColumn(32).width = 12;     // Duration

  // ── 9. FREEZE PANES — freeze rows 1-8 (header) ─────────────────────
  ws.views = [{ showGridLines: false, state: "frozen", ySplit: 8, xSplit: 0 }];

  // ── 10. PRINT AREA ──────────────────────────────────────────────────
  ws.pageSetup.printArea = `A1:AF84`;

  // ── 11. WORKBOOK PROPERTIES ────────────────────────────────────────
  wb.creator = "GCCLAB TMS";
  wb.created = new Date();

  // ── Save ────────────────────────────────────────────────────────────
  await wb.xlsx.writeFile(outPath);
  console.log("✅ Saved:", outPath);
  console.log("   Sheet:", ws.name);
  console.log("   Rows:", ws.rowCount, "Cols:", ws.columnCount);
  console.log("   Merges:", (ws.model.merges || []).length);
}

main().catch(e => { console.error(e); process.exit(1); });
