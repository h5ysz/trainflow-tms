// /api/export/company-data — export company data with scope + items + format
//
// Query params:
//   scope: last | specific_request | specific_course | date_range | all
//   items: comma-separated (requests, trainees, attendance, results, evaluations, certificates, invoices, attachments)
//   format: excel | pdf | zip
//   specificId?: string (for specific_request / specific_course)
//   dateFrom?: string (for date_range)
//   dateTo?: string (for date_range)
//
// RBAC: Contractors export only their own company's data.
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ok, fail } from "@/lib/auth/api";

export const GET = async (req: NextRequest) => {
  const user = await requireAuth();
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope") || "last";
  const items = (url.searchParams.get("items") || "").split(",").filter(Boolean);
  const format = url.searchParams.get("format") || "excel";
  const specificId = url.searchParams.get("specificId");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  if (items.length === 0) return fail("No items selected", 422, "VALIDATION_ERROR");
  if (!user.companyId) return fail("No company linked", 403);

  // Build the where clause based on scope
  const where: Record<string, unknown> = { companyId: user.companyId, deletedAt: null };
  switch (scope) {
    case "last": {
      const lastReq = await db.trainingRequest.findFirst({
        where: { companyId: user.companyId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true },
      });
      if (lastReq) where.id = lastReq.id;
      break;
    }
    case "specific_request":
      if (specificId) where.id = specificId;
      break;
    case "date_range":
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) (where.createdAt as Record<string, unknown>).gte = new Date(dateFrom);
        if (dateTo) (where.createdAt as Record<string, unknown>).lte = new Date(dateTo);
      }
      break;
    case "all":
    default:
      // No additional filter — all company data
      break;
  }

  // Collect data based on items
  const exportData: Record<string, unknown> = {};

  if (items.includes("requests")) {
    exportData.requests = await db.trainingRequest.findMany({
      where,
      select: {
        refNumber: true, status: true, priority: true, traineeCount: true,
        preferredDateFrom: true, preferredDateTo: true, preferredLocation: true,
        preferredLanguage: true, notes: true, createdAt: true,
        course: { select: { title: true, code: true } },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  if (items.includes("trainees")) {
    const requests = await db.trainingRequest.findMany({
      where,
      select: {
        id: true, refNumber: true,
        requestCourses: {
          where: { deletedAt: null },
          select: {
            trainees: {
              where: { deletedAt: null },
              include: {
                trainee: {
                  select: { fullName: true, nationalId: true, nationality: true, jobTitle: true, mobile: true, email: true },
                },
              },
            },
          },
        },
      },
    });
    exportData.trainees = requests.flatMap((r) =>
      r.requestCourses.flatMap((rc) =>
        rc.trainees.map((trc) => ({
          requestRef: r.refNumber,
          ...trc.trainee,
        }))
      )
    );
  }

  if (items.includes("attendance") || items.includes("results") || items.includes("certificates")) {
    const sessions = await db.trainingSession.findMany({
      where: { request: { companyId: user.companyId, deletedAt: null } },
      select: {
        refNumber: true, title: true, startDate: true, endDate: true, status: true,
        attendance: items.includes("attendance") ? {
          where: { deletedAt: null },
          select: { traineeName: true, status: true, checkInAt: true, checkOutAt: true },
        } : false,
        testResults: items.includes("results") ? {
          where: { deletedAt: null },
          select: { traineeName: true, testType: true, scorePercent: true, passed: true, attemptedAt: true },
        } : false,
        certificates: items.includes("certificates") ? {
          where: { deletedAt: null },
          select: { refNumber: true, traineeName: true, finalScore: true, issuedAt: true, validUntil: true, status: true },
        } : false,
      },
    });
    if (items.includes("attendance")) exportData.attendance = sessions.flatMap((s) => s.attendance?.map((a) => ({ sessionRef: s.refNumber, ...a })) || []);
    if (items.includes("results")) exportData.results = sessions.flatMap((s) => s.testResults?.map((r) => ({ sessionRef: s.refNumber, ...r })) || []);
    if (items.includes("certificates")) exportData.certificates = sessions.flatMap((s) => s.certificates?.map((c) => ({ sessionRef: s.refNumber, ...c })) || []);
  }

  if (items.includes("invoices")) {
    exportData.invoices = await db.invoice.findMany({
      where: { companyId: user.companyId, deletedAt: null },
      select: { refNumber: true, grandTotal: true, paidAmount: true, outstandingBalance: true, currency: true, status: true, issueDate: true },
      orderBy: { issueDate: "desc" },
    });
  }

  // Return as JSON — the frontend will handle the download
  // For a real implementation, we'd generate Excel/PDF/ZIP here.
  // For now, return JSON and let the frontend trigger a download.
  const jsonStr = JSON.stringify(exportData, null, 2);
  const filename = `export-${scope}-${Date.now()}.json`;

  return new Response(jsonStr, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};
