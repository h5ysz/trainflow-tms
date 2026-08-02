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
  UNDER_REVIEW: ["APPROVED", "REJECTED", "REQUIRES_MODIFICATION", "CANCELLED"],
  REQUIRES_MODIFICATION: ["SUBMITTED", "CANCELLED"],
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
    // ── New: trainee list (Manual/Copy-Paste/Excel import) ──
    // Each item is the client-side TraineeEntry: { fullName, nationalId, nationality?, jobTitle?, documents? }
    trainees,
    // ── New: request-level additional documents metadata ──
    // Each item is { url, filename, type, uploadedAt } — files were already
    // POSTed to /api/requests/upload-doc by the time this runs.
    additionalDocuments,
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

  // Compute traineeCount from the trainees array if provided (overrides integer)
  const submittedTrainees: Array<{
    fullName: string;
    nationalId: string;
    nationality?: string | null;
    jobTitle?: string | null;
    mobile?: string | null;
    email?: string | null;
    documents?: unknown[];
  }> = Array.isArray(trainees) ? trainees : [];
  const effectiveTraineeCount = submittedTrainees.length > 0 ? submittedTrainees.length : (traineeCount ?? 1);

  const now = new Date();
  const request = await db.trainingRequest.create({
    data: {
      id: crypto.randomUUID(),
      refNumber,
      companyId: finalCompanyId,
      courseId,
      requestedBy: user.id,
      traineeCount: effectiveTraineeCount,
      preferredDateFrom: preferredDateFrom ? new Date(preferredDateFrom) : null,
      preferredDateTo: preferredDateTo ? new Date(preferredDateTo) : null,
      preferredLocation: preferredLocation ?? null,
      preferredLanguage: preferredLanguage ?? null,
      notes: notes ?? null,
      // Persist additional request-level documents as JSON (or null if none).
      documents: Array.isArray(additionalDocuments) && additionalDocuments.length > 0
        ? JSON.stringify(additionalDocuments)
        : null,
      status: initialStatus,
      priority: priority ?? "NORMAL",
      ...(initialStatus === "SUBMITTED" && { submittedAt: now }),
      createdBy: user.id,
      updatedBy: user.id,
      updatedAt: now,
    },
  });

  // ── Create the TrainingRequestCourse + Trainees ──
  // Even when no trainees were provided we still create the course-in-request
  // row — the existing review/approval UI expects at least one.
  if (submittedTrainees.length > 0 || courseId) {
    const rc = await db.trainingRequestCourse.create({
      data: {
        id: crypto.randomUUID(),
        requestId: request.id,
        courseId,
        traineeCount: submittedTrainees.length,
        createdBy: user.id,
        updatedBy: user.id,
        updatedAt: now,
      },
    });

    for (const t of submittedTrainees) {
      // Basic validation — skip empty rows silently (client should already filter).
      if (!t.fullName || !t.nationalId) continue;

      // Reuse an existing Trainee row for the same company + nationalId when
      // possible (common case when re-importing the same Excel sheet). This
      // preserves historical document attachments across re-submissions.
      const existing = await db.trainee.findFirst({
        where: { companyId: finalCompanyId, nationalId: t.nationalId, deletedAt: null },
      });
      const trainee = existing
        ? await db.trainee.update({
            where: { id: existing.id },
            data: {
              fullName: t.fullName,
              nationality: t.nationality ?? existing.nationality,
              jobTitle: t.jobTitle ?? existing.jobTitle,
              mobile: t.mobile ?? existing.mobile,
              email: t.email ?? existing.email,
              updatedAt: now,
              updatedBy: user.id,
              // Merge documents: keep existing ones, add any new ones from the
              // payload that aren't already present (matched by url).
              documents: JSON.stringify(mergeDocuments(
                parseDocsSafe(existing.documents),
                Array.isArray(t.documents) ? t.documents as never[] : [],
              )),
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
              mobile: t.mobile ?? null,
              email: t.email ?? null,
              companyId: finalCompanyId,
              documents: Array.isArray(t.documents) && t.documents.length > 0
                ? JSON.stringify(t.documents)
                : null,
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
      }).catch(() => {
        // Unique constraint violation: same trainee already linked to this course-in-request.
        // Safe to ignore — the link already exists.
      });
    }
  }

  await audit({
    user,
    action: "CREATE",
    entity: "REQUEST",
    entityId: request.id,
    entityRef: request.refNumber,
    description: `Created training request ${request.refNumber} for ${company.name} - ${course.title}`,
    descriptionAr: `تم إنشاء طلب تدريب ${request.refNumber} لـ ${company.name} - ${course.title}`,
    req,
    metadata: { initialStatus, traineeCount: effectiveTraineeCount, additionalDocs: Array.isArray(additionalDocuments) ? additionalDocuments.length : 0 },
  });

  return created(request);
});

// ── Helpers for the trainees[] merge logic ───────────────────────────────────

function parseDocsSafe(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function mergeDocuments(existing: unknown[], incoming: unknown[]): unknown[] {
  if (incoming.length === 0) return existing;
  const byUrl = new Map<string, unknown>();
  for (const d of existing) {
    if (d && typeof (d as { url?: string }).url === "string") {
      byUrl.set((d as { url: string }).url, d);
    }
  }
  for (const d of incoming) {
    if (d && typeof (d as { url?: string }).url === "string") {
      byUrl.set((d as { url: string }).url, d);
    }
  }
  return Array.from(byUrl.values());
}
