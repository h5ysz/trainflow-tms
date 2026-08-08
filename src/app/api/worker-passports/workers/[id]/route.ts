// /api/worker-passports/workers/[id] — full worker passport (trainee-based).
//
// Identity fields + identity documents + the training history across every
// training request the worker was ever enrolled in. Each history row is one
// course inside one request, and carries:
//   - the live request status (drawn from TrainingRequest.status)
//   - the course completion state (derived: certificate exists, else request status)
//   - the course result when issued (certificate finalScore, else final-test result)
//
// Trainer evaluations are intentionally NOT included.
//
// Permissions: any role with `worker-passports.view`; contractors are scoped to
// their own company.
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound } from "@/lib/auth/api";

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

// Request status → completion state for a course that has no certificate yet.
const COMPLETION_BY_REQUEST_STATUS: Record<string, string> = {
  COMPLETED: "COMPLETED",
  IN_PROGRESS: "IN_PROGRESS",
  SCHEDULED: "SCHEDULED",
  APPROVED: "SCHEDULED",
};

export const GET = withModuleAction("worker-passports", "view", async ({ params, user }) => {
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

  if (!trainee || trainee.deletedAt) return notFound("Worker not found");
  if (user.role === "CONTRACTOR" && trainee.companyId !== user.companyId) {
    return notFound("Worker not found");
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
      // Skip soft-deleted requests/courses.
      if (!rc || !rc.request || !rc.course) return null;
      if (rc.request.deletedAt || rc.course.deletedAt) return null;
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
