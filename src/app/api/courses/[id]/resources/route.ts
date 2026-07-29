// /api/courses/[id]/resources — list + create external course resources
// =====================================================================
// Sprint 6: Course materials are external (PowerPoint, PDF, URL, QR link).
// GCCLAB does NOT store the actual content — only pointers to external URLs.
//
// GET   — list all active resources for a course (public to enrolled trainees)
// POST  — create a new resource (Super Admin / Coordinator only)
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, created, fail, notFound, audit } from "@/lib/auth/api";

// GET — list resources for a course (any authenticated user)
export const GET = withErrorEnvelope(async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const course = await db.course.findUnique({ where: { id } });
  if (!course || course.deletedAt) return notFound("Course not found");

  const resources = await db.courseResource.findMany({
    where: { courseId: id, deletedAt: null, isActive: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });

  return ok(resources);
});

// POST — create a new resource (Super Admin / Coordinator)
export const POST = withErrorEnvelope(async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SUPER_ADMIN", "COORDINATOR");
  const { id } = await ctx.params;

  const course = await db.course.findUnique({ where: { id } });
  if (!course || course.deletedAt) return notFound("Course not found");

  const body = await req.json().catch(() => ({}));
  const { type, title, titleAr, url, description, order, isActive } = body as {
    type?: string;
    title?: string;
    titleAr?: string;
    url?: string;
    description?: string;
    order?: number;
    isActive?: boolean;
  };

  // Validate
  const VALID_TYPES = ["PDF", "POWERPOINT", "URL", "QR_CODE"];
  if (!type || !VALID_TYPES.includes(type)) {
    return fail(`type must be one of: ${VALID_TYPES.join(", ")}`, 422, "VALIDATION_ERROR");
  }
  if (!title || !url) {
    return fail("title and url are required", 422, "VALIDATION_ERROR");
  }

  const resource = await db.courseResource.create({
    data: {
      courseId: id,
      type,
      title,
      titleAr: titleAr ?? null,
      url,
      description: description ?? null,
      order: order ?? 0,
      isActive: isActive ?? true,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "COURSE",
    entityId: id,
    entityRef: course.code,
    description: `Added ${type} resource "${title}" to course ${course.code}`,
    descriptionAr: `إضافة مورد ${type} "${title}" إلى دورة ${course.code}`,
    req,
    metadata: { resourceId: resource.id, type, url },
  });

  return created(resource);
});
