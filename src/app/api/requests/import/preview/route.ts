// /api/requests/import/preview — parse an uploaded .xlsx WITHOUT saving,
// returning a preview of what would be imported. Used by the UI to show
// trainee count, valid/invalid rows, duplicate national IDs, and missing
// required columns before the user confirms the import.
//
// V2: Header-based column matching (column order doesn't matter). Accepts
// Arabic + English aliases for each field. See src/lib/requests/import-export.ts
// COLUMN_ALIASES for the full alias list.
import ExcelJS from "exceljs";
import { ok, fail } from "@/lib/auth/api";
import { withModuleAction } from "@/lib/auth/api";
import {
  resolveColumnMapping,
  parseRegistrationRowByMapping,
  buildPreview,
  type ParsedRegistrationRow,
} from "@/lib/requests/import-export";

interface RowWithMeta {
  rowNumber: number;
  data: ParsedRegistrationRow;
}

export const POST = withModuleAction("requests", "create", async ({ req }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return fail("No file uploaded", 422, "VALIDATION_ERROR");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as any);
  } catch {
    return fail("Could not read the uploaded file — expected a .xlsx spreadsheet", 422, "VALIDATION_ERROR");
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return fail("The uploaded workbook has no sheets", 422, "VALIDATION_ERROR");

  // Read headers from row 1
  if (worksheet.rowCount < 2) {
    return fail("The file appears to be empty (no header row + data rows)", 422, "VALIDATION_ERROR");
  }

  const headerRow = worksheet.getRow(1);
  const headerCount = headerRow.cellCount;
  const headers: string[] = [];
  for (let i = 1; i <= headerCount; i++) {
    const cell = headerRow.getCell(i);
    headers.push(cellToString(cell.value) ?? "");
  }

  // Resolve column mapping by header names
  const mappingResult = resolveColumnMapping(headers);

  // If required columns are missing, return early with the missing-columns error
  // (we still parse the rows for the preview, but flag them all as invalid)
  const mapping = mappingResult.mapping;

  // Parse data rows (row 2+)
  const dataRows = worksheet.rowCount > 1
    ? (worksheet.getRows(2, worksheet.rowCount - 1) ?? [])
    : [];

  const parsedRows: RowWithMeta[] = [];
  for (const row of dataRows) {
    if (row.actualCellCount === 0) continue;
    const data = parseRegistrationRowByMapping(mapping, (idx) => row.getCell(idx + 1).value);
    parsedRows.push({ rowNumber: row.number, data });
  }

  // Build preview (detects missing fields + duplicates)
  const preview = buildPreview(parsedRows, mappingResult);

  return ok(preview);
});

function cellToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v !== null && "text" in v) return String((v as { text: unknown }).text).trim() || null;
  if (typeof v === "object" && v !== null && "result" in v) return String((v as { result: unknown }).result).trim() || null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
