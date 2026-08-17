// GCCLAB TMS — Trainer Claim service
// =====================================================================
// Orchestrates the claim lifecycle. Training Sessions are the single source of
// truth — generation reads sessions directly and stores per-item snapshots, so
// an approved claim never changes when sessions/courses/settings are edited
// later. Every workflow transition and every manual adjustment is audited
// (global AuditLog) and recorded on the claim's own `history` JSON.
//
// Workflow: DRAFT → GENERATED (auto) → SUBMITTED (trainer) → LINE_MANAGER_REVIEW
//           → QHSE_REVIEW → HR_REVIEW → APPROVED → FINAL. Trainer may adjust
//           items only in GENERATED/RETURNED.

import { db } from "@/lib/db";
import { ApiError } from "@/lib/auth/api";
import { recordAudit } from "@/lib/auth/audit";
import { nextRefNumber } from "@/lib/api/ref-number";
import { randomUUID } from "node:crypto";
import { getClaimConfig, ensureDefaultClaimSettings, type ClaimConfig } from "./config";
import {
  computeClaim,
  type ClaimConfigInput,
  type ClaimSessionInput,
  type ClaimType,
  type EngagementType,
} from "./engine";

export const CLAIM_TYPES: ClaimType[] = ["OVERTIME", "BUSINESS_MISSION"];

export type ClaimStatus = "DRAFT" | "GENERATED" | "SUBMITTED" | "PENDING_COORDINATOR_APPROVAL" | "RETURNED" | "REJECTED" | "LINE_MANAGER_REVIEW" | "QHSE_REVIEW" | "HR_REVIEW" | "APPROVED" | "FINAL";
export const CLAIM_STATUSES: ClaimStatus[] = ["DRAFT", "GENERATED", "SUBMITTED", "PENDING_COORDINATOR_APPROVAL", "RETURNED", "REJECTED", "LINE_MANAGER_REVIEW", "QHSE_REVIEW", "HR_REVIEW", "APPROVED", "FINAL"];

// Statuses a trainer may edit items in; everything later is locked.
const EDITABLE_STATUSES = new Set<ClaimStatus>(["GENERATED", "RETURNED"]);
const GENERATABLE_STATUSES = new Set<ClaimStatus>(["DRAFT", "GENERATED", "RETURNED"]);

interface HistoryEntry {
  at: string;
  by: string;
  byId: string;
  action: string;
  detail?: string;
}

function appendHistory(existing: string | null, entry: HistoryEntry): string {
  const list: HistoryEntry[] = existing ? (JSON.parse(existing) as HistoryEntry[]) : [];
  list.push(entry);
  return JSON.stringify(list);
}

function parsePeriod(fromRaw: string, toRaw: string): { from: Date; to: Date } {
  const from = new Date(fromRaw);
  const to = new Date(toRaw);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ApiError(422, "Valid periodFrom and periodTo dates are required", "VALIDATION_ERROR");
  }
  if (from.getTime() > to.getTime()) {
    throw new ApiError(422, "periodFrom must be on or before periodTo", "VALIDATION_ERROR");
  }
  return { from, to };
}

function toSessionInput(session: {
  id: string;
  course?: { code: string | null; title: string | null } | null;
  city: string | null;
  location: string | null;
  shift: string | null;
  durationHours: number;
  startDate: Date;
  endDate: Date;
}): ClaimSessionInput {
  return {
    id: session.id,
    courseCode: session.course?.code ?? null,
    courseTitle: session.course?.title ?? null,
    city: session.city,
    location: session.location,
    shift: session.shift,
    durationHours: session.durationHours,
    startDate: session.startDate,
    endDate: session.endDate,
  };
}

const sessionInclude = {
  course: { select: { id: true, code: true, title: true } },
  trainer: { select: { id: true, nameEn: true, nameAr: true } },
  request: { select: { coordinator: { select: { id: true, fullName: true } } } },
} as const;

export type ClaimWithRelations = NonNullable<Awaited<ReturnType<typeof loadClaim>>>;

export async function loadClaim(id: string, includeDeleted = false) {
  return db.trainerClaim.findUnique({
    where: { id },
    include: {
      trainer: { select: { id: true, nameEn: true, nameAr: true, refNumber: true, engagementType: true } },
      coordinator: { select: { id: true, fullName: true } },
      items: {
        orderBy: [{ date: "asc" }, { updatedAt: "asc" }],
        include: {
          session: {
            select: {
              id: true,
              refNumber: true,
              startDate: true,
              endDate: true,
              // Display-only metadata for the review table (not part of the
              // approved-value snapshot).
              request: { select: { coordinator: { select: { id: true, fullName: true } } } },
            },
          },
        },
      },
    },
  });
}

function assertNotDeleted(claim: ClaimWithRelations | null): ClaimWithRelations {
  if (!claim || claim.deletedAt) throw new ApiError(404, "Claim not found");
  return claim;
}

// ─────────────────────────────────────────────────────────────────────────────
// CREATE + GENERATE
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateClaimInput {
  claimType: ClaimType;
  trainerId: string;
  coordinatorId?: string | null;
  engagementType?: string | null;
  periodFrom: string;
  periodTo: string;
  notes?: string;
}

