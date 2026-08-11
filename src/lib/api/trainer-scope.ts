// GCCLAB TMS — Trainer data-scoping helpers
// =====================================================================
// A TRAINER is a delivery-only user. Every list query they run must be
// restricted to their OWN records (the sessions they are assigned to, the
// trainees enrolled in those sessions, the workshops they are authorized to
// deliver, the evaluations that rate them), and any record they fetch by id
// that belongs to another trainer is rejected.
//
// All scoping derives from the authenticated user (AuthUser.trainerId), never
// from a client-supplied id, so crafting a ?trainerId= or an id param cannot
// bypass the scope.
// =====================================================================
import type { AuthUser } from "@/lib/auth/api";

type TrainerLike = Pick<AuthUser, "role" | "trainerId">;

/** The authenticated user's trainerId when they are a TRAINER, else null. */
export function trainerIdOf(user: TrainerLike): string | null {
  return user.role === "TRAINER" ? (user.trainerId ?? null) : null;
}

/** Session list: a trainer only ever sees sessions assigned to them. */
export function scopeSessionList(
  where: Record<string, unknown>,
  user: TrainerLike
): void {
  const trainerId = trainerIdOf(user);
  if (trainerId) where.trainerId = trainerId;
}

/**
 * True when the authenticated TRAINER must NOT access a session record.
 * Non-trainers are never blocked by this rule.
 */
export function trainerDeniedSession(
  user: TrainerLike,
  sessionTrainerId: string | null | undefined
): boolean {
  const trainerId = trainerIdOf(user);
  if (!trainerId) return false;
  return sessionTrainerId !== trainerId;
}

/**
 * Relation filter for records linked to a session (attendance, exam attempts,
 * test results, check-in attempts): the trainer may only touch records whose
 * session belongs to them.
 */
export function trainerSessionFilter(
  user: TrainerLike
): { session: { trainerId: string } } | null {
  const trainerId = trainerIdOf(user);
  return trainerId ? { session: { trainerId } } : null;
}

/** Trainee list: only trainees enrolled in the trainer's own sessions. */
export function trainerTraineeFilter(
  user: TrainerLike
): { sessionEnrollments: { some: { session: { trainerId: string } } } } | null {
  const trainerId = trainerIdOf(user);
  return trainerId
    ? { sessionEnrollments: { some: { session: { trainerId } } } }
    : null;
}

/** Workshop list: only workshops the trainer is authorized to deliver. */
export function trainerWorkshopFilter(
  user: TrainerLike
): { authorizations: { some: { trainerId: string } } } | null {
  const trainerId = trainerIdOf(user);
  return trainerId ? { authorizations: { some: { trainerId } } } : null;
}

/** Evaluation list: only evaluations that rate the trainer. */
export function trainerEvaluationFilter(
  user: TrainerLike
): { trainerId: string } | null {
  const trainerId = trainerIdOf(user);
  return trainerId ? { trainerId } : null;
}
