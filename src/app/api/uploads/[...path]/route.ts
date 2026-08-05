// /api/uploads/[...path] — serves uploaded files from public/uploads/
//
// Next.js standalone server does NOT serve files that are created at runtime
// under public/. Files uploaded to public/uploads/trainee-docs/ and
// public/uploads/request-docs/ after the build completes are invisible to
// the standalone static handler. This route reads them from disk and streams
// them with the correct Content-Type.
//
// Security: only serves files under /uploads/ — the [...path] catch-all
// is restricted to that prefix by construction.
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { requireAuth, ok, fail } from "@/lib/auth/api";

const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const GET = async (req: Request, ctx: { params: Promise<{ path: string[] }> | { path: string[] } }) => {
  // Require authentication — only logged-in users can view attachments
  try {
    await requireAuth();
  } catch {
    return fail("Unauthorized", 401);
  }

  const params = ctx.params instanceof Promise ? await ctx.params : ctx.params;
  const relPath = (params.path as string[]).join("/");
  const fullPath = path.join(UPLOADS_ROOT, relPath);

  // Prevent path traversal — resolve and check it's still under UPLOADS_ROOT
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(UPLOADS_ROOT + path.sep)) {
    return fail("Forbidden", 403);
  }

  try {
    const data = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME[ext] ?? "application/octet-stream";
    return new Response(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(data.length),
      },
    });
  } catch {
    return fail("File not found", 404);
  }
};
