// /api/trainees/[id] — get / update / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { parseBody } from "@/lib/api/validate";
import { traineeUpdateSchema } from "@/lib/api/schemas";
import { recomputeSessionCounts } from "@/lib/sessions/session-management";

export const GET = withModuleAction("trainees", "view", async ({ params, user }) => {
  const id = params.id as string;
  const trainee = await db.trainee.findUnique({
    where: { id },
    include: {
      company: true,
      // request and course hang off requestCourse, not off the join row itself.
      requestCourses: {
        where: { deletedAt: null },
        include: {
          requestCourse: {
            include: {
              request: { select: { id: true, refNumber: true, status: true } },
              course: { select: { id: true, title: true, code: true, refNumber: true } },
            },
          },
        },
      },
    },
  });
  if (!trainee || trainee.deletedAt) return notFound("Trainee not found");
  // Contractors may only see trainees belonging to their own company.
  if (user.role === "CONTRACTOR" && trainee.companyId !== user.companyId) {
    return notFound("Trainee not found");
  }
  return ok(trainee);
});

export const PUT = withModuleAction("trainees", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const parsed = await parseBody(req, traineeUpdateSchema);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const existing = await db.trainee.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Trainee not found");

  // Contractors may only edit their own company's trainees, and may not move a
  // trainee into or out of their company.
  if (user.role === "CONTRACTOR" && existing.companyId !== user.companyId) {
    return notFound("Trainee not found");
  }

  const { fullName, nationalId, nationality, jobTitle, mobile, email, companyId, status, notes, idAttachmentUrl, dateOfBirth, idExpiry } = body;

  if (user.role === "CONTRACTOR" && companyId !== undefined && companyId !== user.companyId) {
    return fail("Forbidden — cannot reassign trainee to another company", 403);
  }

  // Prevent duplicate National ID on update (scoped to the same company)
  if (nationalId && nationalId !== existing.nationalId) {
    const dup = await db.trainee.findFirst({
      where: { nationalId, companyId: companyId ?? existing.companyId, deletedAt: null, NOT: { id } },
    });
    if (dup) {
      return fail(`National ID "${nationalId}" already in use by ${dup.refNumber}`, 400, "DUPLICATE_NATIONAL_ID");
    }
  }

  const companyChanged = companyId && companyId !== existing.companyId;
  if (companyChanged) {
    const company = await db.company.findFirst({ where: { id: companyId!, deletedAt: null } });
    if (!company) return fail("Company not found", 404);
  }

  const updated = await db.trainee.update({
    where: { id },
    data: {
      ...(fullName !== undefined && { fullName }),
      ...(nationalId !== undefined && { nationalId }),
      ...(nationality !== undefined && { nationality }),
      ...(jobTitle !== undefined && { jobTitle }),
      ...(mobile !== undefined && { mobile }),
      ...(email !== undefined && { email }),
      ...(companyId !== undefined && { companyId }),
      ...(status !== undefined && { status }),
      ...(notes !== undefined && { notes }),
      ...(idAttachmentUrl !== undefined && { idAttachmentUrl: idAttachmentUrl || null }),
      ...(dateOfBirth !== undefined && { dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null }),
      ...(idExpiry !== undefined && { idExpiry: idExpiry ? new Date(idExpiry) : null }),
      updatedBy: user.id,
    },
  });

  // ── Cascade company change to active enrollments + SessionCompany ──────
  // When a trainee's company changes, their active SessionEnrollment rows
  // should reflect the new company so the per-company breakdown stays
  // accurate. We update the companyId snapshot on active enrollments and
  // recompute SessionCompany for every affected session.
  if (companyChanged) {
    const activeEnrollments = await db.sessionEnrollment.findMany({
      where: { traineeId: id, deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
      select: { id: true, sessionId: true },
    });
    if (activeEnrollments.length > 0) {
      const affectedSessionIds = new Set(activeEnrollments.map((e) => e.sessionId));
      // Update the companyId snapshot on active enrollments
      await db.sessionEnrollment.updateMany({
        where: { traineeId: id, deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
        data: { companyId: companyId! },
      });
      // Recompute SessionCompany for every affected session
      for (const sessionId of affectedSessionIds) {
        await recomputeSessionCounts(sessionId);
      }
    }
  }

  // Build a focused before/after diff for the audit log (not the full Prisma
  // objects, which are noisy and include internal fields).
  const changes: Record<string, { before: unknown; after: unknown }> = {};
  if (fullName !== undefined && fullName !== existing.fullName) changes.fullName = { before: existing.fullName, after: fullName };
  if (nationalId !== undefined && nationalId !== existing.nationalId) changes.nationalId = { before: existing.nationalId, after: nationalId };
  if (nationality !== undefined && nationality !== existing.nationality) changes.nationality = { before: existing.nationality, after: nationality };
  if (jobTitle !== undefined && jobTitle !== existing.jobTitle) changes.jobTitle = { before: existing.jobTitle, after: jobTitle };
  if (mobile !== undefined && mobile !== existing.mobile) changes.mobile = { before: existing.mobile, after: mobile };
  if (email !== undefined && email !== existing.email) changes.email = { before: existing.email, after: email };
  if (companyChanged) changes.companyId = { before: existing.companyId, after: companyId };
  if (status !== undefined && status !== existing.status) changes.status = { before: existing.status, after: status };
  if (notes !== undefined && notes !== existing.notes) changes.notes = { before: existing.notes, after: notes };
  if (idAttachmentUrl !== undefined && idAttachmentUrl !== existing.idAttachmentUrl) changes.idAttachmentUrl = { before: existing.idAttachmentUrl, after: idAttachmentUrl };
  if (dateOfBirth !== undefined) changes.dateOfBirth = { before: existing.dateOfBirth?.toISOString() ?? null, after: dateOfBirth ?? null };
  if (idExpiry !== undefined) changes.idExpiry = { before: existing.idExpiry?.toISOString() ?? null, after: idExpiry ?? null };

  await audit({
    user,
    action: "UPDATE",
    entity: "TRAINEE",
    entityId: id,
    entityRef: updated.refNumber,
    description: companyChanged
      ? `Changed contractor for trainee ${updated.fullName} (${updated.refNumber})`
      : `Updated trainee: ${updated.fullName}`,
    descriptionAr: companyChanged
      ? `تغيير المقاول للمتدرب ${updated.fullName} (${updated.refNumber})`
      : `تم تحديث متدرب: ${updated.fullName}`,
    req,
    oldValue: Object.keys(changes).length > 0 ? Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.before])) : null,
    newValue: Object.keys(changes).length > 0 ? Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.after])) : null,
    metadata: { changes, companyChanged },
  });

  return ok(updated);
});

export const DELETE = withModuleAction("trainees", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.trainee.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Trainee not found");

  await db.trainee.update({
    where: { id },
    data: { deletedAt: new Date(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "TRAINEE",
    entityId: id,
    entityRef: existing.refNumber,
    description: `Deleted trainee: ${existing.fullName}`,
    descriptionAr: `تم حذف متدرب: ${existing.fullName}`,
    req,
  });

  return ok({ success: true });
});
