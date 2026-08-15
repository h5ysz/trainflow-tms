// /api/requests/[id]/session-status — per-session trainee status (attendance +
// final-test result) for the full-screen course display on training requests.
//
// Authorized with `requests.view` so a CONTRACTOR (المقاول) can open their own
// request on the big screen even though they lack `sessions.view`. Contractors
// are scoped to their own request AND only see enrollments of trainees from
// their own company inside (possibly multi-company) sessions; coordinators and
// admins see every enrollment of the request's sessions.
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail } from "@/lib/auth/api";
import { groupEnrollmentsBySession } from "@/lib/sessions/session-status-board";

export const GET = withModuleAction("requests", "view", async ({ params, user }) => {
  const id = params.id as string;

  const request = await db.trainingRequest.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, companyId: true },
  });
  if (!request) return notFound("Request not found");

  // RBAC: contractor sees only their own request.
  if (user.role === "CONTRACTOR" && user.companyId !== request.companyId) {
    return fail("Forbidden", 403);
  }

  const sessions = await db.trainingSession.findMany({
    where: { requestId: id, deletedAt: null },
    select: {
      id: true,
      refNumber: true,
      title: true,
      startDate: true,
      endDate: true,
      shift: true,
      status: true,
    },
    orderBy: { startDate: "asc" },
  });

  const sessionIds = sessions.map((s) => s.id);

  const enrollments = await db.sessionEnrollment.findMany({
    where:
      user.role === "CONTRACTOR" && user.companyId
        ? { sessionId: { in: sessionIds }, deletedAt: null, companyId: user.companyId }
        : { sessionId: { in: sessionIds }, deletedAt: null },
    select: {
      id: true,
      sessionId: true,
      attendanceStatus: true,
      finalTestStatus: true,
      enrollmentStatus: true,
      trainee: {
        select: {
          id: true,
          refNumber: true,
          fullName: true,
          nationalId: true,
          nationality: true,
          jobTitle: true,
          mobile: true,
          email: true,
        },
      },
      company: { select: { id: true, name: true, refNumber: true } },
    },
    orderBy: { enrollmentDate: "asc" },
  });

  return ok({ sessions: groupEnrollmentsBySession(sessions, enrollments) });
});
