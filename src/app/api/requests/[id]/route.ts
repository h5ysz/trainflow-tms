// /api/requests/[id] — get / update (incl. workflow transitions) / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { recordStatusChange } from "@/lib/auth/audit";
import { canTransition } from "../route";
import type { TrainingRequestStatus } from "@prisma/client";

export const GET = withModuleAction("requests", "view", async ({ params, user }) => {
  const id = params.id as string;
  const request = await db.trainingRequest.findUnique({
    where: { id },
    include: {
      company: true,
      course: true,
      session: {
        include: { trainer: { select: { id: true, fullName: true, refNumber: true } } },
      },
    },
  });
  if (!request || request.deletedAt) return notFound("Request not found");

  // RBAC: contractor sees only their own
  if (user.role === "CONTRACTOR" && user.companyId !== request.companyId) {
    return fail("Forbidden", 403);
  }

  return ok(request);
});

export const PUT = withModuleAction("requests", "edit", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.trainingRequest.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Request not found");

  // Contractors can edit only their own DRAFT/SUBMITTED requests
  if (user.role === "CONTRACTOR") {
    if (existing.companyId !== user.companyId) return fail("Forbidden", 403);
    if (!["DRAFT", "SUBMITTED", "REJECTED"].includes(existing.status)) {
      return fail("Cannot edit a request that has already entered review", 400);
    }
  }

  const {
    traineeCount, preferredDateFrom, preferredDateTo,
    preferredLocation, preferredLanguage, notes, priority,
    status: newStatus, rejectionReason,
  } = body;

  // Workflow enforcement
  if (newStatus && newStatus !== existing.status) {
    if (!canTransition(existing.status as TrainingRequestStatus, newStatus as TrainingRequestStatus)) {
      return fail(
        `Invalid status transition: ${existing.status} → ${newStatus}`,
        400,
        "INVALID_TRANSITION",
        { from: existing.status, to: newStatus }
      );
    }
  }

  const now = new Date();
  const updates: Record<string, unknown> = {
    updatedBy: user.id,
  };

  if (traineeCount !== undefined) updates.traineeCount = traineeCount;
  if (preferredDateFrom !== undefined) updates.preferredDateFrom = preferredDateFrom ? new Date(preferredDateFrom) : null;
  if (preferredDateTo !== undefined) updates.preferredDateTo = preferredDateTo ? new Date(preferredDateTo) : null;
  if (preferredLocation !== undefined) updates.preferredLocation = preferredLocation;
  if (preferredLanguage !== undefined) updates.preferredLanguage = preferredLanguage;
  if (notes !== undefined) updates.notes = notes;
  if (priority !== undefined) updates.priority = priority;

  // Workflow timestamps
  if (newStatus === "SUBMITTED") {
    updates.submittedAt = now;
    if (existing.status === "REJECTED") updates.rejectedAt = null; // reset rejection on resubmit
  }
  if (newStatus === "UNDER_REVIEW") updates.reviewedAt = now;
  if (newStatus === "APPROVED") {
    updates.approvedAt = now;
    updates.approvedBy = user.id;
  }
  if (newStatus === "SCHEDULED") updates.scheduledAt = now;
  if (newStatus === "IN_PROGRESS") updates.startedAt = now;
  if (newStatus === "COMPLETED") updates.completedAt = now;
  if (newStatus === "CANCELLED") updates.cancelledAt = now;
  if (newStatus === "REJECTED") {
    updates.rejectedAt = now;
    updates.rejectionReason = rejectionReason ?? null;
  }
  if (newStatus !== undefined) updates.status = newStatus;

  const updated = await db.trainingRequest.update({
    where: { id },
    data: updates,
  });

  // Status change audit
  if (newStatus && newStatus !== existing.status) {
    await recordStatusChange({
      user,
      entity: "REQUEST",
      entityId: id,
      entityRef: existing.refNumber,
      fromStatus: existing.status,
      toStatus: newStatus,
      req,
    });
  }

  // Update audit (for non-status edits)
  if (!newStatus) {
    await audit({
      user,
      action: "UPDATE",
      entity: "REQUEST",
      entityId: id,
      entityRef: existing.refNumber,
      description: `Updated request ${existing.refNumber}`,
      descriptionAr: `تم تحديث طلب ${existing.refNumber}`,
      req,
      metadata: { before: existing, after: updated },
    });
  }

  return ok(updated);
});

export const DELETE = withModuleAction("requests", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.trainingRequest.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Request not found");

  if (existing.sessionId) {
    return fail("Cannot delete a request already linked to a session", 400);
  }

  // Only allow deletion of DRAFT or CANCELLED requests
  if (!["DRAFT", "CANCELLED"].includes(existing.status)) {
    return fail("Cannot delete a request in progress. Cancel it first.", 400);
  }

  await db.trainingRequest.update({
    where: { id },
    data: { deletedAt: now(), updatedBy: user.id },
  });

  await audit({
    user,
    action: "DELETE",
    entity: "REQUEST",
    entityId: id,
    entityRef: existing.refNumber,
    description: `Deleted request ${existing.refNumber}`,
    descriptionAr: `تم حذف طلب ${existing.refNumber}`,
    req,
  });

  return ok({ success: true });
});

function now() { return new Date(); }
