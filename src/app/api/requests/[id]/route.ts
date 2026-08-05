// /api/requests/[id] — get / update (incl. workflow transitions) / soft-delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, audit } from "@/lib/auth/api";
import { canPerformAction } from "@/lib/auth/permissions";
import { recordStatusChange } from "@/lib/auth/audit";
import { canTransition, mergeIdAttachmentIntoDocuments, parseDocsSafe } from "../route";
import { nextRefNumber } from "@/lib/api/ref-number";
import { validateRequestForApproval, MIN_TRAINEES_PER_COURSE, MAX_TRAINEES_PER_COURSE } from "@/lib/api/request-validation";
import type { TrainingRequestStatus } from "@prisma/client";

export const GET = withModuleAction("requests", "view", async ({ params, user }) => {
  const id = params.id as string;
  const request = await db.trainingRequest.findUnique({
    where: { id },
    include: {
      company: true,
      course: true,
      requestCourses: {
        where: { deletedAt: null },
        include: {
          course: { select: { id: true, title: true, code: true, refNumber: true } },
          trainees: {
            where: { deletedAt: null },
            include: {
              trainee: {
                select: {
                  id: true, refNumber: true, fullName: true, nationalId: true,
                  nationality: true, jobTitle: true, mobile: true, email: true,
                  idAttachmentUrl: true,
                  documents: true,
                  company: { select: { id: true, name: true } },
                },
              },
            },
          },
          _count: { select: { sessions: true } },
        },
      },
      sessions: {
        where: { deletedAt: null },
        select: { id: true, refNumber: true, title: true, startDate: true, endDate: true, shift: true, status: true },
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

// PUT — update an existing request (incl. workflow transitions).
//
// RBAC strategy:
//   - Coordinators/Trainers/Super Admins hold `requests.edit` and may update any
//     request, including reviewer-side transitions (UNDER_REVIEW, APPROVED,
//     REJECTED, SCHEDULED, IN_PROGRESS, COMPLETED, REQUIRES_MODIFICATION).
//   - Contractors do NOT hold `requests.edit`. They hold `requests.view` only.
//     However, they still need to edit their own DRAFT/SUBMITTED/REJECTED
//     requests (dates, notes, trainees, priority) AND drive self-service
//     transitions (DRAFT→SUBMITTED, REJECTED→SUBMITTED, SUBMITTED→CANCELLED).
//     Without this carve-out, the contractor's edit dialog always 403s.
//
// The handler therefore requires `requests.view` (so contractors can reach the
// logic), then enforces:
//   - Coordinators/etc. (with `requests.edit`) — no extra restrictions
//   - Contractors — may only edit their own requests in DRAFT/SUBMITTED/REJECTED,
//     AND may only transition to a self-service target status. Reviewer-side
//     transitions (APPROVED, REJECTED, UNDER_REVIEW, SCHEDULED, IN_PROGRESS,
//     COMPLETED, REQUIRES_MODIFICATION) remain 403 for contractors.
export const PUT = withModuleAction("requests", "view", async ({ req, params, user }) => {
  const id = params.id as string;
  const body = await req.json().catch(() => ({}));
  const existing = await db.trainingRequest.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Request not found");

  const hasEdit = canPerformAction(user.permissions, "requests", "edit");

  // Contractors (and any other role without `requests.edit`) get the self-service
  // carve-out. Roles with `requests.edit` skip this block entirely.
  if (!hasEdit) {
    // 1. Must be the owner (company match)
    if (user.role === "CONTRACTOR" && existing.companyId !== user.companyId) {
      return fail("Forbidden — you can only edit your own company's requests", 403);
    }
    // 2. Existing status must be one of the editable self-service statuses
    if (!["DRAFT", "SUBMITTED", "REJECTED", "REQUIRES_MODIFICATION"].includes(existing.status)) {
      return fail(
        "Cannot edit a request that has already entered review",
        400,
        "REQUEST_IN_REVIEW",
      );
    }
  }

  const {
    traineeCount, preferredDateFrom, preferredDateTo,
    preferredLocation, preferredLanguage, notes, priority,
    status: newStatus, rejectionReason,
    trainees: submittedTrainees,
    additionalDocuments,
  } = body;

  // Workflow enforcement — self-service allowlist for non-edit roles.
  // Mirrors SELF_SERVICE_TRANSITIONS in /api/requests/[id]/transition.
  if (!hasEdit && newStatus && newStatus !== existing.status) {
    const SELF_SERVICE_TRANSITIONS: Record<string, string[]> = {
      DRAFT: ["SUBMITTED", "CANCELLED"],
      // SUBMITTED: no self-service actions — request is in coordinator's hands
      REJECTED: ["SUBMITTED"],
      REQUIRES_MODIFICATION: ["SUBMITTED"],
    };
    const allowed = SELF_SERVICE_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(newStatus)) {
      return fail(
        `Forbidden — ${existing.status} → ${newStatus} requires the requests.edit permission`,
        403,
        "FORBIDDEN_TRANSITION",
        { from: existing.status, to: newStatus, allowed }
      );
    }
  }

  // Workflow enforcement — transition must be valid per the global state machine
  if (newStatus && newStatus !== existing.status) {
    if (!canTransition(existing.status as TrainingRequestStatus, newStatus as TrainingRequestStatus)) {
      return fail(
        `Invalid status transition: ${existing.status} → ${newStatus}`,
        400,
        "INVALID_TRANSITION",
        { from: existing.status, to: newStatus }
      );
    }

    // Business rule: block APPROVED transition if any course fails min/max trainees validation
    if (newStatus === "APPROVED") {
      const validation = await validateRequestForApproval(id);
      if (!validation.valid) {
        return fail(
          `Cannot approve: ${validation.failingCourses.length} course(s) fail the trainee count rule (min ${MIN_TRAINEES_PER_COURSE}, max ${MAX_TRAINEES_PER_COURSE})`,
          422,
          "APPROVAL_VALIDATION_FAILED",
          {
            failingCourses: validation.failingCourses,
            totalTrainees: validation.totalTrainees,
            rule: { min: MIN_TRAINEES_PER_COURSE, max: MAX_TRAINEES_PER_COURSE },
          }
        );
      }
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

  // ── Persist additional documents (request-level) ──
  // Mirrors the POST handler: store as JSON string on TrainingRequest.documents.
  if (Array.isArray(additionalDocuments)) {
    await db.trainingRequest.update({
      where: { id },
      data: {
        documents: additionalDocuments.length > 0
          ? JSON.stringify(additionalDocuments)
          : null,
      },
    });
  }

  // ── Persist trainees + their documents ──
  // Mirrors the POST handler's merge logic: reuse existing Trainee rows by
  // (companyId, nationalId), merge documents by URL, update scalar fields.
  if (Array.isArray(submittedTrainees) && submittedTrainees.length > 0) {
    // Ensure a TrainingRequestCourse row exists for this request
    let rc = await db.trainingRequestCourse.findFirst({
      where: { requestId: id, deletedAt: null },
    });
    if (!rc) {
      rc = await db.trainingRequestCourse.create({
        data: {
          id: crypto.randomUUID(),
          requestId: id,
          courseId: existing.courseId ?? "",
          traineeCount: submittedTrainees.length,
          createdBy: user.id,
          updatedBy: user.id,
          updatedAt: now,
        },
      });
    }

    for (const t of submittedTrainees) {
      if (!t.fullName || !t.nationalId) continue;
      const existing_tn = await db.trainee.findFirst({
        where: { companyId: existing.companyId, nationalId: t.nationalId, deletedAt: null },
      });
      const incomingDocs = Array.isArray(t.documents) ? t.documents : [];
      const existingDocs = existing_tn ? parseDocsSafe(existing_tn.documents) : [];
      const mergedDocs = mergeIdAttachmentIntoDocuments(
        incomingDocs,
        existingDocs,
        (t.idAttachmentUrl as string) ?? null,
      );
      const documentsJson = mergedDocs.length > 0 ? JSON.stringify(mergedDocs) : (existing_tn ? existing_tn.documents : null);

      const trainee = existing_tn
        ? await db.trainee.update({
            where: { id: existing_tn.id },
            data: {
              fullName: t.fullName,
              nationality: t.nationality ?? existing_tn.nationality,
              jobTitle: t.jobTitle ?? existing_tn.jobTitle,
              documents: documentsJson,
              updatedAt: now,
              updatedBy: user.id,
            },
          })
        : await db.trainee.create({
            data: {
              id: crypto.randomUUID(),
              refNumber: await nextRefNumber("TRAINEE"),
              fullName: t.fullName,
              nationalId: t.nationalId,
              nationality: t.nationality ?? null,
              jobTitle: t.jobTitle ?? null,
              companyId: existing.companyId,
              documents: documentsJson,
              createdBy: user.id,
              updatedBy: user.id,
              updatedAt: now,
            },
          });

      await db.trainingRequestCourseTrainee.create({
        data: {
          id: crypto.randomUUID(),
          requestCourseId: rc.id,
          traineeId: trainee.id,
          createdBy: user.id,
          updatedBy: user.id,
          updatedAt: now,
        },
      }).catch(() => { /* unique constraint — link already exists */ });
    }
  }

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

  // ── Notify coordinators when a contractor submits / resubmits via PUT ──
  if (newStatus === "SUBMITTED" && existing.status !== "SUBMITTED") {
    const coordinators = await db.user.findMany({
      where: { role: "COORDINATOR", isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (coordinators.length > 0) {
      const isResubmit = existing.status === "REJECTED";
      const notifNow = new Date();
      await db.notification.createMany({
        data: coordinators.map((c) => ({
          id: crypto.randomUUID(),
          userId: c.id,
          title: isResubmit ? "Request Resubmitted for Review" : "New Training Request Submitted",
          titleAr: isResubmit ? "تمت إعادة إرسال طلب للمراجعة" : "طلب تدريب جديد",
          message: `Training request ${existing.refNumber} has been ${isResubmit ? "resubmitted" : "submitted"} and is awaiting your review.`,
          messageAr: `تم ${isResubmit ? "إعادة إرسال" : "إرسال"} طلب التدريب ${existing.refNumber} وهو بانتظار المراجعة.`,
          type: "INFO",
          category: "TRAINING",
          updatedAt: notifNow,
        })),
      });
    }
  }

  return ok(updated);
});

export const DELETE = withModuleAction("requests", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.trainingRequest.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return notFound("Request not found");

  // Only allow deletion of DRAFT or CANCELLED requests
  if (!["DRAFT", "CANCELLED"].includes(existing.status)) {
    return fail("Cannot delete a request in progress. Cancel it first.", 400);
  }

  // Soft delete the request and all its courses
  await db.$transaction([
    db.trainingRequest.update({
      where: { id },
      data: { deletedAt: new Date(), updatedBy: user.id },
    }),
    db.trainingRequestCourse.updateMany({
      where: { requestId: id, deletedAt: null },
      data: { deletedAt: new Date(), updatedBy: user.id },
    }),
  ]);

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