export async function createClaim(input: CreateClaimInput, user: { id: string; fullName: string }) {
  const { from, to } = parsePeriod(input.periodFrom, input.periodTo);

  const trainer = await db.trainer.findFirst({ where: { id: input.trainerId, deletedAt: null } });
  if (!trainer) throw new ApiError(404, "Trainer not found");

  const engagementType: EngagementType = input.engagementType
    ? (input.engagementType === "CONTRACTOR" ? "CONTRACTOR" : "EMPLOYEE")
    : (trainer.engagementType === "CONTRACTOR" ? "CONTRACTOR" : "EMPLOYEE");

  // One active claim per trainer/type/period — the reference sheets are one
  // sheet per trainer per period. Overlap is rejected to prevent double claims.
  const overlap = await db.trainerClaim.findFirst({
    where: {
      trainerId: input.trainerId,
      claimType: input.claimType,
      deletedAt: null,
      periodFrom: { lte: to },
      periodTo: { gte: from },
    },
    select: { id: true, refNumber: true },
  });
  if (overlap) {
    throw new ApiError(
      409,
      `An active ${input.claimType} claim already exists for this trainer in this period (${overlap.refNumber})`,
      "CLAIM_OVERLAP",
    );
  }

  const refNumber = await nextRefNumber("CLAIM");
  const claim = await db.trainerClaim.create({
    data: {
      id: randomUUID(),
      refNumber,
      claimType: input.claimType,
      trainerId: trainer.id,
      coordinatorId: input.coordinatorId ?? null,
      engagementType,
      periodFrom: from,
      periodTo: to,
      status: "DRAFT",
      notes: input.notes ?? null,
      createdBy: user.id,
      updatedBy: user.id,
      history: appendHistory(null, { at: new Date().toISOString(), by: user.fullName, byId: user.id, action: "CREATED" }),
    },
  });

  await recordAudit({
    userId: user.id,
    action: "CREATE",
    entity: "CLAIM",
    entityId: claim.id,
    entityRef: claim.refNumber,
    description: `Created ${input.claimType} claim ${claim.refNumber} for ${trainer.nameEn} (${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)})`,
    descriptionAr: `تم إنشاء مطالبة ${input.claimType === "OVERTIME" ? "ساعات إضافية" : "رحلة عمل"} ${claim.refNumber} للمدرب ${trainer.nameEn}`,
    metadata: { claimType: input.claimType, trainerId: trainer.id, periodFrom: from.toISOString(), periodTo: to.toISOString() },
  });

  return claim;
}

/**
 * (Re)generate the claim's items from its trainer's sessions inside the period.
 * Sessions are the source of truth: existing items are replaced, and the claim
 * status moves to GENERATED. Rates/location are snapshotted from the config at
 * this moment so approved claims keep the values that were in force.
 */
export async function generateClaimItems(
  claimId: string,
  user: { id: string; fullName: string },
  opts: { configOverride?: ClaimConfig } = {},
) {
  const claim = assertNotDeleted(await loadClaim(claimId));
  if (!GENERATABLE_STATUSES.has(claim.status as ClaimStatus)) {
    throw new ApiError(409, `Cannot generate items while claim is ${claim.status}`, "BAD_STATUS");
  }

  await ensureDefaultClaimSettings(user.id);
  const config = opts.configOverride ?? (await getClaimConfig());

  const sessions = await db.trainingSession.findMany({
    where: {
      trainerId: claim.trainerId,
      deletedAt: null,
      startDate: { lte: claim.periodTo },
      endDate: { gte: claim.periodFrom },
    },
    include: sessionInclude,
    orderBy: { startDate: "asc" },
  });

  const input: ClaimConfigInput = {
    mainLocation: config.mainLocation,
    employeeDailyAllowance: config.employeeDailyAllowance,
    contractorDailyAllowance: config.contractorDailyAllowance,
  };
  const result = computeClaim(
    sessions.map((s) => toSessionInput(s)),
    {
      claimType: claim.claimType as ClaimType,
      engagementType: claim.engagementType as EngagementType,
      periodFrom: claim.periodFrom,
      periodTo: claim.periodTo,
      config: input,
    },
  );

  const rate = claim.claimType === "BUSINESS_MISSION"
    ? claim.engagementType === "CONTRACTOR"
      ? config.contractorDailyAllowance
      : config.employeeDailyAllowance
    : null;

  await db.$transaction(async (tx) => {
    await tx.trainerClaimItem.deleteMany({ where: { claimId } });
    if (result.items.length > 0) {
      await tx.trainerClaimItem.createMany({
        data: result.items.map((row) => ({
          id: randomUUID(),
          claimId,
          sessionId: row.sessionId,
          date: new Date(`${row.date}T00:00:00.000Z`),
          courseCode: row.courseCode,
          courseTitle: row.courseTitle,
          location: row.location,
          locationFlagged: row.locationFlagged,
          flagReason: row.flagReason,
          shift: row.shift,
          actualHours: row.actualHours,
          originalValue: row.value,
          finalValue: row.value,
          unit: row.unit,
          rate: row.rate,
          amount: row.amount,
          included: true,
          createdBy: user.id,
        })),
      });
    }
    await tx.trainerClaim.update({
      where: { id: claimId },
      data: {
        status: "GENERATED",
        generatedAt: new Date(),
        generatedBy: user.id,
        dailyAllowance: rate,
        mainLocation: config.mainLocation,
        totalHours: result.totalHours,
        totalDays: result.totalDays,
        totalAmount: result.totalAmount,
        updatedBy: user.id,
        updatedAt: new Date(),
        history: appendHistory(claim.history, {
          at: new Date().toISOString(),
          by: user.fullName,
          byId: user.id,
          action: "GENERATED",
          detail: `${result.items.length} item(s), ${sessions.length} session(s) in period`,
        }),
      },
    });
  });

  await recordAudit({
    userId: user.id,
    action: "CREATE",
    entity: "CLAIM",
    entityId: claim.id,
    entityRef: claim.refNumber,
    description: `Generated ${result.items.length} item(s) for claim ${claim.refNumber} (${claim.claimType}, ${result.totalHours} hours, ${result.totalDays} days, ${result.totalAmount} ${claim.currency})`,
    descriptionAr: `تم توليد ${result.items.length} بند للمطالبة ${claim.refNumber}`,
    metadata: { itemCount: result.items.length, sessionCount: sessions.length, totalHours: result.totalHours, totalDays: result.totalDays, totalAmount: result.totalAmount },
  });

  return assertNotDeleted(await loadClaim(claimId));
}

