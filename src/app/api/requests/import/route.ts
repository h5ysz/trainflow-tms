// /api/requests/import — bulk-create training requests from an uploaded
<<<<<<< Updated upstream
// registration-sheet-style .xlsx (one row per trainee). Rows are grouped by
// company (one new TrainingRequest per company), then by course title within
// each company (one TrainingRequestCourse per course). Unmatched
// company/course/trainee records are auto-created, matching the behavior of
// /api/sessions/import.
//
// V2: Header-based column matching (column order doesn't matter). Accepts
// Arabic + English aliases for each field. See src/lib/requests/import-export.ts
// COLUMN_ALIASES for the full alias list.
//
// The UI should call /api/requests/import/preview FIRST to validate the file
// and show the user a preview. This endpoint does the actual save.
=======
// .xlsx with header-based column matching. Column order doesn't matter;
// Arabic + English aliases are supported. Extra columns are ignored.
//
// The preview endpoint (/api/requests/import/preview) should be called FIRST
// so the user can validate the file before importing.
>>>>>>> Stashed changes
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { nextRefNumber } from "@/lib/api/ref-number";
import { generateCourseCode } from "@/lib/api/course-code";
import {
  resolveColumnMapping,
  parseRegistrationRowByMapping,
  type ParsedRegistrationRow,
} from "@/lib/requests/import-export";

interface RowWithMeta extends ParsedRegistrationRow {
  rowNumber: number;
}

function cellToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v !== null) {
    if ("richText" in v && Array.isArray((v as { richText: unknown[] }).richText)) {
      const parts = (v as { richText: { text?: string }[] }).richText.map((r) => r?.text ?? "").join("");
      return parts.trim() || null;
    }
    if ("result" in v) {
      const r = (v as { result: unknown }).result;
      if (r === null || r === undefined) return null;
      if (typeof r === "number") return Number.isNaN(r) ? null : String(r);
      if (r instanceof Date) return r.toISOString().split("T")[0];
      const s = String(r).trim();
      return s === "" ? null : s;
    }
    if ("text" in v) {
      const s = String((v as { text: unknown }).text).trim();
      return s === "" ? null : s;
    }
    if ("hyperlink" in v) return null;
    const s = String(v).trim();
    return s === "" || s === "[object Object]" ? null : s;
  }
  if (typeof v === "number") return Number.isNaN(v) ? null : String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return v.toISOString().split("T")[0];
  const s = String(v).trim();
  return s === "" || s === "NaN" || s === "undefined" || s === "null" ? null : s;
}

