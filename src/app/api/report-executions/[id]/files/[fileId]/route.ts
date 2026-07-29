// /api/report-executions/[id]/files/[fileId] — download a stored report file.
//
// Scheduled reports produced xlsx/pdf buffers that were then discarded; there was no
// way to obtain them at all. They are now persisted (see lib/reports/file-store.ts) and
// this is how they come back out.
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction, notFound, fail, audit } from "@/lib/auth/api";

/**
 * Content-Disposition with both the plain and RFC 5987 forms.
 * Report filenames contain spaces and Arabic; the plain parameter is ASCII-safe for
 * older clients, and `filename*` carries the real name.
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

export const GET = withModuleAction("report-schedules", "view", async ({ params, user, req }) => {
  const executionId = params.id as string;
  const fileId = params.fileId as string;

  const file = await db.reportExecutionFile.findUnique({
    where: { id: fileId },
    include: { execution: { select: { id: true, scheduleId: true } } },
  });

  if (!file) return notFound("File not found or expired");

  // The [id] segment must actually own this file. Without this check it is decorative,
  // and any fileId would be servable under any execution the caller may read — which
  // matters the moment executions become scoped per user or per company.
  if (file.execution.id !== executionId) {
    return fail("File does not belong to this execution", 404, "NOT_FOUND");
  }

  await audit({
    user,
    action: "EXPORT",
    entity: "SETTING",
    entityId: file.id,
    description: `Downloaded report file ${file.filename}`,
    descriptionAr: `تم تنزيل ملف التقرير ${file.filename}`,
    req,
    metadata: { executionId, scheduleId: file.execution.scheduleId, sizeBytes: file.sizeBytes },
  });

  return new NextResponse(new Uint8Array(file.content), {
    status: 200,
    headers: {
      "Content-Type": file.mimeType,
      "Content-Disposition": contentDisposition(file.filename),
      "Content-Length": String(file.sizeBytes),
      // Report contents are confidential; never let a shared cache hold them.
      "Cache-Control": "private, no-store",
    },
  });
});
