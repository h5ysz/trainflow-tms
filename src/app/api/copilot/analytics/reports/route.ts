// /api/copilot/analytics/reports — generate + download reports
// =====================================================================
// POST { type, format, range?, entityId? } → file download
//
// Supported formats: pdf, xlsx, docx
// Supported types: monthly, quarterly, yearly, trainer, contractor,
//   financial, operational, attendance, exam, certificate
import { withModuleAction, fail, audit } from "@/lib/auth/api";
import { generateReport } from "@/lib/ai/analytics/reports";
import type { AnalyticsScope, ReportFormat, ReportType } from "@/lib/ai/analytics/types";

const VALID_FORMATS: ReportFormat[] = ["pdf", "xlsx", "docx"];
const VALID_TYPES: ReportType[] = [
  "monthly", "quarterly", "yearly", "trainer", "contractor",
  "financial", "operational", "attendance", "exam", "certificate",
];

export const POST = withModuleAction("ai-dashboard", "view", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { type, format, range, entityId } = body as {
    type?: ReportType;
    format?: ReportFormat;
    range?: string;
    entityId?: string;
  };

  if (!type || !VALID_TYPES.includes(type)) {
    return fail(`Invalid type. Must be one of: ${VALID_TYPES.join(", ")}`, 422, "VALIDATION_ERROR");
  }
  if (!format || !VALID_FORMATS.includes(format)) {
    return fail(`Invalid format. Must be one of: ${VALID_FORMATS.join(", ")}`, 422, "VALIDATION_ERROR");
  }

  // Permission: financial reports require financial access
  const scope: AnalyticsScope = {
    role: user.role,
    userId: user.id,
    companyId: user.companyId ?? null,
    canSeeFinancial: user.role === "SUPER_ADMIN" || user.role === "COORDINATOR" || user.role === "AUDITOR",
    canSeeOperational: user.role !== "CONTRACTOR",
  };
  if ((type === "financial" || type === "contractor") && !scope.canSeeFinancial && user.role !== "CONTRACTOR") {
    return fail("You do not have permission to generate this report type", 403, "FORBIDDEN");
  }
  // Contractors can only generate their own contractor report
  if (user.role === "CONTRACTOR" && type !== "contractor") {
    return fail("Contractors can only generate their own contractor report", 403, "FORBIDDEN");
  }

  const report = await generateReport({ type, format, range: (range as "7d" | "30d" | "90d" | "ytd" | "12m" | "all") ?? "30d", entityId }, scope);

  // Audit log
  await audit({
    user,
    action: "EXPORT",
    entity: "USER",
    description: report.auditDescription,
    descriptionAr: report.auditDescriptionAr,
    req,
    metadata: {
      aiGenerated: true,
      copilotAction: "ANALYTICS_REPORT",
      reportType: type,
      reportFormat: format,
      filename: report.filename,
    },
  });

  // Return as a file download
  return new Response(report.buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": report.mimeType,
      "Content-Disposition": `attachment; filename="${report.filename}"`,
      "Content-Length": String(report.buffer.length),
    },
  });
});