/**
 * Read-only preview of what generation would produce for a trainer/type/period:
 * the sessions it would read and the rows/totals it would compute. Lets the
 * coordinator confirm before creating the claim, and the trainer confirm before
 * submitting. Shares the exact session→row pipeline with generateClaimItems.
 */
export async function previewClaimItems(input: {
  trainerId: string;
  claimType: ClaimType;
  periodFrom: string;
  periodTo: string;
  user: { id: string };
}) {
  const { from, to } = parsePeriod(input.periodFrom, input.periodTo);

  const trainer = await db.trainer.findFirst({ where: { id: input.trainerId, deletedAt: null } });
  if (!trainer) throw new ApiError(404, "Trainer not found");

  const engagementType: EngagementType = trainer.engagementType === "CONTRACTOR" ? "CONTRACTOR" : "EMPLOYEE";

  await ensureDefaultClaimSettings(input.user.id);
  const config = await getClaimConfig();
  const configInput: ClaimConfigInput = {
    mainLocation: config.mainLocation,
    employeeDailyAllowance: config.employeeDailyAllowance,
    contractorDailyAllowance: config.contractorDailyAllowance,
  };

  const sessions = await db.trainingSession.findMany({
    where: {
      trainerId: trainer.id,
      deletedAt: null,
      startDate: { lte: to },
      endDate: { gte: from },
    },
    include: sessionInclude,
    orderBy: { startDate: "asc" },
  });

  const result = computeClaim(
    sessions.map((s) => toSessionInput(s)),
    { claimType: input.claimType, engagementType, periodFrom: from, periodTo: to, config: configInput },
  );

  return {
    engagementType,
    config,
    sessions: sessions.map((s) => ({
      id: s.id,
      refNumber: s.refNumber,
      courseCode: s.course?.code ?? null,
      courseTitle: s.course?.title ?? null,
      city: s.city,
      location: s.location,
      shift: s.shift,
      durationHours: s.durationHours,
      startDate: s.startDate,
      endDate: s.endDate,
    })),
    rows: result.items,
    totals: { totalHours: result.totalHours, totalDays: result.totalDays, totalAmount: result.totalAmount },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TRAINER REVIEW — item adjustment + submit
// ─────────────────────────────────────────────────────────────────────────────

export interface AdjustItemInput {
  itemId: string;
  value: number;
  reason: string;
}

export async function adjustClaimItem(
  claimId: string,
  input: AdjustItemInput,
  user: { id: string; fullName: string; trainerId: string | null },
) {
  const claim = assertNotDeleted(await loadClaim(claimId));

  // Only the claim's own trainer may adjust its items.
  if (!user.trainerId || user.trainerId !== claim.trainerId) {
    throw new ApiError(403, "You can only adjust your own claims", "FORBIDDEN");
  }
  if (!EDITABLE_STATUSES.has(claim.status as ClaimStatus)) {
    throw new ApiError(409, `Items can only be adjusted while the claim is GENERATED or RETURNED (current: ${claim.status})`, "BAD_STATUS");
  }
  const reason = input.reason.trim();
  if (!reason) throw new ApiError(422, "An adjustment reason is required", "VALIDATION_ERROR");
  if (!Number.isFinite(input.value) || input.value < 0) {
    throw new ApiError(422, "Adjustment value must be a non-negative number", "VALIDATION_ERROR");
  }

  const item = claim.items.find((i) => i.id === input.itemId);
  if (!item) throw new ApiError(404, "Claim item not found");

  const value = Math.round(input.value * 100) / 100;
  const isRevert = value === item.originalValue;

  await db.trainerClaimItem.update({
    where: { id: item.id },
    data: {
      adjustedValue: isRevert ? null : value,
      adjustmentReason: isRevert ? null : reason,
      adjustedBy: isRevert ? null : user.id,
      adjustedAt: isRevert ? null : new Date(),
      finalValue: value,
      amount: item.unit === "DAYS" && item.rate != null ? Math.round(value * item.rate * 100) / 100 : item.amount,
      updatedAt: new Date(),
    },
  });

  // Recompute claim totals from the (possibly adjusted) items.
  const fresh = await db.trainerClaimItem.findMany({ where: { claimId, included: true } });
  let totalHours = 0;
  let totalDays = 0;
  let totalAmount = 0;
  for (const i of fresh) {
    if (i.unit === "HOURS") totalHours = Math.round((totalHours + i.finalValue) * 100) / 100;
    else totalDays += 1;
    if (i.amount != null) totalAmount = Math.round((totalAmount + i.amount) * 100) / 100;
  }
  await db.trainerClaim.update({
    where: { id: claimId },
    data: {
      totalHours,
      totalDays,
      totalAmount,
      updatedBy: user.id,
      updatedAt: new Date(),
      history: appendHistory(claim.history, {
        at: new Date().toISOString(),
        by: user.fullName,
        byId: user.id,
        action: "ADJUSTED",
        detail: `${item.date.toISOString().slice(0, 10)} ${item.unit}: ${item.originalValue} → ${value} (${reason})`,
      }),
    },
  });

  await recordAudit({
    userId: user.id,
    action: "UPDATE",
    entity: "CLAIM",
    entityId: claim.id,
    entityRef: claim.refNumber,
    description: `Adjusted claim ${claim.refNumber} item ${item.date.toISOString().slice(0, 10)} (${item.unit}) from ${item.originalValue} to ${value}`,
    descriptionAr: `تعديل بند في المطالبة ${claim.refNumber} من ${item.originalValue} إلى ${value}`,
    oldValue: { itemId: item.id, date: item.date, originalValue: item.originalValue, finalValue: item.finalValue },
    newValue: { itemId: item.id, finalValue: value, amount: item.unit === "DAYS" && item.rate != null ? value * item.rate : item.amount },
    reason,
  });

  return assertNotDeleted(await loadClaim(claimId));
}

export async function toggleClaimItemIncluded(
  claimId: string,
  itemId: string,
  user: { id: string; fullName: string; trainerId: string | null },
) {
  const claim = assertNotDeleted(await loadClaim(claimId));
  if (!EDITABLE_STATUSES.has(claim.status as ClaimStatus)) {
    throw new ApiError(409, `Items can only be toggled while the claim is GENERATED or RETURNED (current: ${claim.status})`, "BAD_STATUS");
  }

  const item = claim.items.find((i) => i.id === itemId);
  if (!item) throw new ApiError(404, "Claim item not found");

  const newIncluded = !item.included;

  await db.trainerClaimItem.update({
    where: { id: itemId },
    data: { included: newIncluded, updatedAt: new Date() },
  });

  // Recompute totals from included items only.
  const fresh = await db.trainerClaimItem.findMany({ where: { claimId, included: true } });
  let totalHours = 0;
  let totalDays = 0;
  let totalAmount = 0;
  for (const i of fresh) {
    if (i.unit === "HOURS") totalHours = Math.round((totalHours + i.finalValue) * 100) / 100;
    else totalDays += 1;
    if (i.amount != null) totalAmount = Math.round((totalAmount + i.amount) * 100) / 100;
  }
  await db.trainerClaim.update({
    where: { id: claimId },
    data: {
      totalHours,
      totalDays,
      totalAmount,
      updatedBy: user.id,
      updatedAt: new Date(),
    },
  });

  return assertNotDeleted(await loadClaim(claimId));
}

// ─────────────────────────────────────────────────────────────────────────────
// HRD-FO-052 MULTI-STEP APPROVAL WORKFLOW
// ─────────────────────────────────────────────────────────────────────────────

/** Trainer acknowledges the employee overtime terms before submitting. */
export async function acknowledgeClaim(
  claimId: string,
  input: { accepted: boolean; requestedBy?: string; reason?: string; normalWorkingHours?: number; estimatedOtPerDay?: number },
  user: { id: string; fullName: string; trainerId: string | null },
) {
  const claim = assertNotDeleted(await loadClaim(claimId));
  if (claim.engagementType !== "EMPLOYEE") {
    throw new ApiError(409, "Acknowledgment is only for EMPLOYEE overtime claims", "BAD_STATUS");
  }
  if (!EDITABLE_STATUSES.has(claim.status as ClaimStatus)) {
    throw new ApiError(409, `Acknowledgment can only be set while claim is GENERATED or RETURNED (current: ${claim.status})`, "BAD_STATUS");
  }
  const data: Record<string, unknown> = {
    acknowledgmentAccepted: input.accepted,
    updatedBy: user.id,
    updatedAt: new Date(),
  };
  if (input.requestedBy) data.requestedBy = input.requestedBy;
  if (input.reason !== undefined) data.reason = input.reason;
  if (input.normalWorkingHours) data.normalWorkingHoursPerDay = input.normalWorkingHours;
  if (input.estimatedOtPerDay) data.estimatedOtPerDay = input.estimatedOtPerDay;

  await db.trainerClaim.update({ where: { id: claimId }, data });
  return assertNotDeleted(await loadClaim(claimId));
}

/** Line Manager reviews the submitted claim (HRD-FO-052 Section 4). */
export async function lineManagerReview(
  claimId: string,
  input: { decision: string; comments?: string; checklist?: string },
  user: { id: string; fullName: string },
  opts: { req?: Request } = {},
) {
  const claim = assertNotDeleted(await loadClaim(claimId));
  if (claim.status !== "LINE_MANAGER_REVIEW") {
    throw new ApiError(409, `Only claims in LINE_MANAGER_REVIEW can be reviewed (current: ${claim.status})`, "BAD_STATUS");
  }
  const nextStatus = input.decision === "NOT_APPROVED" ? "RETURNED" : "QHSE_REVIEW";
  const updated = await db.trainerClaim.update({
    where: { id: claimId },
    data: {
      lineManagerDecision: input.decision,
      lineManagerChecklist: input.checklist ?? null,
      lineManagerComments: input.comments ?? null,
      lineManagerSignatureBy: user.fullName,
      lineManagerSignatureAt: new Date(),
      status: nextStatus,
      ...(nextStatus === "RETURNED" ? { returnedAt: new Date(), returnedBy: user.id, returnReason: input.comments ?? "Line Manager did not approve" } : {}),
      updatedBy: user.id,
      updatedAt: new Date(),
      history: appendHistory(claim.history, { at: new Date().toISOString(), by: user.fullName, byId: user.id, action: "LINE_MANAGER_REVIEW", detail: `Decision: ${input.decision} → ${nextStatus}` }),
    },
  });
  await recordAudit({
    userId: user.id,
    action: "UPDATE",
    entity: "CLAIM",
    entityId: claimId,
    entityRef: claim.refNumber,
    description: `Line Manager review on claim ${claim.refNumber}: ${input.decision}`,
    descriptionAr: `مراجعة مدير الخط للمطالبة ${claim.refNumber}: ${input.decision}`,
    req: opts.req,
  });
  return updated;
}

/** QHSE reviews the claim (HRD-FO-052 Section 5). */
export async function qhseReview(
  claimId: string,
  input: { assessment: string; controls?: string },
  user: { id: string; fullName: string },
  opts: { req?: Request } = {},
) {
  const claim = assertNotDeleted(await loadClaim(claimId));
  if (claim.status !== "QHSE_REVIEW") {
    throw new ApiError(409, `Only claims in QHSE_REVIEW can be reviewed (current: ${claim.status})`, "BAD_STATUS");
  }
  const nextStatus = input.assessment === "NOT_RECOMMENDED" ? "RETURNED" : "HR_REVIEW";
  const updated = await db.trainerClaim.update({
    where: { id: claimId },
    data: {
      qhseAssessment: input.assessment,
      qhseControls: input.controls ?? null,
      qhseSignatureBy: user.fullName,
      qhseSignatureAt: new Date(),
      status: nextStatus,
      ...(nextStatus === "RETURNED" ? { returnedAt: new Date(), returnedBy: user.id, returnReason: input.controls ?? "QHSE did not recommend" } : {}),
      updatedBy: user.id,
      updatedAt: new Date(),
      history: appendHistory(claim.history, { at: new Date().toISOString(), by: user.fullName, byId: user.id, action: "QHSE_REVIEW", detail: `Assessment: ${input.assessment} → ${nextStatus}` }),
    },
  });
  await recordAudit({
    userId: user.id,
    action: "UPDATE",
    entity: "CLAIM",
    entityId: claimId,
    entityRef: claim.refNumber,
    description: `QHSE review on claim ${claim.refNumber}: ${input.assessment}`,
    descriptionAr: `مراجعة السلامة للمطالبة ${claim.refNumber}: ${input.assessment}`,
    req: opts.req,
  });
  return updated;
}

/** HR reviews the claim (HRD-FO-052 Section 6). */
export async function hrReview(
  claimId: string,
  input: { decision: string; maxApprovedOt?: number; periodFrom?: string; periodTo?: string; comments?: string },
  user: { id: string; fullName: string },
  opts: { req?: Request } = {},
) {
  const claim = assertNotDeleted(await loadClaim(claimId));
  if (claim.status !== "HR_REVIEW") {
    throw new ApiError(409, `Only claims in HR_REVIEW can be reviewed (current: ${claim.status})`, "BAD_STATUS");
  }
  const nextStatus = input.decision === "NOT_APPROVED" ? "RETURNED" : "APPROVED";
  const updated = await db.trainerClaim.update({
    where: { id: claimId },
    data: {
      hrDecision: input.decision,
      hrMaxApprovedOt: input.maxApprovedOt ?? null,
      hrApprovedPeriodFrom: input.periodFrom ? new Date(input.periodFrom) : null,
      hrApprovedPeriodTo: input.periodTo ? new Date(input.periodTo) : null,
      hrComments: input.comments ?? null,
      hrSignatureBy: user.fullName,
      hrSignatureAt: new Date(),
      status: nextStatus,
      ...(nextStatus === "APPROVED" ? { approvedAt: new Date(), approvedBy: user.id } : {}),
      ...(nextStatus === "RETURNED" ? { returnedAt: new Date(), returnedBy: user.id, returnReason: input.comments ?? "HR did not approve" } : {}),
      updatedBy: user.id,
      updatedAt: new Date(),
      history: appendHistory(claim.history, { at: new Date().toISOString(), by: user.fullName, byId: user.id, action: "HR_REVIEW", detail: `Decision: ${input.decision} → ${nextStatus}` }),
    },
  });
  await recordAudit({
    userId: user.id,
    action: "UPDATE",
    entity: "CLAIM",
    entityId: claimId,
    entityRef: claim.refNumber,
    description: `HR review on claim ${claim.refNumber}: ${input.decision}`,
    descriptionAr: `مراجعة الموارد البشرية للمطالبة ${claim.refNumber}: ${input.decision}`,
    req: opts.req,
  });
  return updated;
}

/** Coordinator moves a submitted claim to LINE_MANAGER_REVIEW (starts the HRD-FO-052 workflow). */
export async function startManagerReview(
  claimId: string,
  user: { id: string; fullName: string },
  opts: { req?: Request } = {},
) {
  const claim = assertNotDeleted(await loadClaim(claimId));
  if (claim.status !== "SUBMITTED") {
    throw new ApiError(409, `Only SUBMITTED claims can be forwarded for manager review (current: ${claim.status})`, "BAD_STATUS");
  }
  const updated = await db.trainerClaim.update({
    where: { id: claimId },
    data: {
      status: "LINE_MANAGER_REVIEW",
      updatedBy: user.id,
      updatedAt: new Date(),
      history: appendHistory(claim.history, { at: new Date().toISOString(), by: user.fullName, byId: user.id, action: "FORWARDED_TO_LINE_MANAGER" }),
    },
  });
  await recordAudit({
    userId: user.id,
    action: "STATUS_CHANGE",
    entity: "CLAIM",
    entityId: claimId,
    entityRef: claim.refNumber,
    description: `Forwarded claim ${claim.refNumber} to Line Manager review`,
    descriptionAr: `تم تحويل المطالبة ${claim.refNumber} لمراجعة مدير الخط`,
    req: opts.req,
  });
  return updated;
}

/** Fast-track: coordinator approves directly (skips manager/QHSE/HR). */
export async function submitClaim(
  claimId: string,
  user: { id: string; fullName: string; trainerId: string | null },
) {
  const claim = assertNotDeleted(await loadClaim(claimId));
  if (!user.trainerId || user.trainerId !== claim.trainerId) {
    throw new ApiError(403, "You can only submit your own claims", "FORBIDDEN");
  }
  if (claim.status !== "DRAFT" && claim.status !== "GENERATED" && claim.status !== "RETURNED") {
    throw new ApiError(409, `Only DRAFT/GENERATED/RETURNED claims can be submitted (current: ${claim.status})`, "BAD_STATUS");
  }
  const newStatus: ClaimStatus = claim.coordinatorId ? "PENDING_COORDINATOR_APPROVAL" : "SUBMITTED";
  const updated = await db.trainerClaim.update({
    where: { id: claimId },
    data: {
      status: newStatus,
      submittedAt: new Date(),
      submittedBy: user.id,
      updatedBy: user.id,
      updatedAt: new Date(),
      history: appendHistory(claim.history, { at: new Date().toISOString(), by: user.fullName, byId: user.id, action: "SUBMITTED", detail: `Status: ${newStatus}` }),
    },
  });
  await recordAudit({
    userId: user.id,
    action: "STATUS_CHANGE",
    entity: "CLAIM",
    entityId: claim.id,
    entityRef: claim.refNumber,
    description: `Submitted claim ${claim.refNumber} for review`,
    descriptionAr: `تم إرسال المطالبة ${claim.refNumber} للمراجعة`,
    oldValue: { status: claim.status },
    newValue: { status: "SUBMITTED" },
  });
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// COORDINATOR REVIEW — approve / return / finalize
// ─────────────────────────────────────────────────────────────────────────────

/** Coordinator approves directly from SUBMITTED/PENDING_COORDINATOR_APPROVAL (skip HRD-FO-052) or from HR_REVIEW. */
export async function approveClaim(
  claimId: string,
  user: { id: string; fullName: string; role?: string },
  opts: { req?: Request } = {},
) {
  const claim = assertNotDeleted(await loadClaim(claimId));
  const approvableStatuses = new Set(["SUBMITTED", "PENDING_COORDINATOR_APPROVAL", "HR_REVIEW"]);
  if (!approvableStatuses.has(claim.status)) {
    throw new ApiError(409, `Only SUBMITTED/PENDING_COORDINATOR_APPROVAL/HR_REVIEW claims can be approved (current: ${claim.status})`, "BAD_STATUS");
  }
  if (claim.coordinatorId && user.role !== "SUPER_ADMIN" && claim.coordinatorId !== user.id) {
    throw new ApiError(403, "You can only approve claims assigned to you", "FORBIDDEN");
  }
  const updated = await db.trainerClaim.update({
    where: { id: claimId },
    data: {
      status: "APPROVED",
      approvedAt: new Date(),
      approvedBy: user.id,
      updatedBy: user.id,
      updatedAt: new Date(),
      history: appendHistory(claim.history, { at: new Date().toISOString(), by: user.fullName, byId: user.id, action: "APPROVED" }),
    },
  });
  await recordAudit({
    userId: user.id,
    action: "APPROVE",
    entity: "CLAIM",
    entityId: claim.id,
    entityRef: claim.refNumber,
    description: `Approved claim ${claim.refNumber} (${claim.totalHours} hours, ${claim.totalDays} days, ${claim.totalAmount} ${claim.currency})`,
    descriptionAr: `تمت الموافقة على المطالبة ${claim.refNumber}`,
    req: opts.req,
    oldValue: { status: claim.status },
    newValue: { status: "APPROVED", totalHours: claim.totalHours, totalDays: claim.totalDays, totalAmount: claim.totalAmount },
  });
  return updated;
}

export async function returnClaim(
  claimId: string,
  user: { id: string; fullName: string; role?: string },
  reason: string,
  opts: { req?: Request } = {},
) {
  const trimmed = reason.trim();
  if (!trimmed) throw new ApiError(422, "A return reason is required", "VALIDATION_ERROR");
  const claim = assertNotDeleted(await loadClaim(claimId));
  const returnableStatuses = new Set(["SUBMITTED", "PENDING_COORDINATOR_APPROVAL", "LINE_MANAGER_REVIEW", "QHSE_REVIEW", "HR_REVIEW"]);
  if (!returnableStatuses.has(claim.status)) {
    throw new ApiError(409, `Only SUBMITTED/PENDING_COORDINATOR_APPROVAL/LINE_MANAGER_REVIEW/QHSE_REVIEW/HR_REVIEW claims can be returned (current: ${claim.status})`, "BAD_STATUS");
  }
  if (claim.coordinatorId && user.role !== "SUPER_ADMIN" && claim.coordinatorId !== user.id) {
    throw new ApiError(403, "You can only return claims assigned to you", "FORBIDDEN");
  }
  const updated = await db.trainerClaim.update({
    where: { id: claimId },
    data: {
      status: "RETURNED",
      returnedAt: new Date(),
      returnedBy: user.id,
      returnReason: trimmed,
      updatedBy: user.id,
      updatedAt: new Date(),
      history: appendHistory(claim.history, { at: new Date().toISOString(), by: user.fullName, byId: user.id, action: "RETURNED", detail: trimmed }),
    },
  });
  await recordAudit({
    userId: user.id,
    action: "REJECT",
    entity: "CLAIM",
    entityId: claim.id,
    entityRef: claim.refNumber,
    description: `Returned claim ${claim.refNumber}: ${trimmed}`,
    descriptionAr: `إعادة المطالبة ${claim.refNumber}: ${trimmed}`,
    req: opts.req,
    reason: trimmed,
    oldValue: { status: claim.status },
    newValue: { status: "RETURNED" },
  });
  return updated;
}

/** Coordinator rejects a claim — permanently REJECTED (trainer cannot resubmit, must create new). */
export async function rejectClaim(
  claimId: string,
  user: { id: string; fullName: string; role?: string },
  reason: string,
  opts: { req?: Request } = {},
) {
  const trimmed = reason.trim();
  if (!trimmed) throw new ApiError(422, "A rejection reason is required", "VALIDATION_ERROR");
  const claim = assertNotDeleted(await loadClaim(claimId));
  const rejectableStatuses = new Set(["SUBMITTED", "PENDING_COORDINATOR_APPROVAL"]);
  if (!rejectableStatuses.has(claim.status)) {
    throw new ApiError(409, `Only SUBMITTED/PENDING_COORDINATOR_APPROVAL claims can be rejected (current: ${claim.status})`, "BAD_STATUS");
  }
  if (claim.coordinatorId && user.role !== "SUPER_ADMIN" && claim.coordinatorId !== user.id) {
    throw new ApiError(403, "You can only reject claims assigned to you", "FORBIDDEN");
  }
  const updated = await db.trainerClaim.update({
    where: { id: claimId },
    data: {
      status: "REJECTED",
      returnedAt: new Date(),
      returnedBy: user.id,
      returnReason: trimmed,
      updatedBy: user.id,
      updatedAt: new Date(),
      history: appendHistory(claim.history, { at: new Date().toISOString(), by: user.fullName, byId: user.id, action: "REJECTED", detail: trimmed }),
    },
  });
  await recordAudit({
    userId: user.id,
    action: "REJECT",
    entity: "CLAIM",
    entityId: claim.id,
    entityRef: claim.refNumber,
    description: `Rejected claim ${claim.refNumber}: ${trimmed}`,
    descriptionAr: `رفض المطالبة ${claim.refNumber}: ${trimmed}`,
    req: opts.req,
    reason: trimmed,
    oldValue: { status: claim.status },
    newValue: { status: "REJECTED" },
  });
  return updated;
}

export async function finalizeClaim(
  claimId: string,
  user: { id: string; fullName: string },
  opts: { req?: Request } = {},
) {
  const claim = assertNotDeleted(await loadClaim(claimId));
  if (claim.status !== "APPROVED") {
    throw new ApiError(409, `Only APPROVED claims can be finalized (current: ${claim.status})`, "BAD_STATUS");
  }
  const updated = await db.trainerClaim.update({
    where: { id: claimId },
    data: {
      status: "FINAL",
      finalizedAt: new Date(),
      finalizedBy: user.id,
      updatedBy: user.id,
      updatedAt: new Date(),
      history: appendHistory(claim.history, { at: new Date().toISOString(), by: user.fullName, byId: user.id, action: "FINALIZED" }),
    },
  });
  await recordAudit({
    userId: user.id,
    action: "STATUS_CHANGE",
    entity: "CLAIM",
    entityId: claim.id,
    entityRef: claim.refNumber,
    description: `Finalized claim ${claim.refNumber}`,
    descriptionAr: `تمت المتابعة النهائية للمطالبة ${claim.refNumber}`,
    req: opts.req,
    oldValue: { status: claim.status },
    newValue: { status: "FINAL" },
  });
  return updated;
}

export async function softDeleteClaim(
  claimId: string,
  user: { id: string; fullName: string },
  opts: { req?: Request } = {},
) {
  const claim = assertNotDeleted(await loadClaim(claimId));
  if (claim.status !== "DRAFT" && claim.status !== "GENERATED" && claim.status !== "RETURNED") {
    throw new ApiError(409, `Only DRAFT, GENERATED or RETURNED claims can be deleted (current: ${claim.status})`, "BAD_STATUS");
  }
  const updated = await db.trainerClaim.update({
    where: { id: claimId },
    data: {
      deletedAt: new Date(),
      updatedBy: user.id,
      updatedAt: new Date(),
      history: appendHistory(claim.history, { at: new Date().toISOString(), by: user.fullName, byId: user.id, action: "DELETED" }),
    },
  });
  await recordAudit({
    userId: user.id,
    action: "DELETE",
    entity: "CLAIM",
    entityId: claim.id,
    entityRef: claim.refNumber,
    description: `Deleted claim ${claim.refNumber}`,
    descriptionAr: `تم حذف المطالبة ${claim.refNumber}`,
    req: opts.req,
    oldValue: { status: claim.status, refNumber: claim.refNumber },
  });
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// QUERY + SERIALIZATION
// ─────────────────────────────────────────────────────────────────────────────

export interface ClaimListFilters {
  claimType?: string;
  status?: string;
  trainerId?: string;
  coordinatorId?: string;
  search?: string;
  /** YYYY-MM — claims whose period overlaps that month. */
  month?: string;
}

export async function listClaims(filters: ClaimListFilters, trainerScopeId: string | null, includeDeleted = false) {
  const where: Record<string, unknown> = {};
  if (!includeDeleted) where.deletedAt = null;
  if (trainerScopeId) where.trainerId = trainerScopeId;
  if (filters.claimType) where.claimType = filters.claimType;
  if (filters.status) where.status = filters.status;
  if (filters.trainerId && !trainerScopeId) where.trainerId = filters.trainerId;
  if (filters.coordinatorId) where.coordinatorId = filters.coordinatorId;
  if (filters.month && /^\d{4}-\d{2}$/.test(filters.month)) {
    const [y, m] = filters.month.split("-").map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1));
    const to = new Date(Date.UTC(y, m, 0, 23, 59, 59, 999));
    where.periodFrom = { lte: to };
    where.periodTo = { gte: from };
  }
  if (filters.search) {
    where.OR = [
      { refNumber: { contains: filters.search } },
      { trainer: { nameEn: { contains: filters.search } } },
      { trainer: { nameAr: { contains: filters.search } } },
    ];
  }

  return db.trainerClaim.findMany({
    where,
    include: {
      trainer: { select: { id: true, nameEn: true, nameAr: true, refNumber: true, engagementType: true } },
      coordinator: { select: { id: true, fullName: true } },
      _count: { select: { items: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export function serializeClaim(claim: ClaimWithRelations) {
  return {
    id: claim.id,
    refNumber: claim.refNumber,
    claimType: claim.claimType,
    engagementType: claim.engagementType,
    status: claim.status,
    periodFrom: claim.periodFrom,
    periodTo: claim.periodTo,
    dailyAllowance: claim.dailyAllowance,
    mainLocation: claim.mainLocation,
    notes: claim.notes,
    history: claim.history ? (JSON.parse(claim.history) as HistoryEntry[]) : [],
    totalHours: claim.totalHours,
    totalDays: claim.totalDays,
    totalAmount: claim.totalAmount,
    currency: claim.currency,
    generatedAt: claim.generatedAt,
    generatedBy: claim.generatedBy,
    submittedAt: claim.submittedAt,
    submittedBy: claim.submittedBy,
    approvedAt: claim.approvedAt,
    approvedBy: claim.approvedBy,
    returnedAt: claim.returnedAt,
    returnedBy: claim.returnedBy,
    returnReason: claim.returnReason,
    finalizedAt: claim.finalizedAt,
    finalizedBy: claim.finalizedBy,
    createdAt: claim.createdAt,
    updatedAt: claim.updatedAt,
    itemCount: claim.items.length,
    coordinatorId: claim.coordinatorId ?? null,
    coordinator: claim.coordinator ? { id: claim.coordinator.id, fullName: claim.coordinator.fullName } : null,
    // HRD-FO-052 Employee Overtime fields
    employeeId: claim.employeeId,
    employeeJobTitle: claim.employeeJobTitle,
    employeeDepartment: claim.employeeDepartment,
    employeeProject: claim.employeeProject,
    employeeLineManager: claim.employeeLineManager,
    normalWorkingHoursPerDay: claim.normalWorkingHoursPerDay,
    estimatedOtPerDay: claim.estimatedOtPerDay,
    requestedBy: claim.requestedBy,
    reason: claim.reason,
    // Employee Acknowledgment
    acknowledgmentAccepted: claim.acknowledgmentAccepted,
    acknowledgmentText: claim.acknowledgmentText,
    // Line Manager Review
    lineManagerDecision: claim.lineManagerDecision,
    lineManagerChecklist: claim.lineManagerChecklist,
    lineManagerComments: claim.lineManagerComments,
    lineManagerSignatureBy: claim.lineManagerSignatureBy,
    lineManagerSignatureAt: claim.lineManagerSignatureAt,
    // QHSE Review
    qhseAssessment: claim.qhseAssessment,
    qhseControls: claim.qhseControls,
    qhseSignatureBy: claim.qhseSignatureBy,
    qhseSignatureAt: claim.qhseSignatureAt,
    // HR Review
    hrDecision: claim.hrDecision,
    hrMaxApprovedOt: claim.hrMaxApprovedOt,
    hrApprovedPeriodFrom: claim.hrApprovedPeriodFrom,
    hrApprovedPeriodTo: claim.hrApprovedPeriodTo,
    hrSignatureBy: claim.hrSignatureBy,
    hrSignatureAt: claim.hrSignatureAt,
    hrComments: claim.hrComments,
    // Contractor fields
    contractorInvoiceNumber: claim.contractorInvoiceNumber,
    contractorClient: claim.contractorClient,
    contractorRatePerDay: claim.contractorRatePerDay,
    trainer: {
      id: claim.trainer.id,
      refNumber: claim.trainer.refNumber,
      nameEn: claim.trainer.nameEn,
      nameAr: claim.trainer.nameAr,
      engagementType: claim.trainer.engagementType,
    },
    items: claim.items.map((item) => ({
      id: item.id,
      sessionId: item.sessionId,
      sessionRef: item.session.refNumber,
      date: item.date,
      courseCode: item.courseCode,
      courseTitle: item.courseTitle,
      location: item.location,
      locationFlagged: item.locationFlagged,
      flagReason: item.flagReason,
      shift: item.shift,
      actualHours: item.actualHours,
      coordinatorName: item.session.request?.coordinator?.fullName ?? null,
      originalValue: item.originalValue,
      adjustedValue: item.adjustedValue,
      adjustmentReason: item.adjustmentReason,
      adjustedBy: item.adjustedBy,
      adjustedAt: item.adjustedAt,
      finalValue: item.finalValue,
      unit: item.unit,
      rate: item.rate,
      amount: item.amount,
      included: item.included,
    })),
  };
}
