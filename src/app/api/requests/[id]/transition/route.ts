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

  // ── Read-only roles (AUDITOR, VIEWER) must not mutate anything ────────
  // They have `requests.view` but are documented as strictly read-only.
  // The self-service path below is for contractors only; the full-workflow
  // path requires `requests.edit` which read-only roles do not have.
  if (user.role === "AUDITOR" || user.role === "VIEWER") {
    return fail("Forbidden — read-only roles cannot transition request status", 403, "FORBIDDEN");
  }

  // A contractor may only touch their own company's requests.
  if (user.role === "CONTRACTOR" && existing.companyId !== user.companyId) {
    return fail("Forbidden", 403);
  }

  // Callers who can edit requests outright are not restricted to the self-service
  // subset — they can drive the full workflow through this endpoint too.
  // This covers COORDINATOR, SUPER_ADMIN, COMPANY_ADMIN, TRAINER.
  const hasEdit = canPerformAction(user.permissions, "requests", "edit");
  if (!hasEdit) {
    // Only contractors reach here (read-only roles were blocked above).
    // Contractors are restricted to the self-service subset.
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
  }
  if (to === "CANCELLED") updates.cancelledAt = now;

  const updated = await db.trainingRequest.update({ where: { id }, data: updates });

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
