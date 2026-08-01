// /api/requests/import — bulk-create training requests from an uploaded
// registration-sheet-style .xlsx (one row per trainee). Rows are grouped by
// company (one new TrainingRequest per company), then by course title within
// each company (one TrainingRequestCourse per course). Unmatched
// company/course/trainee records are auto-created, matching the behavior of
// /api/sessions/import.
import ExcelJS from "exceljs";
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { nextRefNumber } from "@/lib/api/ref-number";
import { generateCourseCode } from "@/lib/api/course-code";
import { REQUEST_COLUMNS, parseRegistrationRow, type ParsedRegistrationRow } from "@/lib/requests/import-export";

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

  const rawRows = worksheet.rowCount > 1 ? (worksheet.getRows(2, worksheet.rowCount - 1) ?? []) : [];

  const result = {
    requestsCreated: 0,
    traineesLinked: 0,
    errors: [] as { row: number; message: string }[],
  };

  const validRows: RowWithMeta[] = [];
  for (const row of rawRows) {
    if (row.actualCellCount === 0) continue;
    const rawValues = REQUEST_COLUMNS.map((_, idx) => row.getCell(idx + 1).value);
    const parsed = parseRegistrationRow(rawValues);
    if (!parsed.name || !parsed.nationalId || !parsed.companyName || !parsed.courseTitle) {
      if (parsed.name || parsed.nationalId || parsed.companyName || parsed.courseTitle) {
        result.errors.push({ row: row.number, message: "Missing name, national ID, company, or course title" });
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
