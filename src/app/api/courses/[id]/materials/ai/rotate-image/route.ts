// /api/courses/[id]/materials/ai/rotate-image — rotate a question image on disk.
// POST { url: "/api/uploads/question-images/...", degrees: 90 | -90 | 180 }
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { db } from "@/lib/db";
import { withModuleAction, ok, fail } from "@/lib/auth/api";
import { ensureTrainerCanAccessCourse } from "@/lib/api/course-materials";

const PUBLIC_PREFIX = "/api/uploads/question-images";

function resolveDiskPath(url: string): string | null {
  if (url.startsWith(PUBLIC_PREFIX + "/")) {
    return path.join(process.cwd(), "public", "uploads", "question-images", url.slice(PUBLIC_PREFIX.length + 1));
  }
  return null;
}

export const POST = withModuleAction("course-materials", "create", async ({ req, user, params }) => {
  const courseId = params.id as string;
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course || course.deletedAt) return fail("Course not found", 404, "NOT_FOUND");
  if (!(await ensureTrainerCanAccessCourse(user, courseId))) return fail("Forbidden", 403, "FORBIDDEN");

  const body = await req.json().catch(() => null) as { url?: string; degrees?: number } | null;
  if (!body?.url || typeof body.url !== "string") {
    return fail("Missing url", 422, "VALIDATION_ERROR");
  }
  const degrees = body.degrees ?? 90;
  if (![90, -90, 180, -180, 270, -270].includes(degrees)) {
    return fail("degrees must be 90, -90, 180, -180, 270, or -270", 422, "VALIDATION_ERROR");
  }

  const diskPath = resolveDiskPath(body.url);
  if (!diskPath) {
    return fail("Invalid image URL", 422, "VALIDATION_ERROR");
  }

  try {
    const input = await fs.readFile(diskPath);
    const rotated = await sharp(input).rotate(degrees).png().toBuffer();
    await fs.writeFile(diskPath, rotated);
    return ok({ url: body.url });
  } catch (e) {
    console.error("[rotate-image]", e);
    return fail("Rotate failed", 500);
  }
});
