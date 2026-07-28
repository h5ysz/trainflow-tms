// /api/sessions/export — download all sessions as an .xlsx matching the
// course-schedule sheet format (Arabic headers, RTL).
import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction } from "@/lib/auth/api";
import { SESSION_COLUMNS, sessionToRow } from "@/lib/sessions/import-export";

export const GET = withModuleAction("sessions", "view", async () => {
  const sessions = await db.trainingSession.findMany({
    where: { deletedAt: null },
    include: {
      course: { select: { title: true } },
      trainer: { select: { fullName: true } },
    },
    orderBy: { startDate: "asc" },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GCCLAB TMS";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Sessions", {
    views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }],
  });

  sheet.columns = SESSION_COLUMNS.map((c) => ({ header: c.header, key: c.key, width: c.width }));

  const headerRow = sheet.getRow(1);
  headerRow.height = 26;
  headerRow.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  headerRow.border = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } } };

  sessions.forEach((s, i) => {
    const values = sessionToRow(
      {
        refNumber: s.refNumber,
        instituteName: s.instituteName,
        courseTitle: s.course?.title ?? "",
        classification: s.classification,
        expectedTrainees: s.expectedTrainees,
        startDate: s.startDate,
        endDate: s.endDate,
        durationDays: s.durationDays,
        shift: s.shift,
        region: s.region,
        city: s.city,
        venue: s.venue,
        locationMapUrl: s.locationMapUrl,
        trainerName: s.trainer?.fullName ?? null,
        notes: s.notes,
      },
      i + 1
    );
    const row = sheet.addRow(values);
    row.font = { size: 10 };
    row.border = { bottom: { style: "hair", color: { argb: "FFEEEEEE" } } };
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `training-sessions_${new Date().toISOString().slice(0, 10)}.xlsx`;

  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
});
