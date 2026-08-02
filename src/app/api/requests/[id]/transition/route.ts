// /api/requests/[id]/transition — advance a request's own workflow status
//
// Separate from PUT /api/requests/[id], which requires `requests.edit`. A contractor
// holds only `requests.view` and `requests.create`, so submitting or cancelling their
// own draft — the primary contractor workflow — was rejected with a 403 while the UI
// still offered the button.
//
// This endpoint deliberately exposes a *narrow* set of transitions that a requester may
// perform on their own request. Everything reviewer-side (UNDER_REVIEW, APPROVED,
// REJECTED, SCHEDULED, …) still requires `requests.edit` via the PUT handler.
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { canPerformAction } from "@/lib/auth/permissions";
import { recordStatusChange } from "@/lib/auth/audit";
import { canTransition } from "../../route";
import { randomUUID } from "node:crypto";
import type { TrainingRequestStatus } from "@prisma/client";

// Transitions a requester may make on their own request, keyed by current status.
const SELF_SERVICE_TRANSITIONS: Record<string, TrainingRequestStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["CANCELLED"],
  REJECTED: ["SUBMITTED"],
};

export const POST = withModuleAction("requests", "view", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const to = body.status as TrainingRequestStatus | undefined;

  if (!to) return fail("status is required", 422, "VALIDATION_ERROR");

  const existing = await db.trainingRequest.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Request not found");

  // A contractor may only touch their own company's requests.
  if (user.role === "CONTRACTOR" && existing.companyId !== user.companyId) {
    return fail("Forbidden", 403);
  }

  // Callers who can edit requests outright are not restricted to the self-service
  // subset — they can drive the full workflow through this endpoint too.
  const hasEdit = canPerformAction(user.permissions, "requests", "edit");
  if (!hasEdit) {
    const allowed = SELF_SERVICE_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(to)) {
      return fail(
        `Forbidden — ${existing.status} → ${to} requires the requests.edit permission`,
        403,
        "FORBIDDEN_TRANSITION",
        { from: existing.status, to, allowed }
      );
    }
  }

  if (!canTransition(existing.status as TrainingRequestStatus, to)) {
    return fail(
      `Invalid status transition: ${existing.status} → ${to}`,
      400,
      "INVALID_TRANSITION",
      { from: existing.status, to }
    );
  }

  const now = new Date();
  const updates: Record<string, unknown> = { status: to, updatedBy: user.id };
  if (to === "SUBMITTED") {
    updates.submittedAt = now;
    // Resubmitting after a rejection clears the previous rejection.
    if (existing.status === "REJECTED") {
      updates.rejectedAt = null;
      updates.rejectionReason = null;
    }
    // Resubmitting after REQUIRES_MODIFICATION clears the revision reason.
    if (existing.status === "REQUIRES_MODIFICATION") {
      updates.rejectionReason = null;
    }
  }
  if (to === "REQUIRES_MODIFICATION") {
    updates.reviewedAt = now;
  }
  if (to === "CANCELLED") updates.cancelledAt = now;

  // Capture the reason for REQUIRES_MODIFICATION (passed in the body)
  if (to === "REQUIRES_MODIFICATION" && body.revisionReason) {
    updates.rejectionReason = body.revisionReason;
  }

  const updated = await db.trainingRequest.update({ where: { id }, data: updates });

  // ── Notify contractor when request is returned for revision ─────────────
  if (to === "REQUIRES_MODIFICATION" && existing.companyId) {
    const contractors = await db.user.findMany({
      where: { role: "CONTRACTOR", companyId: existing.companyId, isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (contractors.length > 0) {
      await db.notification.createMany({
        data: contractors.map((c) => ({
          id: randomUUID(),
          userId: c.id,
          title: "Request Returned for Revision",
          titleAr: "تم إرجاع الطلب للتعديل",
          message: `Training request ${existing.refNumber} has been returned for revision. ${body.revisionReason ? `Reason: ${body.revisionReason}` : "Please review and resubmit."}`,
          messageAr: `تم إرجاع طلب التدريب ${existing.refNumber} للتعديل. ${body.revisionReason ? `السبب: ${body.revisionReason}` : "يرجى المراجعة وإعادة الإرسال."}`,
          type: "WARNING",
          category: "TRAINING",
          updatedAt: now,
        })),
      });
    }
  }

  await recordStatusChange({
    user,
    entity: "REQUEST",
    entityId: id,
    entityRef: existing.refNumber,
    fromStatus: existing.status,
    toStatus: to,
    req,
  });

  return ok(updated);
});
