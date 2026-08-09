// GCCLAB TMS — Business rules for trainer assignment
// =====================================================================
// Validates that:
//   1. Only Coordinators or Super Admins can assign trainers
//   2. The trainer is certified for the course (TrainerCertification VALID)
//   3. The trainer has no scheduling conflicts (no overlapping sessions)

import { db } from "@/lib/db";
import type { AuthUser } from "@/lib/auth/api";
import { fail } from "@/lib/api/response";
import type { NextResponse } from "next/server";

export interface TrainerAssignmentValidation {
  valid: boolean;
  error?: string;
  errorCode?: string;
  conflictSessionIds?: string[];
}

/**
 * Validate that the requesting user can assign trainers (Coordinator or Super Admin only).
 */
export function canAssignTrainer(user: AuthUser): boolean {
  return user.role === "COORDINATOR" || user.role === "SUPER_ADMIN";
}

/**
 * Check if a trainer is certified (and certification is VALID) for a given course.
 */
export async function isTrainerCertifiedForCourse(trainerId: string, courseId: string): Promise<boolean> {
  const cert = await db.trainerCertification.findFirst({
    where: {
      trainerId,
      courseId,
      deletedAt: null,
      status: "VALID",
      OR: [
        { validUntil: null },
        { validUntil: { gte: new Date() } },
      ],
    },
  });
  return !!cert;
}

/**
 * Check if a trainer has any overlapping sessions in the given time range.
 * Two sessions overlap when: session1.startDate < session2.endDate AND session2.startDate < session1.endDate
 *
 * @param excludeSessionId - optional session ID to exclude (for updates)
 */
export async function findTrainerConflicts(
  trainerId: string,
  startDate: Date,
  endDate: Date,
  excludeSessionId?: string
): Promise<{ id: string; refNumber: string; title: string; startDate: Date; endDate: Date }[]> {
  if (!trainerId) return [];

  const where: Record<string, unknown> = {
    trainerId,
    deletedAt: null,
    status: { in: ["SCHEDULED", "IN_PROGRESS"] },
    AND: [
      { startDate: { lt: endDate } },
      { endDate: { gt: startDate } },
    ],
  };

  if (excludeSessionId) {
    where.NOT = { id: excludeSessionId };
  }

  const conflicts = await db.trainingSession.findMany({
    where,
    select: { id: true, refNumber: true, title: true, startDate: true, endDate: true },
    orderBy: { startDate: "asc" },
  });

  return conflicts;
}

/**
 * Full validation for assigning a trainer to a session.
 * Returns either { valid: true } or { valid: false, error, errorCode, conflictSessionIds }.
 *
 * @param opts.allowCertificationWaiver — when true, skips the certification check
 *   (step 2). Used when a coordinator explicitly chooses to assign a trainer
 *   who is not certified for the course, as a one-time exception.
 */
export async function validateTrainerAssignment(opts: {
  user: AuthUser;
  trainerId: string;
  courseId: string;
  startDate: Date;
  endDate: Date;
  excludeSessionId?: string;
  allowCertificationWaiver?: boolean;
}): Promise<TrainerAssignmentValidation> {
  const { user, trainerId, courseId, startDate, endDate, excludeSessionId, allowCertificationWaiver } = opts;

  // 1. Role check
  if (!canAssignTrainer(user)) {
    return {
      valid: false,
      error: "Only Coordinators or Super Admins can assign trainers",
      errorCode: "FORBIDDEN_ROLE",
    };
  }

  // 2. Certification check — skipped when allowCertificationWaiver is true
  if (!allowCertificationWaiver) {
    const certified = await isTrainerCertifiedForCourse(trainerId, courseId);
    if (!certified) {
      return {
        valid: false,
        error: "Trainer is not certified for this course",
        errorCode: "NOT_CERTIFIED",
      };
    }
  }

  // 3. Conflict check (no overlapping sessions) — always enforced, even with waiver
  const conflicts = await findTrainerConflicts(trainerId, startDate, endDate, excludeSessionId);
  if (conflicts.length > 0) {
    return {
      valid: false,
      error: `Trainer has ${conflicts.length} scheduling conflict(s) in this time range`,
      errorCode: "SCHEDULE_CONFLICT",
      conflictSessionIds: conflicts.map((c) => c.id),
    };
  }

  return { valid: true };
}

/**
 * Helper that returns a 422 API error response from a failed validation.
 */
export function validationErrorToResponse(v: TrainerAssignmentValidation): NextResponse {
  return fail(v.error ?? "Validation failed", 422, v.errorCode, {
    conflictSessionIds: v.conflictSessionIds,
  });
}
