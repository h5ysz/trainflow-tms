// /api/requests/[id] — get / update / approve / reject / delete
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail, auditLog } from "@/lib/auth/api";

export const GET = withModuleAction("requests", "view", async ({ params, user }) => {
  const id = params.id as string;
  const request = await db.trainingRequest.findUnique({
    where: { id },
    include: {
      company: true,
      course: true,
      session: {
        include: {
          trainer: { select: { id: true, fullName: true } },
        },
      },
    },
  });
  if (!request) return notFound("Request not found");

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
  if (!existing) return notFound("Request not found");

  // Contractors can edit only their own PENDING requests
  if (user.role === "CONTRACTOR") {
    if (existing.companyId !== user.companyId) return fail("Forbidden", 403);
    if (existing.status !== "PENDING") return fail("Cannot edit a non-pending request", 400);
  }

  const {
    traineeCount, preferredDateFrom, preferredDateTo,
    preferredLocation, preferredLanguage, notes, priority, status,
    rejectionReason,
  } = body;

  const isApprovalAction = status === "APPROVED" || status === "REJECTED";
  const updated = await db.trainingRequest.update({
    where: { id },
    data: {
      ...(traineeCount !== undefined && { traineeCount }),
      ...(preferredDateFrom !== undefined && { preferredDateFrom: preferredDateFrom ? new Date(preferredDateFrom) : null }),
      ...(preferredDateTo !== undefined && { preferredDateTo: preferredDateTo ? new Date(preferredDateTo) : null }),
      ...(preferredLocation !== undefined && { preferredLocation }),
      ...(preferredLanguage !== undefined && { preferredLanguage }),
      ...(notes !== undefined && { notes }),
      ...(priority !== undefined && { priority }),
      ...(status !== undefined && {
        status,
        ...(isApprovalAction && {
          approvedAt: new Date(),
          approvedBy: user.id,
        }),
      }),
      ...(rejectionReason !== undefined && { rejectionReason }),
    },
  });

  await auditLog({
    userId: user.id,
    action: isApprovalAction ? (status === "APPROVED" ? "APPROVE" : "REJECT") : "UPDATE",
    entity: "REQUEST",
    entityId: id,
    description: `${isApprovalAction ? (status === "APPROVED" ? "Approved" : "Rejected") : "Updated"} request ${existing.requestNumber}`,
    req,
  });

  return ok(updated);
});

export const DELETE = withModuleAction("requests", "delete", async ({ params, user, req }) => {
  const id = params.id as string;
  const existing = await db.trainingRequest.findUnique({ where: { id } });
  if (!existing) return notFound("Request not found");

  if (existing.sessionId) {
    return fail("Cannot delete a request already linked to a session", 400);
  }

  await db.trainingRequest.delete({ where: { id } });
  await auditLog({
    userId: user.id,
    action: "DELETE",
    entity: "REQUEST",
    entityId: id,
    description: `Deleted request ${existing.requestNumber}`,
    req,
  });

  return ok({ success: true });
});
