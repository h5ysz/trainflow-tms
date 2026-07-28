// /api/requests/export — flatten every training-request-course-trainee into a
// registration-sheet-style row and download as .xlsx.
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction } from "@/lib/auth/api";
import { REQUEST_COLUMNS, rowToValues, type RegistrationExportRow } from "@/lib/requests/import-export";

export const GET = withModuleAction("requests", "view", async ({ user }) => {
  const where: Record<string, unknown> = { deletedAt: null };
  if (user.role === "CONTRACTOR" && user.companyId) {
    where.request = { companyId: user.companyId };
  }

  const requestCourses = await db.trainingRequestCourse.findMany({
    where,
    include: {
      course: { select: { title: true, durationHours: true } },
      request: { select: { company: { select: { name: true, industry: true, city: true, phone: true, email: true } } } },
      trainees: {
        where: { deletedAt: null },
        include: { trainee: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  const rows: RegistrationExportRow[] = [];
  for (const rc of requestCourses) {
    const company = rc.request.company;
    for (const link of rc.trainees) {
      const trainee = link.trainee;
      rows.push({
        name: trainee.fullName,
        nationalId: trainee.nationalId,
        jobTitle: trainee.jobTitle,
        companyName: company.name,
        activity: company.industry,
        region: null,
        city: company.city,
        phone: trainee.mobile ?? company.phone,
        email: trainee.email ?? company.email,
        courseTitle: rc.course.title,
        duration: rc.course.durationHours,
      });
    }
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GCCLAB TMS";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Registrations", { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });

  sheet.columns = REQUEST_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 26;
  headerRow.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  rows.forEach((row, i) => {
    const dataRow = sheet.addRow(rowToValues(row, i + 1));
    dataRow.font = { size: 10 };
    dataRow.border = { bottom: { style: "hair", color: { argb: "FFEEEEEE" } } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `training-requests_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
