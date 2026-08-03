// /api/requests/preview-import — preview Excel import without creating records
// Sprint 6: Contractor Portal — Excel preview before submission
//
// Reads the uploaded Excel, maps columns, validates, detects duplicates,
// and returns a preview without creating any database records.
import ExcelJS from "exceljs";
import { withModuleAction, ok, fail } from "@/lib/auth/api";
import { REQUEST_COLUMNS, parseRegistrationRow } from "@/lib/requests/import-export";

interface PreviewTrainee {
  rowNumber: number;
  fullName: string;
  nationalId: string;
  jobTitle: string | null;
  companyName: string;
  activity: string | null;
  region: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  courseTitle: string;
  duration: number;
  // Validation status
  isValid: boolean;
  errors: string[];
  isDuplicate: boolean;
}

export const POST = withModuleAction("requests", "create", async ({ req, user }) => {
  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return fail("No file uploaded", 422, "VALIDATION_ERROR");
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as never);
  } catch {
    return fail("Could not read the uploaded file — expected a .xlsx spreadsheet", 422, "VALIDATION_ERROR");
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return fail("The uploaded workbook has no sheets", 422, "VALIDATION_ERROR");

  const rawRows = worksheet.rowCount > 1 ? (worksheet.getRows(2, worksheet.rowCount - 1) ?? []) : [];

  const trainees: PreviewTrainee[] = [];
  const nationalIdsSeen = new Map<string, number>(); // for duplicate detection
  let duplicateCount = 0;
  let invalidCount = 0;

  for (const row of rawRows) {
    if (row.actualCellCount === 0) continue;

    const rawValues = REQUEST_COLUMNS.map((_, idx) => row.getCell(idx + 1).value);
    const parsed = parseRegistrationRow(rawValues);

    const errors: string[] = [];
    if (!parsed.name) errors.push("Missing Full Name");
    if (!parsed.nationalId) errors.push("Missing National ID / Iqama");
    if (!parsed.companyName) errors.push("Missing Company Name");
    if (!parsed.courseTitle) errors.push("Missing Course Title");

    // Check for duplicate National ID within the file
    let isDuplicate = false;
    if (parsed.nationalId) {
      if (nationalIdsSeen.has(parsed.nationalId)) {
        isDuplicate = true;
        duplicateCount++;
        errors.push(`Duplicate National ID (first seen at row ${nationalIdsSeen.get(parsed.nationalId)})`);
      } else {
        nationalIdsSeen.set(parsed.nationalId, row.number);
      }
    }

    const isValid = errors.length === 0;
    if (!isValid) invalidCount++;

    trainees.push({
      rowNumber: row.number,
      fullName: parsed.name || "",
      nationalId: parsed.nationalId || "",
      jobTitle: parsed.jobTitle ?? null,
      companyName: parsed.companyName || "",
      activity: parsed.activity ?? null,
      region: parsed.region ?? null,
      city: parsed.city ?? null,
      phone: parsed.phone ?? null,
      email: parsed.email ?? null,
      courseTitle: parsed.courseTitle || "",
      duration: parsed.duration || 1,
      isValid,
      errors,
      isDuplicate,
    });
  }

  // Group by company + course for summary
  const companyCourseGroups = new Map<string, { company: string; course: string; count: number }>();
  for (const t of trainees) {
    if (!t.isValid) continue;
    const key = `${t.companyName}__${t.courseTitle}`;
    const existing = companyCourseGroups.get(key);
    if (existing) {
      existing.count++;
    } else {
      companyCourseGroups.set(key, { company: t.companyName, course: t.courseTitle, count: 1 });
    }
  }

  return ok({
    totalRows: trainees.length,
    validRows: trainees.filter((t) => t.isValid).length,
    invalidRows: invalidCount,
    duplicateRows: duplicateCount,
    trainees,
    groups: Array.from(companyCourseGroups.values()),
    fileName: typeof file === "object" && "name" in file ? file.name : "uploaded.xlsx",
  });
});
