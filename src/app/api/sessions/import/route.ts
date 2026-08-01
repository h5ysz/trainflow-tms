// /api/sessions/import — bulk create sessions from an uploaded .xlsx
// course-schedule sheet (same column layout as /api/sessions/export).
// Unmatched course/trainer names are auto-created rather than rejecting the row.
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { nextRefNumber } from "@/lib/api/ref-number";
import { generateCourseCode } from "@/lib/api/course-code";
import { SESSION_COLUMNS, parseImportRow } from "@/lib/sessions/import-export";
import { genQrToken } from "../route";

export const POST = withModuleAction("sessions", "create", async ({ req, user }) => {
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

  const buffer = Buffer.from(await file.arrayBuffer());
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    return fail("Could not read the uploaded file — expected a .xlsx spreadsheet", 422, "VALIDATION_ERROR");
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return fail("The uploaded workbook has no sheets", 422, "VALIDATION_ERROR");

  const rows = worksheet.rowCount > 1 ? (worksheet.getRows(2, worksheet.rowCount - 1) ?? []) : [];

  const result = { imported: 0, failed: 0, errors: [] as { row: number; message: string }[] };

  for (const row of rows) {
    if (row.actualCellCount === 0) continue;
    try {
      const rawValues = SESSION_COLUMNS.map((_, idx) => row.getCell(idx + 1).value);
      const parsed = parseImportRow(rawValues);

      if (!parsed.courseTitle) throw new Error("Missing training program name");
      if (!parsed.startDate || !parsed.endDate) throw new Error("Missing or invalid start/end date");

      let course = await db.course.findFirst({ where: { title: parsed.courseTitle, deletedAt: null } });
      if (!course) {
        const code = await generateCourseCode(parsed.courseTitle);
        const refNumber = await nextRefNumber("COURSE");
        course = await db.course.create({
          data: {
            refNumber,
            code,
            title: parsed.courseTitle,
            durationHours: parsed.durationDays ? parsed.durationDays * 8 : 8,
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

      let trainerId: string | null = null;
      if (parsed.trainerName) {
        let trainer = await db.trainer.findFirst({ where: { fullName: parsed.trainerName, deletedAt: null } });
        if (!trainer) {
          const refNumber = await nextRefNumber("TRAINER");
          trainer = await db.trainer.create({
            data: { refNumber, fullName: parsed.trainerName, createdBy: user.id, updatedBy: user.id },
          });
        }
        trainerId = trainer.id;
      }

      const refNumber = await nextRefNumber("SESSION");
      await db.trainingSession.create({
        data: {
          refNumber,
          courseId: course.id,
          trainerId,
          title: course.title,
          location: parsed.venue,
          city: parsed.city,
          region: parsed.region,
          venue: parsed.venue,
          shift: parsed.shift,
          durationHours: parsed.durationDays ? parsed.durationDays * 8 : course.durationHours,
          capacity: course.maxTrainees,
          language: course.language,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          expectedTrainees: parsed.expectedTrainees,
          actualTrainees: 0,
          status: "SCHEDULED",
          notes: parsed.notes,
          instituteName: parsed.instituteName,
          classification: parsed.classification,
          locationMapUrl: parsed.locationMapUrl,
          durationDays: parsed.durationDays,
          qrCodeToken: genQrToken(),
          qrCodeGeneratedAt: new Date(),
          createdBy: user.id,
          updatedBy: user.id,
        },
      });

      result.imported++;
    } catch (e) {
      result.failed++;
      result.errors.push({ row: row.number, message: (e as Error).message });
    }
  }

  await audit({
    user,
    action: "CREATE",
    entity: "SESSION",
    description: `Imported ${result.imported} session(s) from spreadsheet (${result.failed} failed)`,
    descriptionAr: `تم استيراد ${result.imported} جلسة من ملف إكسل (فشل ${result.failed})`,
    req,
    metadata: result,
  });

  return ok(result);
});
