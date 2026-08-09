// /api/trainer-certifications/export — download the trainer×course certification
// matrix as an .xlsx (one row per course, one column per trainer, "X" = certified).
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction } from "@/lib/auth/api";
import { buildMatrixRows, type MatrixCourse } from "@/lib/certifications/import-export";

export const GET = withModuleAction("trainer-qualifications", "view", async () => {
  const [courses, trainers, certs] = await Promise.all([
    db.course.findMany({ where: { deletedAt: null, status: "ACTIVE" }, orderBy: { code: "asc" } }),
    db.trainer.findMany({ where: { deletedAt: null, status: "ACTIVE" }, orderBy: { nameEn: "asc" } }),
    db.trainerCertification.findMany({
      where: { deletedAt: null, status: "VALID" },
      select: { courseId: true, trainer: { select: { nameEn: true } } },
    }),
  ]);

  const certifiedByCourse = new Map<string, Set<string>>();
  for (const cert of certs) {
    if (!certifiedByCourse.has(cert.courseId)) certifiedByCourse.set(cert.courseId, new Set());
    certifiedByCourse.get(cert.courseId)!.add(cert.trainer.nameEn);
  }

  const trainerNames = trainers.map((t) => t.nameEn);
  const matrixCourses: MatrixCourse[] = courses.map((c) => ({
    code: c.code,
    title: c.title,
    durationHours: c.durationHours,
    certifiedTrainerNames: certifiedByCourse.get(c.id) ?? new Set(),
  }));

  const { header, rows, totalsRow } = buildMatrixRows(matrixCourses, trainerNames);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GCCLAB TMS";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Certifications", { views: [{ state: "frozen", ySplit: 1 }] });

  const headerRow = sheet.addRow(header);
  headerRow.height = 26;
  headerRow.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };

  sheet.getColumn(1).width = 5;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 40;
  sheet.getColumn(4).width = 12;
  for (let i = 5; i <= header.length; i++) sheet.getColumn(i).width = 14;

  rows.forEach((values) => {
    const row = sheet.addRow(values);
    row.font = { size: 10 };
    row.alignment = { horizontal: "center" };
    row.getCell(3).alignment = { horizontal: "left" };
  });

  const totals = sheet.addRow(totalsRow);
  totals.font = { bold: true, size: 10 };
  sheet.mergeCells(totals.number, 1, totals.number, 4);

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `trainer-certifications_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
