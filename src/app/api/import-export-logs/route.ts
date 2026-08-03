// /api/import-export-logs — personal operation history for Import/Export dialogs
//
// GET: list recent operations for the current user (last 20)
// POST: create a new log entry after an import/export operation
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAuth, ok, fail } from "@/lib/auth/api";

export const GET = async (req: NextRequest) => {
  const user = await requireAuth();
  const logs = await db.importExportLog.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return ok(logs);
};

export const POST = async (req: NextRequest) => {
  const user = await requireAuth();
  const body = await req.json().catch(() => ({}));
  const { type, source, requestRef, courseName, itemCount, status, errorMessage } = body;

  if (!type || !source) return fail("type and source are required", 422, "VALIDATION_ERROR");

  const log = await db.importExportLog.create({
    data: {
      userId: user.id,
      type,
      source,
      requestRef: requestRef ?? null,
      courseName: courseName ?? null,
      itemCount: itemCount ?? 0,
      status: status ?? "SUCCESS",
      errorMessage: errorMessage ?? null,
    },
  });

  return ok(log);
};
