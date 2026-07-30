// /api/requests/import — bulk-create training requests from an uploaded
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

export const POST = withModuleAction("requests", "create", async ({ req, user }) => {
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

  const result = {
    requestsCreated: 0,
    traineesLinked: 0,
    errors: [] as { row: number; message: string }[],
  };

  const validRows: RowWithMeta[] = [];
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
      continue;
    }
    validRows.push({ ...parsed, rowNumber: row.number });
  }

  // Group by company name (trim + case-insensitive)
  const companyGroups = new Map<string, RowWithMeta[]>();
  for (const row of validRows) {
    const key = row.companyName.trim().toLowerCase();
    if (!companyGroups.has(key)) companyGroups.set(key, []);
    companyGroups.get(key)!.push(row);
  }

  for (const [, groupRows] of companyGroups) {
    try {
      await db.$transaction(async (tx) => {
        const first = groupRows[0];

        let company = await tx.company.findFirst({
          where: { name: { equals: first.companyName }, deletedAt: null },
        });
        if (!company) {
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

        const requestRefNumber = await nextRefNumber("TRAINING_REQUEST", tx);
        const request = await tx.trainingRequest.create({
          data: {
            refNumber: requestRefNumber,
            companyId: company.id,
            requestedBy: user.id,
            preferredLocation: first.region,
            status: "DRAFT",
            traineeCount: groupRows.length, // auto-populated from imported rows
            createdBy: user.id,
            updatedBy: user.id,
          },
        });

        const courseGroups = new Map<string, RowWithMeta[]>();
        for (const row of groupRows) {
          const key = row.courseTitle.trim().toLowerCase();
          if (!courseGroups.has(key)) courseGroups.set(key, []);
          courseGroups.get(key)!.push(row);
        }

        let requestTraineeTotal = 0;

        for (const [, courseRows] of courseGroups) {
          const courseFirst = courseRows[0];
          let course = await tx.course.findFirst({ where: { title: courseFirst.courseTitle, deletedAt: null } });
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

          const requestCourse = await tx.trainingRequestCourse.create({
            data: {
              requestId: request.id,
              courseId: course.id,
              traineeCount: 0,
              createdBy: user.id,
              updatedBy: user.id,
            },
          });

          let linkedCount = 0;
          for (const row of courseRows) {
            let trainee = await tx.trainee.findFirst({ where: { nationalId: row.nationalId, deletedAt: null } });
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
