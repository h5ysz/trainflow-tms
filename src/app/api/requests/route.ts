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
  CLOSED: [], // terminal — the official retest failed; a new request is required
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
    idAttachmentUrl?: string | null;
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
      // ── Phase 1: documents[] is the single source of truth ──
      // The legacy `idAttachmentUrl` column is no longer written. Any
      // incoming `t.idAttachmentUrl` value is folded into `documents[]`
      // as a `{type:"id"}` entry (if that URL isn't already present),
      // so legacy clients/scripts that still send the field don't lose
      // data. New uploads always arrive in `t.documents[]` directly.
      const incomingDocs = Array.isArray(t.documents) ? t.documents : [];
      const existingDocs = existing ? parseDocsSafe(existing.documents) : [];
      const mergedDocs = mergeIdAttachmentIntoDocuments(
        incomingDocs,
        existingDocs,
        (t.idAttachmentUrl as string) ?? null,
      );
      const documentsJson = mergedDocs.length > 0 ? JSON.stringify(mergedDocs) : (existing ? existing.documents : null);

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
              // ── documents[] is the ONLY attachment store ──
              // We no longer write to `idAttachmentUrl`. The column is
              // left untouched (whatever value was there stays) but is
              // ignored by all read paths after Phase 3.
              documents: documentsJson,
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
              // ── documents[] is the ONLY attachment store ──
              // No `idAttachmentUrl` write — left null on new rows.
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

  // ── Notify coordinators when a new request is submitted (not draft) ──
  if (initialStatus === "SUBMITTED") {
    const coordinators = await db.user.findMany({
      where: { role: "COORDINATOR", isActive: true, deletedAt: null },
      select: { id: true },
    });
    if (coordinators.length > 0) {
      const notifNow = new Date();
      await db.notification.createMany({
        data: coordinators.map((c) => ({
          id: crypto.randomUUID(),
          userId: c.id,
          title: "New Training Request Submitted",
          titleAr: "طلب تدريب جديد",
          message: `Training request ${request.refNumber} has been submitted and is awaiting your review.`,
          messageAr: `تم إرسال طلب التدريب ${request.refNumber} وهو بانتظار المراجعة.`,
          type: "INFO",
          category: "TRAINING",
          updatedAt: notifNow,
        })),
      });
    }
  }

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

// Phase 1 — single source of truth: documents[]
//
// Fold any legacy `idAttachmentUrl` value into the documents array as a
// `{type:"id"}` entry. Skip if the URL is already present in either the
// incoming or existing documents array (prevents duplicates). The result
// is the canonical documents[] we persist to the Trainee row.
//
// This is the ONLY place where idAttachmentUrl is converted — every other
// code path treats documents[] as the source of truth.
function mergeIdAttachmentIntoDocuments(
  incomingDocs: unknown[],
  existingDocs: unknown[],
  idAttachmentUrl: string | null,
): unknown[] {
  // Start with existing, overlay incoming (by URL).
  const merged = mergeDocuments(existingDocs, incomingDocs);
  if (!idAttachmentUrl) return merged;

  // Check if the idAttachmentUrl is already represented in the merged set.
  const alreadyPresent = merged.some(
    (d) => d && typeof (d as { url?: string }).url === "string" && (d as { url: string }).url === idAttachmentUrl,
  );
  if (alreadyPresent) return merged;

  // Otherwise, add it as a synthetic "id"-type document so the URL is
  // preserved in documents[] going forward.
  merged.push({
    url: idAttachmentUrl,
    filename: idAttachmentUrl.split("/").pop() ?? "id-attachment",
    type: "id",
    uploadedAt: new Date().toISOString(),
  });
  return merged;
}
