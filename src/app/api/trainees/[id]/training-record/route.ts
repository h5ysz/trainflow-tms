// /api/trainees/[id]/training-record — full trainee record (company-scoped).
//
// Identity fields + identity documents + the training history across every
// training request the trainee was enrolled in. Mirrors the worker-passport
// detail endpoint but lives under the `trainees` module.
//
// CRITICAL RULE: only requests that have been APPROVED (or are past approval)
// appear in the history. DRAFT / SUBMITTED / UNDER_REVIEW / REJECTED /
// CANCELLED / REQUIRES_MODIFICATION / CLOSED requests are excluded — a course
// is never shown as "provided" before its request is approved. Once approved,
// the row appears and its status tracks the live request status until the
// final result is issued.
//
// Trainer evaluations are intentionally NOT included.
//
// Permissions: any role with `trainees.view`; contractors are scoped to their
// own company.
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound } from "@/lib/auth/api";
import { trainerIdOf } from "@/lib/api/trainer-scope";

interface WorkerDocument {
  url: string;
  filename: string;
  type: string;
  uploadedAt?: string;
}

function parseDocuments(raw: string | null | undefined): WorkerDocument[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (d) => d && typeof d.url === "string" && typeof d.type === "string"
    );
  } catch {
    return [];
  }
}

// A course appears in the trainee's record only once its request is approved
// (or further along the lifecycle). Pre-approval and terminal/non-approved
// states are never shown as provided courses.
const VISIBLE_REQUEST_STATUSES = new Set([
  "APPROVED",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
]);

// Request status → completion state for a course that has no certificate yet.
const COMPLETION_BY_REQUEST_STATUS: Record<string, string> = {
  COMPLETED: "COMPLETED",
  IN_PROGRESS: "IN_PROGRESS",
  SCHEDULED: "SCHEDULED",
  APPROVED: "SCHEDULED",
};

export const GET = withModuleAction("trainees", "view", async ({ params, user }) => {
  const id = params.id as string;
  const trainee = await db.trainee.findUnique({
    where: { id },
    include: {
      company: { select: { id: true, name: true, refNumber: true } },
      requestCourses: {
        where: { deletedAt: null },
        include: {
          requestCourse: {
            include: {
              request: {
                select: {
                  id: true,
                  refNumber: true,
                  status: true,
                  createdAt: true,
                  preferredDateFrom: true,
                  preferredDateTo: true,
                  deletedAt: true,
                },
              },
              course: {
                select: { id: true, refNumber: true, title: true, code: true, passScore: true, deletedAt: true },
              },
              sessions: {
                where: { deletedAt: null },
                select: { id: true, refNumber: true, startDate: true, endDate: true, status: true },
                orderBy: { startDate: "asc" },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
    },
  });

  if (!trainee || trainee.deletedAt) return notFound("Trainee not found");
  if (user.role === "CONTRACTOR" && trainee.companyId !== user.companyId) {
    return notFound("Trainee not found");
  }

  // Trainers may only see trainees enrolled in their own sessions.
  const trainerId = trainerIdOf(user);
  if (trainerId) {
    const enrolledInOwnSession = await db.sessionEnrollment.count({
      where: { traineeId: id, session: { trainerId } },
    });
    if (enrolledInOwnSession === 0) return notFound("Trainee not found");
  }

  const [certificates, testResults] = await Promise.all([
    db.certificate.findMany({
      where: { traineeIdNational: trainee.nationalId, deletedAt: null, status: { not: "REVOKED" } },
      select: {
        id: true,
        refNumber: true,
        finalScore: true,
        issuedAt: true,
        validUntil: true,
        status: true,
        courseId: true,
        course: { select: { id: true, code: true, title: true } },
      },
      orderBy: { issuedAt: "desc" },
    }),
    db.testResult.findMany({
      where: { traineeIdNational: trainee.nationalId, testType: "FINAL_TEST", deletedAt: null },
      select: { sessionId: true, scorePercent: true, passed: true, attemptedAt: true },
    }),
  ]);

  const certByCourse = new Map(certificates.map((c) => [c.courseId, c]));
  const testBySession = new Map(testResults.map((t) => [t.sessionId, t]));

  const history = trainee.requestCourses
    .map((join) => {
      const rc = join.requestCourse;
      // Skip soft-deleted requests/courses and any pre-approval or
      // terminal/non-approved request — never surface an unapproved course.
      if (!rc || !rc.request || !rc.course) return null;
      if (rc.request.deletedAt || rc.course.deletedAt) return null;
      if (!VISIBLE_REQUEST_STATUSES.has(rc.request.status)) return null;
      const request = rc.request;
      const course = rc.course;
      const sessions = rc.sessions;
      const courseDate = sessions[0]?.startDate ?? request.preferredDateFrom ?? null;

      const cert = certByCourse.get(course.id);
      const test = sessions
        .map((s) => testBySession.get(s.id))
        .find((r): r is NonNullable<typeof r> => Boolean(r));

      let completionStatus = "NOT_STARTED";
      if (cert) {
        completionStatus = "COMPLETED";
      } else if (COMPLETION_BY_REQUEST_STATUS[request.status]) {
        completionStatus = COMPLETION_BY_REQUEST_STATUS[request.status];
      }

      let result: {
        source: "certificate" | "exam";
        score: number;
        passed: boolean;
        refNumber?: string;
        issuedAt?: string;
        validUntil?: string;
        attemptedAt?: string;
      } | null = null;

      if (cert) {
        result = {
          source: "certificate",
          score: cert.finalScore,
          passed: cert.finalScore >= course.passScore,
          refNumber: cert.refNumber,
          issuedAt: cert.issuedAt.toISOString(),
          validUntil: cert.validUntil.toISOString(),
        };
      } else if (test) {
        result = {
          source: "exam",
          score: test.scorePercent,
          passed: test.passed,
          attemptedAt: test.attemptedAt.toISOString(),
        };
      }

      return {
        id: rc.id,
        courseTitle: course.title,
        courseCode: course.code,
        requestRefNumber: request.refNumber,
        requestCreatedAt: request.createdAt.toISOString(),
        courseDate: courseDate ? courseDate.toISOString() : null,
        sessionCount: sessions.length,
        requestStatus: request.status,
        completionStatus,
        result,
      };
    })
    .filter((h): h is NonNullable<typeof h> => h !== null);

  const completed = history.filter((h) => h.completionStatus === "COMPLETED").length;
  const scheduled = history.filter((h) => h.completionStatus === "SCHEDULED").length;

  return ok({
    trainee: {
      id: trainee.id,
      refNumber: trainee.refNumber,
      fullName: trainee.fullName,
      nationalId: trainee.nationalId,
      nationality: trainee.nationality,
      jobTitle: trainee.jobTitle,
      mobile: trainee.mobile,
      email: trainee.email,
      status: trainee.status,
      companyId: trainee.companyId,
      companyName: trainee.company?.name ?? null,
      companyRefNumber: trainee.company?.refNumber ?? null,
      idAttachmentUrl: trainee.idAttachmentUrl,
    },
    identityDocuments: parseDocuments(trainee.documents),
    summary: {
      totalCourses: history.length,
      completedCourses: completed,
      scheduledCourses: scheduled,
      certificates: certificates.length,
    },
    history,
  });
});
