// /api/uploads/[...path] — serves uploaded files from public/uploads/
//
// Next.js standalone server does NOT serve files that are created at runtime
// under public/. Files uploaded to public/uploads/trainee-docs/ and
// public/uploads/request-docs/ after the build completes are invisible to
// the standalone static handler. This route reads them from disk and streams
// them with the correct Content-Type.
//
// Security: only serves files under /uploads/ — the [...path] catch-all
// is restricted to that prefix by construction. Course materials (المنهج) and
// their AI question extraction are trainer-only: files under
// course-materials/ additionally require the course-materials.view permission,
// so contractor/coordinator users cannot fetch the curriculum directly even if
// they obtain a file URL.
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { requireAuth, ok, fail, type AuthUser } from "@/lib/auth/api";
import { canPerformAction } from "@/lib/auth/permissions";

const UPLOADS_ROOT = path.join(process.cwd(), "public", "uploads");

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export const GET = async (req: Request, ctx: { params: Promise<{ path: string[] }> | { path: string[] } }) => {
  const params = ctx.params instanceof Promise ? await ctx.params : ctx.params;
  const relPath = (params.path as string[]).join("/");
  const fullPath = path.join(UPLOADS_ROOT, relPath);

  // Prevent path traversal — resolve and check it's still under UPLOADS_ROOT
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(UPLOADS_ROOT + path.sep)) {
    return fail("Forbidden", 403);
  }

  // Question images used in public exams (pre-test / final-test) must be
  // accessible without authentication so anonymous trainees can see them.
  // All other uploads require authentication.
  const isPublicQuestionImage = relPath.startsWith("question-images/");
  if (!isPublicQuestionImage) {
    let user: AuthUser;
    try {
      user = await requireAuth();
    } catch {
      return fail("Unauthorized", 401);
    }

    // Curriculum files are trainer-only: block them for anyone without
    // course-materials.view (contractors, coordinators, auditors, viewers...).
    if (relPath.startsWith("course-materials/") && !canPerformAction(user.permissions, "course-materials", "view")) {
      return fail("Forbidden", 403);
    }
  }

  try {
    const data = await fs.readFile(resolved);
    const ext = path.extname(resolved).toLowerCase();
    const contentType = MIME[ext] ?? "application/octet-stream";
    return new Response(data, {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${path.basename(resolved)}"`,
        "Cache-Control": "private, max-age=3600",
        "Content-Length": String(data.length),
      },
    });
  } catch {
    return fail("File not found", 404);
  }
};
