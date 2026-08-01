// GCCLAB TMS — Business rules for training request approval
// =====================================================================
// Per the redesigned workflow (see worklog entry "workflow-redesign-v2"):
//
//   Approval is NEVER blocked by trainee count.
//   Course capacity is a SCHEDULING recommendation, not an approval gate.
//   When trainees exceed capacity, the coordinator will be offered
//   automatic session splitting at scheduling time
//   (see `src/app/api/requests/[id]/generate-sessions/route.ts`).
//
// This function still runs at approval time, but only to collect advisory
// warnings the UI can surface to the coordinator (e.g. "this course has 37
// trainees — 2 sessions will be suggested at scheduling time"). The `valid`
// field is reserved for hard-block checks (currently: none). Warnings go in
// the `warnings` field instead.
//
// A request with zero courses attached is still a hard block — approving it
// would create a session with no trainees and no course context. That case
// stays in `failingCourses` so the UI shows a clear, actionable error.

import { db } from "@/lib/db";

export const MIN_TRAINEES_PER_COURSE = 10;
export const MAX_TRAINEES_PER_COURSE = 20;

export interface CourseValidation {
  requestCourseId: string;
  courseId: string;
  courseTitle: string;
  traineeCount: number;
  minTrainees: number;
  maxTrainees: number;
  valid: boolean;
  reason?: string;
  /** When true, the trainee count is outside the recommended range but
   *  approval is still allowed. The UI shows this as a warning, not an error. */
  warning?: boolean;
  /** When the trainee count exceeds maxTrainees, this is the suggested
   *  number of sessions the auto-splitter would create at scheduling time. */
  suggestedSessionCount?: number;
}

export interface RequestValidation {
  /** `false` only when there is a hard block (currently: zero courses attached). */
  valid: boolean;
  totalTrainees: number;
  courses: CourseValidation[];
  /** Hard-block list. Non-empty ⇒ approval must be refused. */
  failingCourses: CourseValidation[];
  /** Soft-warning list. Non-empty ⇒ approval is allowed but the UI should
   *  surface a heads-up to the coordinator. */
  warnings: CourseValidation[];
}

/**
 * Compute advisory validation for a training request.
 *
 * Returns `valid: false` ONLY when the request has no courses attached
 * (a hard block — approving would create a session with no trainees).
 * Trainee-count mismatches are returned as warnings, not failures.
 */
export async function validateRequestForApproval(requestId: string): Promise<RequestValidation> {
  const requestCourses = await db.trainingRequestCourse.findMany({
    where: { requestId, deletedAt: null },
    include: {
      course: { select: { id: true, title: true, code: true, maxTrainees: true } },
      trainees: { where: { deletedAt: null }, select: { id: true } },
    },
  });

  if (requestCourses.length === 0) {
    // Hard block: no courses attached. Approval is refused.
    return {
      valid: false,
      totalTrainees: 0,
      courses: [],
      failingCourses: [
        {
          requestCourseId: "",
          courseId: "",
          courseTitle: "—",
          traineeCount: 0,
          minTrainees: MIN_TRAINEES_PER_COURSE,
          maxTrainees: MAX_TRAINEES_PER_COURSE,
          valid: false,
          reason: `Request has no courses attached. Add at least one course before approving.`,
        },
      ],
      warnings: [],
    };
  }

  const courseValidations: CourseValidation[] = requestCourses.map((rc) => {
    const count = rc.trainees.length;
    const courseMax = rc.course?.maxTrainees ?? MAX_TRAINEES_PER_COURSE;
    let valid = true;
    let reason: string | undefined;
    let warning = false;
    let suggestedSessionCount: number | undefined;

    if (count < MIN_TRAINEES_PER_COURSE) {
      // Soft warning: below recommended minimum. Approval still allowed —
      // the coordinator may be running a small focused session.
      warning = true;
      reason = `Below recommended minimum: ${count}/${MIN_TRAINEES_PER_COURSE} trainees`;
    } else if (count > courseMax) {
      // Soft warning: above course capacity. Approval still allowed —
      // auto-split will be offered at scheduling time.
      warning = true;
      suggestedSessionCount = Math.ceil(count / courseMax);
      reason = `Above course capacity: ${count}/${courseMax} trainees — ${suggestedSessionCount} sessions will be suggested at scheduling`;
    }

    return {
      requestCourseId: rc.id,
      courseId: rc.courseId,
      courseTitle: rc.course?.title ?? "—",
      traineeCount: count,
      minTrainees: MIN_TRAINEES_PER_COURSE,
      maxTrainees: courseMax,
      valid,
      reason,
      warning,
      suggestedSessionCount,
    };
  });

  const failingCourses = courseValidations.filter((c) => !c.valid);
  const warnings = courseValidations.filter((c) => c.warning);
  const totalTrainees = courseValidations.reduce((sum, c) => sum + c.traineeCount, 0);

  return {
    valid: failingCourses.length === 0,
    totalTrainees,
    courses: courseValidations,
    failingCourses,
    warnings,
  };
}

/**
 * Suggest how to split `traineeCount` trainees into sessions of at most
 * `capacity` each. Returns an array of session sizes that sum to
 * `traineeCount`, balanced so the last session is not tiny.
 *
 * Examples:
 *   splitTrainees(37, 20) → [20, 17]
 *   splitTrainees(45, 20) → [15, 15, 15]
 *   splitTrainees(20, 20) → [20]
 *   splitTrainees(5, 20)  → [5]
 */
export function suggestSessionSplit(traineeCount: number, capacity: number): number[] {
  if (traineeCount <= 0 || capacity <= 0) return [];
  if (traineeCount <= capacity) return [traineeCount];
  const sessionCount = Math.ceil(traineeCount / capacity);
  const base = Math.floor(traineeCount / sessionCount);
  const remainder = traineeCount % sessionCount;
  // Distribute the remainder across the first `remainder` sessions so sizes
  // are as balanced as possible (e.g. 45/20 → 3 sessions → 15/15/15, not 20/20/5).
  const sizes: number[] = [];
  for (let i = 0; i < sessionCount; i++) {
    sizes.push(base + (i < remainder ? 1 : 0));
  }
  return sizes;
}
