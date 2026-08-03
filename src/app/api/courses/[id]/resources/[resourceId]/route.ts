// /api/courses/[id]/resources/[resourceId] — update + delete a course resource
// PUT    — update fields (Super Admin / Coordinator)
// DELETE — soft-delete (Super Admin / Coordinator)
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, fail, notFound, audit } from "@/lib/auth/api";

const VALID_TYPES = ["PDF", "POWERPOINT", "URL", "QR_CODE"];

export const PUT = withErrorEnvelope(async function PUT(req: Request, ctx: { params: Promise<{ id: string; resourceId: string }> }) {
  const user = await requireRole("SUPER_ADMIN", "COORDINATOR");
  const { id, resourceId } = await ctx.params;

  const existing = await db.courseResource.findUnique({ where: { id: resourceId } });
  if (!existing || existing.deletedAt || existing.courseId !== id) {
    return notFound("Resource not found");
  }

  const body = await req.json().catch(() => ({}));
  const { type, title, titleAr, url, description, order, isActive } = body as Record<string, unknown>;

  if (type !== undefined && !VALID_TYPES.includes(type as string)) {
    return fail(`type must be one of: ${VALID_TYPES.join(", ")}`, 422, "VALIDATION_ERROR");
  }

  const updated = await db.courseResource.update({
    where: { id: resourceId },
    data: {
      ...(type !== undefined && { type: type as string }),
      ...(title !== undefined && { title: title as string }),
      ...(titleAr !== undefined && { titleAr: (titleAr as string) ?? null }),
      ...(url !== undefined && { url: url as string }),
      ...(description !== undefined && { description: (description as string) ?? null }),
      ...(order !== undefined && { order: order as number }),
      ...(isActive !== undefined && { isActive: isActive as boolean }),
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "UPDATE",
    entity: "COURSE",
    entityId: id,
    description: `Updated resource "${updated.title}" (${updated.type})`,
    descriptionAr: `تحديث مورد "${updated.title}" (${updated.type})`,
    req,
    metadata: { resourceId, before: existing, after: updated },
  });

  return ok(updated);
});

export const DELETE = withErrorEnvelope(async function DELETE(req: Request, ctx: { params: Promise<{ id: string; resourceId: string }> }) {
  const user = await requireRole("SUPER_ADMIN", "COORDINATOR");
  const { id, resourceId } = await ctx.params;

  const existing = await db.courseResource.findUnique({ where: { id: resourceId } });
  if (!existing || existing.deletedAt || existing.courseId !== id) {
    return notFound("Resource not found");
  }

  await db.courseResource.update({
    where: { id: resourceId },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "COURSE",
    entityId: id,
    description: `Deleted resource "${existing.title}" (${existing.type})`,
    descriptionAr: `حذف مورد "${existing.title}" (${existing.type})`,
    req,
    metadata: { resourceId, type: existing.type, url: existing.url },
  });

  return ok({ success: true });
});
