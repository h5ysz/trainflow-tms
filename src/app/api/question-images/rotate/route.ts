// /api/question-images/rotate — rotate a question image on disk (any authenticated user).
// POST { url: "/api/uploads/question-images/...", degrees: 90 | -90 | 180 }
import { promises as fs } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { withModuleAction, ok, fail } from "@/lib/auth/api";

const PUBLIC_PREFIX = "/api/uploads/question-images";

function resolveDiskPath(url: string): string | null {
  const clean = url.split("?")[0];
  if (clean.startsWith(PUBLIC_PREFIX + "/")) {
    return path.join(process.cwd(), "public", "uploads", "question-images", clean.slice(PUBLIC_PREFIX.length + 1));
  }
  return null;
}

export const POST = withModuleAction("course-materials", "create", async ({ req }) => {
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
    return ok({ url: body.url.split("?")[0] });
  } catch (e) {
    console.error("[question-images/rotate]", e);
    return fail("Rotate failed", 500);
  }
});
