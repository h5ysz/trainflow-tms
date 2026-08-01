// /api/trainer-certifications/import — bulk-load a trainer×course certification
// matrix (.xlsx). Unmatched course codes/titles and trainer names are auto-created,
// matching the behavior of /api/sessions/import.
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { nextRefNumber } from "@/lib/api/ref-number";
import { generateCourseCode } from "@/lib/api/course-code";
import { FIXED_HEADERS, parseMatrixRow } from "@/lib/certifications/import-export";

export const POST = withModuleAction("trainer-qualifications", "create", async ({ req, user }) => {
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

  const headerRow = worksheet.getRow(1);
  const headerValues = headerRow.values as unknown[];
  // headerValues[0] is unused (ExcelJS 1-indexed), [1..4] are the fixed columns.
  const trainerNames: string[] = [];
  for (let col = FIXED_HEADERS.length + 1; col <= worksheet.columnCount; col++) {
    const v = headerValues[col];
    const name = v === null || v === undefined ? "" : String(v).trim();
    if (name) trainerNames.push(name);
  }
  if (trainerNames.length === 0) {
    return fail("No trainer columns found — expected trainer names starting at column 5", 422, "VALIDATION_ERROR");
  }

  const rows = worksheet.rowCount > 1 ? (worksheet.getRows(2, worksheet.rowCount - 1) ?? []) : [];

  const result = {
    coursesProcessed: 0,
    certificationsCreated: 0,
    certificationsSkipped: 0,
    errors: [] as { row: number; message: string }[],
  };

  for (const row of rows) {
    if (row.actualCellCount === 0) continue;
    // Stop at the totals row (its first column is a label, not a course number).
    const seqCell = row.getCell(1).value;
    if (seqCell !== null && seqCell !== undefined && Number.isNaN(Number(seqCell))) continue;

    try {
      const rawValues = [1, 2, 3, 4, ...trainerNames.map((_, i) => 5 + i)].map((col) => row.getCell(col).value);
      const parsed = parseMatrixRow(trainerNames, rawValues);
      if (!parsed || !parsed.title) continue;

      let course = parsed.code
        ? await db.course.findFirst({ where: { code: parsed.code, deletedAt: null } })
        : null;
      if (!course) course = await db.course.findFirst({ where: { title: parsed.title, deletedAt: null } });
      if (!course) {
        const code = parsed.code || (await generateCourseCode(parsed.title));
        const refNumber = await nextRefNumber("COURSE");
        course = await db.course.create({
          data: {
            refNumber,
            code,
            title: parsed.title,
            durationHours: parsed.durationDays ?? 8,
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
      result.coursesProcessed++;

      for (const trainerName of parsed.certifiedTrainerNames) {
        let trainer = await db.trainer.findFirst({ where: { fullName: trainerName, deletedAt: null } });
        if (!trainer) {
          const refNumber = await nextRefNumber("TRAINER");
          trainer = await db.trainer.create({
            data: { refNumber, fullName: trainerName, createdBy: user.id, updatedBy: user.id },
          });
        }

        const existing = await db.trainerCertification.findFirst({
          where: { trainerId: trainer.id, courseId: course.id, deletedAt: null },
        });
        if (existing) {
          result.certificationsSkipped++;
          continue;
        }

        await db.trainerCertification.create({
          data: {
            trainerId: trainer.id,
            courseId: course.id,
            validFrom: new Date(),
            status: "VALID",
            createdBy: user.id,
            updatedBy: user.id,
          },
        });
        result.certificationsCreated++;
      }
    } catch (e) {
      result.errors.push({ row: row.number, message: (e as Error).message });
    }
  }

  await audit({
    user,
    action: "CREATE",
    entity: "TRAINER",
    description: `Imported certification matrix: ${result.coursesProcessed} course(s), ${result.certificationsCreated} certification(s) created (${result.certificationsSkipped} already existed)`,
    descriptionAr: `تم استيراد مصفوفة الاعتمادات: ${result.coursesProcessed} دورة، تم إنشاء ${result.certificationsCreated} اعتماد`,
    req,
    metadata: result,
  });

  return ok(result);
});
