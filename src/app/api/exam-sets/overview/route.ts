// /api/exam-sets/overview — sessions with the state of their exam question sets.
// Powers the standalone "Exam Questions" manager so a trainer can prepare (and
// approve) a session's questions days before the exam, without opening the
// session page. Read-only: generation/approval still happen through the
// per-session endpoints.
import { db } from "@/lib/db";
import { withExamAction, ok } from "@/lib/auth/api";
import { whereWithSoftDelete } from "@/lib/api/query";
import { scopeSessionList } from "@/lib/api/trainer-scope";

type TestType = "PRE_TEST" | "FINAL_TEST";

const TEST_TYPES: TestType[] = ["PRE_TEST", "FINAL_TEST"];

export const GET = withExamAction("view", async ({ user }) => {
  const where: Record<string, unknown> = whereWithSoftDelete({}, false);
  // A trainer only ever sees their OWN sessions — the scope derives from the
  // authenticated user, never from a client-supplied filter.
  scopeSessionList(where, user);

  const sessions = await db.trainingSession.findMany({
    where,
    select: {
      id: true,
      refNumber: true,
      title: true,
      status: true,
      startDate: true,
      endDate: true,
      trainerId: true,
      course: { select: { id: true, code: true, title: true } },
      examSets: {
        select: {
          id: true,
          testType: true,
          status: true,
          version: true,
          numQuestions: true,
          approvedAt: true,
          createdAt: true,
        },
        where: { deletedAt: null },
      },
    },
    orderBy: [{ startDate: "desc" }],
  });

  const summaryFor = (s: (typeof sessions)[number], tt: TestType) => {
    const sets = s.examSets.filter((x) => x.testType === tt);
    const approved =
      sets
        .filter((x) => x.status === "APPROVED")
        .sort((a, b) => (b.approvedAt?.getTime() ?? 0) - (a.approvedAt?.getTime() ?? 0))[0] ?? null;
    const draft =
      sets
        .filter((x) => x.status === "DRAFT")
        .sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0))[0] ?? null;
    return {
      state: approved ? ("APPROVED" as const) : draft ? ("DRAFT" as const) : ("NONE" as const),
      approved: approved
        ? { id: approved.id, version: approved.version, numQuestions: approved.numQuestions, approvedAt: approved.approvedAt }
        : null,
      draft: draft ? { id: draft.id, version: draft.version, numQuestions: draft.numQuestions } : null,
    };
  };

  return ok({
    sessions: sessions.map((s) => ({
      id: s.id,
      refNumber: s.refNumber,
      title: s.title,
      status: s.status,
      startDate: s.startDate,
      endDate: s.endDate,
      trainerId: s.trainerId,
      course: s.course
        ? { id: s.course.id, code: s.course.code, title: s.course.title }
        : null,
      sets: Object.fromEntries(
        TEST_TYPES.map((tt) => [tt, summaryFor(s, tt)])
      ),
    })),
  });
});
