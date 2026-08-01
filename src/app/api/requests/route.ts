// /api/training-requests — list + create
// Workflow: DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED → SCHEDULED → IN_PROGRESS → COMPLETED | CANCELLED | REJECTED
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { nextRefNumber } from "@/lib/api/ref-number";
import { list } from "@/lib/api/response";
import type { TrainingRequestStatus } from "@prisma/client";

const ALLOWED_SORT_FIELDS = ["refNumber", "createdAt", "updatedAt", "status", "priority", "traineeCount"];

// Valid status transitions (workflow enforcement)
const VALID_TRANSITIONS: Record<TrainingRequestStatus, TrainingRequestStatus[]> = {
  DRAFT: ["SUBMITTED", "CANCELLED"],
  SUBMITTED: ["UNDER_REVIEW", "CANCELLED"],
  UNDER_REVIEW: ["APPROVED", "REJECTED", "CANCELLED"],
  APPROVED: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  REJECTED: ["SUBMITTED"], // allow re-submission
};

export function canTransition(from: TrainingRequestStatus, to: TrainingRequestStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export const GET = withModuleAction("requests", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { refNumber: { contains: q.search } },
      { notes: { contains: q.search } },
    ];
  }
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.priority) where.priority = q.filters.priority;
  if (q.filters.companyId) where.companyId = q.filters.companyId;
  if (q.filters.courseId) where.courseId = q.filters.courseId;

  // Contractors see only their own requests
  if (user.role === "CONTRACTOR" && user.companyId) {
    where.companyId = user.companyId;
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS);

  const [rows, total] = await Promise.all([
    db.trainingRequest.findMany({
      where,
      include: {
        company: { select: { id: true, name: true, refNumber: true } },
        course: { select: { id: true, title: true, code: true, refNumber: true } },
        sessions: { select: { id: true, refNumber: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.trainingRequest.count({ where }),
  ]);

  return list(
    rows.map((r) => ({
      id: r.id,
      refNumber: r.refNumber,
      companyId: r.companyId,
      companyName: r.company?.name ?? null,
      companyRef: r.company?.refNumber ?? null,
      courseId: r.courseId,
      courseTitle: r.course?.title ?? null,
      courseCode: r.course?.code ?? null,
      courseRef: r.course?.refNumber ?? null,
      traineeCount: r.traineeCount,
      preferredDateFrom: r.preferredDateFrom,
      preferredDateTo: r.preferredDateTo,
      preferredLocation: r.preferredLocation,
      preferredLanguage: r.preferredLanguage,
      notes: r.notes,
      status: r.status,
      priority: r.priority,
      rejectionReason: r.rejectionReason,
      approvedAt: r.approvedAt,
      approvedBy: r.approvedBy,
      submittedAt: r.submittedAt,
      reviewedAt: r.reviewedAt,
      scheduledAt: r.scheduledAt,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      cancelledAt: r.cancelledAt,
      rejectedAt: r.rejectedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      sessionId: r.sessions?.[0]?.id ?? null,
      sessionRef: r.sessions?.[0]?.refNumber ?? null,
    })),
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("requests", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const {
    companyId, courseId, traineeCount, preferredDateFrom, preferredDateTo,
    preferredLocation, preferredLanguage, notes, priority,
    status: requestedStatus,
  } = body;

  // Contractors auto-create their own company's request
  const finalCompanyId = user.role === "CONTRACTOR" && user.companyId ? user.companyId : companyId;

  if (!finalCompanyId || !courseId) return fail("companyId and courseId are required", 422, "VALIDATION_ERROR");

  const [company, course] = await Promise.all([
    db.company.findFirst({ where: { id: finalCompanyId, deletedAt: null } }),
    db.course.findFirst({ where: { id: courseId, deletedAt: null } }),
  ]);
  if (!company) return fail("Company not found", 404);
  if (!course) return fail("Course not found", 404);

  // Initial status: DRAFT unless explicitly set to SUBMITTED
  const initialStatus: TrainingRequestStatus =
    requestedStatus === "SUBMITTED" ? "SUBMITTED" : "DRAFT";

  const refNumber = await nextRefNumber("TRAINING_REQUEST");

  const now = new Date();
  const request = await db.trainingRequest.create({
    data: {
      refNumber,
      companyId: finalCompanyId,
      courseId,
      requestedBy: user.id,
      traineeCount: traineeCount ?? 1,
      preferredDateFrom: preferredDateFrom ? new Date(preferredDateFrom) : null,
      preferredDateTo: preferredDateTo ? new Date(preferredDateTo) : null,
      preferredLocation: preferredLocation ?? null,
      preferredLanguage: preferredLanguage ?? null,
      notes: notes ?? null,
      status: initialStatus,
      priority: priority ?? "NORMAL",
      ...(initialStatus === "SUBMITTED" && { submittedAt: now }),
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "REQUEST",
    entityId: request.id,
    entityRef: request.refNumber,
    description: `Created training request ${request.refNumber} for ${company.name} - ${course.title}`,
    descriptionAr: `تم إنشاء طلب تدريب ${request.refNumber} لـ ${company.name} - ${course.title}`,
    req,
    metadata: { initialStatus },
  });

  return created(request);
});
