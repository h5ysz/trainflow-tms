// GCCLAB TMS — Shared helpers for session management endpoints
// ====================================================================
// Used by: generate-sessions, split, merge, move-trainees, assemble,
// enrollments POST/DELETE, recompute-counts.
//
// All helpers accept an optional `tx` (Prisma.TransactionClient) so they
// can participate in an interactive `$transaction`. When `tx` is omitted
// they use the global `db` — useful for one-off recompute calls.

import { db, type Prisma } from "@/lib/db";

type Tx = Prisma.TransactionClient;

/**
 * Recompute `TrainingSession.expectedTrainees` and the entire `SessionCompany`
 * cache for a session based on its current active enrollments.
 *
 * This is the source of truth for the per-company breakdown. Every endpoint
 * that adds/removes/moves enrollments should call this afterwards to keep
 * the cache in sync. `SessionCompany` rows are hard-deleted and recreated
 * (they have no `deletedAt` column — they're a cache, not a ledger).
 *
 * Safe to call inside a transaction (pass `tx`) or standalone.
 */
export async function recomputeSessionCounts(sessionId: string, tx: Tx = db): Promise<void> {
  const active = await tx.sessionEnrollment.findMany({
    where: { sessionId, deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
    select: { companyId: true },
  });
  await tx.trainingSession.update({
    where: { id: sessionId },
    data: { expectedTrainees: active.length },
  });
  // Wipe + repopulate SessionCompany so the per-company summary is exact.
  await tx.sessionCompany.deleteMany({ where: { sessionId } });
  if (active.length > 0) {
    const companyCounts = new Map<string, number>();
    for (const e of active) {
      companyCounts.set(e.companyId, (companyCounts.get(e.companyId) ?? 0) + 1);
    }
    await tx.sessionCompany.createMany({
      data: Array.from(companyCounts.entries()).map(([companyId, traineeCount]) => ({
        sessionId,
        companyId,
        traineeCount,
      })),
    });
  }
}

/**
 * Cap an array at `maxItems` for audit-log storage. Returns the truncated
 * array plus a `total` field so the audit consumer knows how many items
 * were elided. Per the approved design, the cap is 50.
 */
export const AUDIT_ARRAY_CAP = 50;
export function truncateForAudit<T>(arr: T[]): { items: T[]; total: number } {
  return {
    items: arr.slice(0, AUDIT_ARRAY_CAP),
    total: arr.length,
  };
}

/**
 * Enroll a trainee into a session using the canonical "revive soft-deleted"
 * upsert pattern. The unique constraint `@@unique([sessionId, traineeId])`
 * does NOT include `deletedAt`, so a plain `create` would throw P2002 if the
 * trainee was ever enrolled (and later removed) in this session before.
 *
 * Use this everywhere a new enrollment is created. Never use `createMany`
 * for enrollments — it cannot upsert.
 *
 * `companyId` is the trainee's ORIGINAL company (snapshot at enrollment
 * time). Pass the value from the source enrollment (for move/split/merge)
 * or from `Trainee.companyId` (for fresh enrollment).
 */
export async function upsertEnrollment(
  sessionId: string,
  traineeId: string,
  companyId: string,
  userId: string,
  opts: {
    tx?: Tx;
    enrolledBy?: string | null;
    enrollmentStatus?: string;
    attendanceStatus?: string;
    preTestStatus?: string;
    finalTestStatus?: string;
    evaluationStatus?: string;
    certificateStatus?: string;
    notes?: string | null;
  } = {},
): Promise<void> {
  const tx = opts.tx ?? db;
  const now = new Date();
  await tx.sessionEnrollment.upsert({
    where: { sessionId_traineeId: { sessionId, traineeId } },
    update: {
      deletedAt: null,
      companyId,
      enrolledBy: opts.enrolledBy ?? userId,
      enrollmentStatus: opts.enrollmentStatus ?? "CONFIRMED",
      enrollmentDate: now,
      attendanceStatus: opts.attendanceStatus ?? "NOT_STARTED",
      preTestStatus: opts.preTestStatus ?? "PENDING",
      finalTestStatus: opts.finalTestStatus ?? "PENDING",
      evaluationStatus: opts.evaluationStatus ?? "PENDING",
      certificateStatus: opts.certificateStatus ?? "NOT_ELIGIBLE",
      notes: opts.notes ?? null,
      updatedBy: userId,
    },
    create: {
      sessionId,
      traineeId,
      companyId,
      enrolledBy: opts.enrolledBy ?? userId,
      enrollmentStatus: opts.enrollmentStatus ?? "CONFIRMED",
      enrollmentDate: now,
      attendanceStatus: opts.attendanceStatus ?? "NOT_STARTED",
      preTestStatus: opts.preTestStatus ?? "PENDING",
      finalTestStatus: opts.finalTestStatus ?? "PENDING",
      evaluationStatus: opts.evaluationStatus ?? "PENDING",
      certificateStatus: opts.certificateStatus ?? "NOT_ELIGIBLE",
      notes: opts.notes ?? null,
      createdBy: userId,
      updatedBy: userId,
    },
  });
}

/**
 * Soft-delete an enrollment (set `deletedAt` + `enrollmentStatus: CANCELLED`).
 * Does NOT delete the row — the unique key stays owned so a future re-enroll
 * correctly revives via `upsertEnrollment`.
 */
export async function cancelEnrollment(
  enrollmentId: string,
  userId: string,
  tx: Tx = db,
): Promise<void> {
  await tx.sessionEnrollment.update({
    where: { id: enrollmentId },
    data: {
      deletedAt: new Date(),
      enrollmentStatus: "CANCELLED",
      updatedBy: userId,
    },
  });
}
