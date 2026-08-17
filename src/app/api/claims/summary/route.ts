// /api/claims/summary — monthly summary of all claims overlapping a month.
//   ?month=YYYY-MM&format=json  → { month, mainLocation, rows }
//   ?month=YYYY-MM&format=xlsx  → Overtime + Business Mission summary workbook
//   ?month=YYYY-MM&format=pdf   → printable summary PDF
// Gate: claims.view (summary is aggregated, no trainer ownership restriction).
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction, fail, ok } from "@/lib/auth/api";
import PDFDocument from "pdfkit";
import { arabicFontPath, arabicFontBoldPath, certificateLogoPath } from "@/lib/pdf/fonts";
import { buildSummaryWorkbook, workbookBuffer, type SummaryRow } from "@/lib/claims/export/excel";
import { buildSummaryPdf, type ClaimPdfOptions } from "@/lib/claims/export/pdf";
import { getClaimConfig } from "@/lib/claims/config";

export const GET = withModuleAction("claims", "view", async ({ req }) => {
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? "";
  const format = url.searchParams.get("format") ?? "json";

  if (!/^\d{4}-\d{2}$/.test(month)) {
    return fail("month must be YYYY-MM", 422, "VALIDATION_ERROR");
  }
  const [y, m] = month.split("-").map(Number);
  if (m < 1 || m > 12) return fail("month must be YYYY-MM", 422, "VALIDATION_ERROR");
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));

  const claims = await db.trainerClaim.findMany({
    where: {
      deletedAt: null,
      periodFrom: { lte: to },
      periodTo: { gte: from },
    },
    include: {
      trainer: { select: { id: true, refNumber: true, nameEn: true, nameAr: true, engagementType: true } },
    },
    orderBy: [{ status: "asc" }, { periodFrom: "asc" }],
  });

  const rows: SummaryRow[] = claims.map((c) => ({
    trainerId: c.trainer.id,
    trainerRef: c.trainer.refNumber,
    trainerNameEn: c.trainer.nameEn,
    trainerNameAr: c.trainer.nameAr,
    engagementType: c.trainer.engagementType,
    claimRef: c.refNumber,
    status: c.status,
    periodFrom: c.periodFrom.toISOString().slice(0, 10),
    periodTo: c.periodTo.toISOString().slice(0, 10),
    totalHours: c.totalHours,
    totalDays: c.totalDays,
    totalAmount: c.totalAmount,
    currency: c.currency,
  }));

  if (format === "json") {
    const config = await getClaimConfig();
    return ok({ month, mainLocation: config.mainLocation, rows });
  }

  const config = await getClaimConfig();
  const opts = { mainLocation: config.mainLocation, requestedByName: "Coordinator", approvedByName: "Authorized Approver" };

  if (format === "pdf") {
    const doc = new PDFDocument({ size: "A4", margin: 42 });
    const arabicFont = arabicFontPath();
    const arabicBoldFont = arabicFontBoldPath();
    if (arabicFont) doc.registerFont("Claim", arabicFont);
    if (arabicBoldFont) doc.registerFont("Claim-Bold", arabicBoldFont);
    const pdfOpts: ClaimPdfOptions = {
      fontName: arabicFont ? "Claim" : null,
      fontNameBold: arabicBoldFont ? "Claim-Bold" : null,
      logoPath: certificateLogoPath(),
    };
    const pdfBuffer = await buildSummaryPdf(month, rows, pdfOpts);
    return new NextResponse(new Uint8Array(pdfBuffer) as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="claims-summary-${month}.pdf"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  }

  if (format === "xlsx") {
    const workbook = buildSummaryWorkbook(month, rows, opts);
    const buffer = await workbookBuffer(workbook);
    return new NextResponse(buffer as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="claims-summary-${month}.xlsx"`,
        "Content-Length": buffer.length.toString(),
      },
    });
  }

  return fail("format must be json, xlsx or pdf", 422, "VALIDATION_ERROR");
});
