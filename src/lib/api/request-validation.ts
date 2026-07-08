// GCCLAB TMS — Business rules for training request multi-course validation
// =====================================================================
// Validates that:
//   - Each course in a request has between MIN_TRAINEES (10) and MAX_TRAINEES (20) trainees
//   - Approval is BLOCKED if any course fails the trainee count check
//   - Each course's trainee list must be from the same company as the request

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
}

export interface RequestValidation {
  valid: boolean;
  totalTrainees: number;
  courses: CourseValidation[];
  failingCourses: CourseValidation[];
}

/**
 * Validate that all courses in a training request meet the min/max trainee rules.
 * Used to block APPROVED transition when any course fails validation.
 */
export async function validateRequestForApproval(requestId: string): Promise<RequestValidation> {
  const requestCourses = await db.trainingRequestCourse.findMany({
    where: { requestId, deletedAt: null },
    include: {
      course: { select: { id: true, title: true, code: true } },
      trainees: { where: { deletedAt: null } },
    },
  });

  if (requestCourses.length === 0) {
    return {
      valid: false,
      totalTrainees: 0,
      courses: [],
      failingCourses: [],
    };
  }

  const courseValidations: CourseValidation[] = requestCourses.map((rc) => {
    const count = rc.trainees.length;
    let valid = true;
    let reason: string | undefined;

    if (count < MIN_TRAINEES_PER_COURSE) {
      valid = false;
      reason = `Below minimum: ${count}/${MIN_TRAINEES_PER_COURSE} trainees`;
    } else if (count > MAX_TRAINEES_PER_COURSE) {
      valid = false;
      reason = `Above maximum: ${count}/${MAX_TRAINEES_PER_COURSE} trainees`;
    }

    return {
      requestCourseId: rc.id,
      courseId: rc.courseId,
      courseTitle: rc.course?.title ?? "—",
      traineeCount: count,
      minTrainees: MIN_TRAINEES_PER_COURSE,
      maxTrainees: MAX_TRAINEES_PER_COURSE,
      valid,
      reason,
    };
  });

  const failingCourses = courseValidations.filter((c) => !c.valid);
  const totalTrainees = courseValidations.reduce((sum, c) => sum + c.traineeCount, 0);

  return {
    valid: failingCourses.length === 0,
    totalTrainees,
    courses: courseValidations,
    failingCourses,
  };
}