export const POST = withModuleAction("requests", "create", async ({ req, user }) => {
  // ── Contractor scoping ───────────────────────────────────────────────
  // Contractors can only import trainees for their OWN company. They must
  // NOT be able to create new companies/courses or import into another
  // company. If a contractor calls this endpoint, we force every row's
  // company to resolve to their own companyId and skip rows that don't
  // match.
  const isContractor = user.role === "CONTRACTOR";
  const contractorCompanyId = isContractor ? user.companyId : null;
  if (isContractor && !contractorCompanyId) {
    return fail("Contractor has no company assignment", 403, "FORBIDDEN");
  }

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return fail("No file uploaded", 422, "VALIDATION_ERROR");
  }

  // File type + size validation (security: prevent arbitrary file uploads + DoS via huge files)
  const MAX_IMPORT_BYTES = 20 * 1024 * 1024; // 20 MB
  const ALLOWED_MIME = [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream", // some browsers send this for .xlsx
  ];
  const mime = file.type || "";
  const ext = file.name.toLowerCase().endsWith(".xlsx");
  if (!ext && !ALLOWED_MIME.includes(mime)) {
    return fail("Invalid file type. Only .xlsx files are accepted.", 422, "INVALID_FILE_TYPE");
  }
  if (file.size > MAX_IMPORT_BYTES) {
    return fail(`File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum is 20 MB.`, 422, "FILE_TOO_LARGE");
  }

  // ── 1. Load the workbook ──────────────────────────────────────────────
  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  try {
<<<<<<< Updated upstream
    await workbook.xlsx.load(buffer as any);
=======
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
>>>>>>> Stashed changes
  } catch {
    return fail("Could not read the uploaded file — expected a .xlsx spreadsheet", 422, "INVALID_FILE");
  }

  // ── 2. Auto-detect the worksheet ──────────────────────────────────────
  // Use the first worksheet that has at least 2 rows (header + 1 data row).
  // If there's only one sheet, use it regardless.
  let worksheet = workbook.worksheets[0];
  if (!worksheet) return fail("The uploaded workbook has no sheets", 422, "NO_SHEETS");

<<<<<<< Updated upstream
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

  // If required columns are missing, return an error listing the missing headers
  if (mappingResult.missingRequired.length > 0) {
    const missing = mappingResult.missingRequired
      .map((m) => `${m.field} (accepted: ${m.canonicalAlias})`)
      .join("; ");
    return fail(
      `Missing required column(s): ${missing}. Please check the file headers and try again.`,
      422,
      "MISSING_REQUIRED_COLUMNS",
      { missingRequired: mappingResult.missingRequired }
    );
  }

  const mapping = mappingResult.mapping;

  // Parse data rows (row 2+)
  const dataRows = worksheet.rowCount > 1
    ? (worksheet.getRows(2, worksheet.rowCount - 1) ?? [])
    : [];
=======
  if (workbook.worksheets.length > 1) {
    for (const ws of workbook.worksheets) {
      if (ws.rowCount >= 2) { worksheet = ws; break; }
    }
  }
>>>>>>> Stashed changes

  if (worksheet.rowCount < 2) {
    return fail("The worksheet appears to be empty (no data rows found)", 422, "EMPTY_SHEET");
  }

  // ── 3. Auto-detect header row by scanning for trainee table headers ────
  // Scan rows 1-20 looking for a row that contains BOTH a name-like header
  // AND a national-ID-like header. This skips company info, instructions, etc.
  const nameKeywords = ['name', 'الاسم', 'اسم المتدرب', 'employee name', 'trainee name', 'full name'];
  const idKeywords = ['id', 'national id', 'iqama', 'رقم الهوية', 'رقم الاقامة', 'رقم الإقامة', 'هوية', 'اقامة', 'إقامة', 'بطاقة الأحوال'];
  let headerRowNum = -1;
  for (let r = 1; r <= Math.min(worksheet.rowCount, 20); r++) {
    const row = worksheet.getRow(r);
    let hasName = false;
    let hasId = false;
    let nonEmpty = 0;
    for (let col = 1; col <= Math.min(row.cellCount, 30); col++) {
      const v = cellToString(row.getCell(col).value);
      if (!v) continue;
      nonEmpty++;
      // Only check short cells (headers are typically < 80 chars)
      if (v.length <= 80) {
        const lv = v.toLowerCase();
        if (!hasName) for (const kw of nameKeywords) { if (lv.includes(kw)) { hasName = true; break; } }
        if (!hasId) for (const kw of idKeywords) { if (lv.includes(kw)) { hasId = true; break; } }
      }
    }
    // Header row must have both name AND id headers, plus at least 3 non-empty cells
    if (hasName && hasId && nonEmpty >= 3) {
      headerRowNum = r;
      break;
    }
  }
  // Fallback to row 1 if no header row detected
  if (headerRowNum === -1) headerRowNum = 1;

  const headerRow = worksheet.getRow(headerRowNum);
  const headerCount = Math.max(headerRow.cellCount, worksheet.columnCount);
  const headers: string[] = [];
  for (let col = 1; col <= headerCount; col++) {
    const cell = headerRow.getCell(col);
    headers.push(cellToString(cell.value) ?? "");
  }

// ── 4. Resolve column mapping by header names ─────────────────────────
  const mappingResult = resolveColumnMapping(headers);

  if (mappingResult.missingRequired.length > 0) {
    const missing = mappingResult.missingRequired
      .map((m) => `${m.field} (accepted: ${m.canonicalAlias})`)
      .join("; ");
    return fail(
      `Missing required column(s): ${missing}. Please check the file headers and try again.`,
      422,
      "MISSING_REQUIRED_COLUMNS",
      { missingRequired: mappingResult.missingRequired }
    );
  }

  // ── 5. Parse all data rows (row 2+) ───────────────────────────────────
  const result = {
    requestsCreated: 0,
    traineesLinked: 0,
    errors: [] as { row: number; message: string }[],
  };

  const validRows: RowWithMeta[] = [];
<<<<<<< Updated upstream
  for (const row of dataRows) {
    if (row.actualCellCount === 0) continue;
    const parsed = parseRegistrationRowByMapping(mapping, (idx) => row.getCell(idx + 1).value);
    if (!parsed.name || !parsed.nationalId || !parsed.companyName || !parsed.courseTitle) {
      if (parsed.name || parsed.nationalId || parsed.companyName || parsed.courseTitle) {
        const missing: string[] = [];
        if (!parsed.name) missing.push("name");
        if (!parsed.nationalId) missing.push("national ID");
        if (!parsed.companyName) missing.push("company name");
        if (!parsed.courseTitle) missing.push("course title");
        result.errors.push({ row: row.number, message: `Missing required field(s): ${missing.join(", ")}` });
      }
=======
  const dataRows = worksheet.getRows(headerRowNum + 1, worksheet.rowCount - 1) ?? [];

  for (const row of dataRows) {
    // Skip completely empty rows
    if (row.actualCellCount === 0) continue;

    const parsed = parseRegistrationRowByMapping(mappingResult, (idx) => row.getCell(idx + 1).value);

    // Validate required fields
    if (!parsed.name || !parsed.nationalId || !parsed.companyName || !parsed.courseTitle) {
      const missing: string[] = [];
      if (!parsed.name) missing.push("name");
      if (!parsed.nationalId) missing.push("national ID");
      if (!parsed.companyName) missing.push("company name");
      if (!parsed.courseTitle) missing.push("course title");
      result.errors.push({ row: row.number, message: `Missing: ${missing.join(", ")}` });
>>>>>>> Stashed changes
      continue;
    }

    validRows.push({ ...parsed, rowNumber: row.number });
  }

  if (validRows.length === 0) {
    return fail(
      "No valid data rows found. " + result.errors.length + " row(s) had missing required fields.",
      422,
      "NO_VALID_ROWS",
      { errors: result.errors }
    );
  }

  // ── 6. Group by company → course → trainees ───────────────────────────
  const companyGroups = new Map<string, RowWithMeta[]>();
  for (const row of validRows) {
    const key = row.companyName.trim().toLowerCase();
    if (!companyGroups.has(key)) companyGroups.set(key, []);
    companyGroups.get(key)!.push(row);
  }

  for (const [, groupRows] of companyGroups) {
    try {
      // ── Contractor scoping: skip groups that don't match the contractor's company ──
      if (isContractor) {
        // Look up the contractor's company to compare names case-insensitively
        const myCompany = await db.company.findFirst({
          where: { id: contractorCompanyId!, deletedAt: null },
          select: { name: true },
        });
        if (!myCompany || myCompany.name.trim().toLowerCase() !== groupRows[0].companyName.trim().toLowerCase()) {
          // Skip this group — contractor can only import for their own company
          for (const row of groupRows) {
            result.errors.push({ row: row.rowNumber, message: "Contractors can only import trainees for their own company" });
          }
          continue;
        }
      }

      await db.$transaction(async (tx) => {
        const first = groupRows[0];

        // Find or create company (case-insensitive name match)
        // SQLite doesn't support mode:"insensitive", so we fetch candidates
        // with `contains` then verify exact case-insensitive equality in JS.
        const companyNameLower = first.companyName.trim().toLowerCase();
        let company = await tx.company.findFirst({
          where: { name: { contains: companyNameLower }, deletedAt: null },
        });
        // Verify the match is exact (case-insensitive) — contains may return partial matches
        if (company && company.name.trim().toLowerCase() !== companyNameLower) {
          company = null;
        }
        // For contractors, force the company to be their own
        if (isContractor && contractorCompanyId) {
          company = await tx.company.findFirst({ where: { id: contractorCompanyId, deletedAt: null } });
          if (!company) {
            throw new Error("Contractor company not found");
          }
        } else if (!company) {
          const refNumber = await nextRefNumber("COMPANY", tx);
          company = await tx.company.create({
            data: {
              refNumber,
              name: first.companyName,
              industry: first.activity,
              city: first.city,
              phone: first.phone,
              email: first.email,
              createdBy: user.id,
              updatedBy: user.id,
            },
          });
        }

        // Create training request
        const requestRefNumber = await nextRefNumber("TRAINING_REQUEST", tx);
        const request = await tx.trainingRequest.create({
          data: {
            refNumber: requestRefNumber,
            companyId: company.id,
            requestedBy: user.id,
            preferredLocation: first.region,
            status: "DRAFT",
<<<<<<< Updated upstream
            traineeCount: groupRows.length, // auto-populated from imported rows
=======
            traineeCount: groupRows.length,
>>>>>>> Stashed changes
            createdBy: user.id,
            updatedBy: user.id,
          },
        });

        // Group by course within this company
        const courseGroups = new Map<string, RowWithMeta[]>();
        for (const row of groupRows) {
          const key = row.courseTitle.trim().toLowerCase();
          if (!courseGroups.has(key)) courseGroups.set(key, []);
          courseGroups.get(key)!.push(row);
        }

        let requestTraineeTotal = 0;

        for (const [, courseRows] of courseGroups) {
          const courseFirst = courseRows[0];

          // Find or create course (case-insensitive title match)
          const courseTitleLower = courseFirst.courseTitle.trim().toLowerCase();
          let course = await tx.course.findFirst({ where: { title: { contains: courseTitleLower }, deletedAt: null } });
          if (course && course.title.trim().toLowerCase() !== courseTitleLower) {
            course = null;
          }
          // Contractors cannot create courses — only link to existing ones
          if (!course && isContractor) {
            throw new Error(`Course "${courseFirst.courseTitle}" not found. Contractors can only import trainees for existing courses.`);
          }
          if (!course) {
            const code = await generateCourseCode(courseFirst.courseTitle, tx);
            const courseRefNumber = await nextRefNumber("COURSE", tx);
            course = await tx.course.create({
              data: {
                refNumber: courseRefNumber,
                code,
                title: courseFirst.courseTitle,
                durationHours: courseFirst.duration ?? 8,
                language: "ar",
                validityMonths: 12,
                passScore: 70,
                maxTrainees: 20,
                hasPreTest: true,
                hasFinalTest: true,
                hasEvaluation: true,
                status: "ACTIVE",
                createdBy: user.id,
                updatedBy: user.id,
              },
            });
          }

          // Create request-course link
          const requestCourse = await tx.trainingRequestCourse.create({
            data: {
              requestId: request.id,
              courseId: course.id,
              traineeCount: 0,
              createdBy: user.id,
              updatedBy: user.id,
            },
          });

          // Create/find trainees and link them (scoped to the company to prevent cross-company leaks)
          let linkedCount = 0;
          for (const row of courseRows) {
            let trainee = await tx.trainee.findFirst({ where: { nationalId: row.nationalId, companyId: company.id, deletedAt: null } });
            if (!trainee) {
              const traineeRefNumber = await nextRefNumber("TRAINEE", tx);
              trainee = await tx.trainee.create({
                data: {
                  refNumber: traineeRefNumber,
                  fullName: row.name,
                  nationalId: row.nationalId,
                  nationality: row.nationality,
                  jobTitle: row.jobTitle,
                  mobile: row.phone,
                  email: row.email,
                  companyId: company.id,
                  createdBy: user.id,
                  updatedBy: user.id,
                },
              });
            }

            const existingLink = await tx.trainingRequestCourseTrainee.findFirst({
              where: { requestCourseId: requestCourse.id, traineeId: trainee.id, deletedAt: null },
            });
            if (existingLink) continue;

            await tx.trainingRequestCourseTrainee.create({
              data: {
                requestCourseId: requestCourse.id,
                traineeId: trainee.id,
                createdBy: user.id,
                updatedBy: user.id,
              },
            });
            linkedCount++;
          }

          await tx.trainingRequestCourse.update({
            where: { id: requestCourse.id },
            data: { traineeCount: linkedCount },
          });
          requestTraineeTotal += linkedCount;
        }

        await tx.trainingRequest.update({
          where: { id: request.id },
          data: { traineeCount: requestTraineeTotal },
        });

        result.requestsCreated++;
        result.traineesLinked += requestTraineeTotal;
      }, { timeout: 30000 });
    } catch (e) {
      result.errors.push({ row: groupRows[0].rowNumber, message: (e as Error).message });
    }
  }

  await audit({
    user,
    action: "CREATE",
    entity: "REQUEST",
    description: `Imported registrations: ${result.requestsCreated} request(s) created, ${result.traineesLinked} trainee(s) linked`,
    descriptionAr: `تم استيراد التسجيلات: تم إنشاء ${result.requestsCreated} طلب، وربط ${result.traineesLinked} متدرب`,
    req,
    metadata: result,
  });

  return ok(result);
});

function cellToString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "object" && v !== null && "text" in v) return String((v as { text: unknown }).text).trim() || null;
  if (typeof v === "object" && v !== null && "result" in v) return String((v as { result: unknown }).result).trim() || null;
  const s = String(v).trim();
  return s === "" ? null : s;
}
