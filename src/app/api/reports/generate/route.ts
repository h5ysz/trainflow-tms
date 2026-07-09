// /api/reports/generate — generate a report from a template and export it
// POST: { template, format, filter } → returns file download
import { NextResponse } from "next/server";
import { getCurrentUser, fail, audit } from "@/lib/auth/api";
import { getTemplate } from "@/lib/reports/template-registry";
import { exportReport } from "@/lib/reports/export-service";
import type { ReportFilter } from "@/lib/reports/template-registry";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);

  const body = await req.json().catch(() => ({}));
  const { template: templateCode, format, filter } = body as {
    template: string;
    format: "xlsx" | "pdf";
    filter: ReportFilter;
  };

  if (!templateCode) return fail("template is required", 422, "VALIDATION_ERROR");
  if (!format || !["xlsx", "pdf"].includes(format)) {
    return fail("format must be 'xlsx' or 'pdf'", 422, "VALIDATION_ERROR");
  }

  const template = getTemplate(templateCode);
  if (!template) return fail(`Template "${templateCode}" not found`, 404, "TEMPLATE_NOT_FOUND");

  if (!template.supportedFormats.includes(format)) {
    return fail(`Template "${templateCode}" does not support ${format} format`, 400, "UNSUPPORTED_FORMAT");
  }

  // Apply user's company scope for contractors
  const effectiveFilter: ReportFilter = { ...filter };
  if (user.role === "CONTRACTOR" && user.companyId) {
    effectiveFilter.companyId = user.companyId;
  }

  // Query data from the production database
  const data = await template.query(effectiveFilter);

  // Build filter info for the report header
  const filterInfo: Record<string, string> = {};
  if (effectiveFilter.month) filterInfo["Month"] = effectiveFilter.month;
  if (effectiveFilter.dateFrom) filterInfo["From"] = effectiveFilter.dateFrom;
  if (effectiveFilter.dateTo) filterInfo["To"] = effectiveFilter.dateTo;
  if (effectiveFilter.companyId) filterInfo["Company ID"] = effectiveFilter.companyId;
  if (effectiveFilter.trainerId) filterInfo["Trainer ID"] = effectiveFilter.trainerId;
  if (effectiveFilter.courseId) filterInfo["Course ID"] = effectiveFilter.courseId;
  if (effectiveFilter.city) filterInfo["City"] = effectiveFilter.city;
  if (effectiveFilter.region) filterInfo["Region"] = effectiveFilter.region;

  // Export
  const result = await exportReport(template, format, data, filterInfo);

  // Audit
  await audit({
    user,
    action: "CREATE",
    entity: "SETTING",
    description: `Generated report: ${template.name} (${format.toUpperCase()}) — ${data.length} rows`,
    descriptionAr: `تم توليد تقرير: ${template.nameAr} (${format.toUpperCase()}) — ${data.length} صف`,
    req,
    metadata: {
      templateCode,
      format,
      rowCount: data.length,
      filter: effectiveFilter,
    },
  });

  // Node's Buffer is typed over ArrayBufferLike, which doesn't satisfy the web
  // BodyInit; re-wrap as a plain Uint8Array.
  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": result.mimeType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Content-Length": result.buffer.length.toString(),
    },
  });
}

// GET endpoint — returns a preview of the report data (JSON, no export)
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);

  const url = new URL(req.url);
  const templateCode = url.searchParams.get("template");
  if (!templateCode) return fail("template query parameter is required", 422, "VALIDATION_ERROR");

  const template = getTemplate(templateCode);
  if (!template) return fail(`Template "${templateCode}" not found`, 404, "TEMPLATE_NOT_FOUND");

  const filter: ReportFilter = {
    month: url.searchParams.get("month") ?? undefined,
    dateFrom: url.searchParams.get("dateFrom") ?? undefined,
    dateTo: url.searchParams.get("dateTo") ?? undefined,
    companyId: url.searchParams.get("companyId") ?? undefined,
    trainerId: url.searchParams.get("trainerId") ?? undefined,
    courseId: url.searchParams.get("courseId") ?? undefined,
    city: url.searchParams.get("city") ?? undefined,
    region: url.searchParams.get("region") ?? undefined,
    client: url.searchParams.get("client") ?? undefined,
  };

  // Apply user's company scope for contractors
  if (user.role === "CONTRACTOR" && user.companyId) {
    filter.companyId = user.companyId;
  }

  const data = await template.query(filter);

  return NextResponse.json({
    success: true,
    data: {
      template: templateCode,
      templateName: template.name,
      columns: template.columns,
      rowCount: data.length,
      rows: data.slice(0, 100), // preview: first 100 rows
      totalRows: data.length,
      filter,
    },
  });
}
