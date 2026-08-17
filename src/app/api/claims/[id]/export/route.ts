// /api/claims/[id]/export — download the claim as Excel or PDF.
//   ?format=xlsx → OT/Regular Hours approval sheet (+ legend) or Business Mission sheet
//   ?format=pdf  → same sheets as a printable PDF; business mission is bilingual
// Gate: claims.view; trainers may only export their own claims.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction, fail } from "@/lib/auth/api";
import PDFDocument from "pdfkit";
import { arabicFontPath, arabicFontBoldPath, certificateLogoPath } from "@/lib/pdf/fonts";
import { loadClaim, serializeClaim, type ClaimWithRelations } from "@/lib/claims/service";
import { buildClaimWorkbook, workbookBuffer, type ClaimExportData, type ClaimExportRow } from "@/lib/claims/export/excel";
import { buildOvertimeSheetPdf, buildBusinessMissionPdf, buildHrdFo052Pdf, buildContractorTimesheetPdf, type ClaimPdfOptions } from "@/lib/claims/export/pdf";

type SerializedItem = {
  id: string;
  date: Date;
  courseCode: string | null;
  courseTitle: string | null;
  location: string | null;
  shift: string | null;
  actualHours: number;
  originalValue: number;
  finalValue: number;
  unit: string;
  rate: number | null;
  amount: number | null;
  locationFlagged: boolean;
  coordinatorName: string | null;
};

function toExportRow(item: SerializedItem): ClaimExportRow {
  const d = item.date instanceof Date ? item.date : new Date(item.date);
  return {
    id: item.id,
    date: d.toISOString().slice(0, 10),
    courseCode: item.courseCode ?? null,
    courseTitle: item.courseTitle ?? null,
    location: item.location ?? null,
    shift: item.shift ?? null,
    actualHours: item.actualHours,
    originalValue: item.originalValue,
    finalValue: item.finalValue,
    unit: item.unit,
    rate: item.rate ?? null,
    amount: item.amount ?? null,
    locationFlagged: item.locationFlagged,
    coordinatorName: item.coordinatorName ?? null,
  };
}

async function toExportData(claim: ClaimWithRelations, userNames: Map<string, string>): Promise<ClaimExportData> {
  const serialized = serializeClaim(claim);
  const requestedByName = serialized.items.find((i) => i.coordinatorName)?.coordinatorName ?? "—";
  const approvedByName = claim.approvedBy ? (userNames.get(claim.approvedBy) ?? "—") : "—";
  return {
    refNumber: serialized.refNumber,
    claimType: serialized.claimType as "OVERTIME" | "BUSINESS_MISSION",
    engagementType: serialized.engagementType as "EMPLOYEE" | "CONTRACTOR",
    status: serialized.status,
    periodFrom: claim.periodFrom,
    periodTo: claim.periodTo,
    mainLocation: serialized.mainLocation,
    dailyAllowance: serialized.dailyAllowance,
    totalHours: serialized.totalHours,
    totalDays: serialized.totalDays,
    totalAmount: serialized.totalAmount,
    currency: serialized.currency,
    requestedByName,
    assignedToName: serialized.trainer.nameEn,
    approvedByName,
    trainerNameEn: serialized.trainer.nameEn,
    trainerNameAr: serialized.trainer.nameAr,
    items: serialized.items.map(toExportRow),
    // HRD-FO-052 fields
    employeeId: serialized.employeeId ?? undefined,
    employeeJobTitle: serialized.employeeJobTitle ?? undefined,
    employeeDepartment: serialized.employeeDepartment ?? undefined,
    employeeProject: serialized.employeeProject ?? undefined,
    employeeLineManager: serialized.employeeLineManager ?? undefined,
    normalWorkingHoursPerDay: serialized.normalWorkingHoursPerDay ?? undefined,
    estimatedOtPerDay: serialized.estimatedOtPerDay ?? undefined,
    requestedBy: serialized.requestedBy ?? undefined,
    reason: serialized.reason ?? undefined,
    acknowledgmentAccepted: serialized.acknowledgmentAccepted ?? undefined,
    lineManagerDecision: serialized.lineManagerDecision ?? undefined,
    lineManagerComments: serialized.lineManagerComments ?? undefined,
    lineManagerSignatureBy: serialized.lineManagerSignatureBy ?? undefined,
    lineManagerSignatureAt: serialized.lineManagerSignatureAt?.toISOString() ?? undefined,
    qhseAssessment: serialized.qhseAssessment ?? undefined,
    qhseControls: serialized.qhseControls ?? undefined,
    qhseSignatureBy: serialized.qhseSignatureBy ?? undefined,
    qhseSignatureAt: serialized.qhseSignatureAt?.toISOString() ?? undefined,
    hrDecision: serialized.hrDecision ?? undefined,
    hrMaxApprovedOt: serialized.hrMaxApprovedOt ?? undefined,
    hrApprovedPeriodFrom: serialized.hrApprovedPeriodFrom?.toISOString() ?? undefined,
    hrApprovedPeriodTo: serialized.hrApprovedPeriodTo?.toISOString() ?? undefined,
    hrSignatureBy: serialized.hrSignatureBy ?? undefined,
    hrSignatureAt: serialized.hrSignatureAt?.toISOString() ?? undefined,
    hrComments: serialized.hrComments ?? undefined,
    // Contractor fields
    contractorInvoiceNumber: serialized.contractorInvoiceNumber ?? undefined,
    contractorClient: serialized.contractorClient ?? undefined,
    contractorRatePerDay: serialized.contractorRatePerDay ?? undefined,
    createdAt: claim.createdAt,
  };
}

export const GET = withModuleAction("claims", "view", async ({ req, params, user }) => {
  const id = params.id as string;
  const format = new URL(req.url).searchParams.get("format") ?? "xlsx";

  const claim = await loadClaim(id);
  if (!claim || claim.deletedAt) return fail("Claim not found", 404);
  if (user.role === "TRAINER" && claim.trainerId !== user.trainerId) {
    return fail("Claim not found", 404);
  }

  // Resolve workflow actor names for the signature block.
  const actorIds = [
    claim.generatedBy,
    claim.submittedBy,
    claim.approvedBy,
    claim.returnedBy,
    claim.finalizedBy,
  ].filter((x): x is string => Boolean(x));
  const actorRows = actorIds.length > 0
    ? await db.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, fullName: true } })
    : [];
  const userNames = new Map(actorRows.map((u) => [u.id, u.fullName]));

  const data = await toExportData(claim, userNames);

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
    const pdfBuffer =
      data.claimType === "BUSINESS_MISSION"
        ? await buildBusinessMissionPdf(data, pdfOpts)
        : data.engagementType === "EMPLOYEE"
          ? await buildHrdFo052Pdf(data, pdfOpts)
          : await buildContractorTimesheetPdf(data, pdfOpts);
    const fileName =
      data.claimType === "BUSINESS_MISSION"
        ? `business-mission-${data.refNumber}.pdf`
        : data.engagementType === "EMPLOYEE"
          ? `hrd-fo-052-${data.refNumber}.pdf`
          : `contractor-timesheet-${data.refNumber}.pdf`;
    return new NextResponse(new Uint8Array(pdfBuffer) as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": pdfBuffer.length.toString(),
      },
    });
  }

  const workbook = buildClaimWorkbook(data);
  const buffer = await workbookBuffer(workbook);
  const fileName = data.claimType === "BUSINESS_MISSION" ? `business-mission-${data.refNumber}.xlsx` : `ot-sheet-${data.refNumber}.xlsx`;
  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Length": buffer.length.toString(),
    },
  });
});
