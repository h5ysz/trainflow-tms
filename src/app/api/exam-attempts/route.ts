// /api/exam-attempts — list exam attempts
import { db } from "@/lib/db";
import { withExamAction, isExamResultsOnly, testTypeWhere, fail } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";
import { parseJsonColumn } from "@/lib/api/json-column";
import { trainerSessionFilter } from "@/lib/api/trainer-scope";

const ALLOWED_SORT_FIELDS = ["refNumber", "createdAt", "assignedAt", "startedAt", "submittedAt", "status", "scorePercent"];

export const GET = withExamAction("view", async ({ req, user, allowedTestTypes }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.filters.sessionId) where.sessionId = q.filters.sessionId;
  // Never widen beyond what the caller's permissions allow.
  const testType = testTypeWhere(q.filters.testType, allowedTestTypes);
  if (testType === null) return fail(`Forbidden — no access to ${q.filters.testType} attempts`, 403);
  where.testType = testType;
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.attendanceId) where.attendanceId = q.filters.attendanceId;
  if (q.filters.traineeEmail) where.traineeEmail = q.filters.traineeEmail;

  if (q.search) {
    where.OR = [
      { refNumber: { contains: q.search } },
      { traineeName: { contains: q.search } },
      { traineeEmail: { contains: q.search } },
    ];
  }

  // A trainer may only see attempts from their own sessions.
  const trainerSession = trainerSessionFilter(user);
  if (trainerSession) where.session = trainerSession.session;

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "assignedAt");

  const [rows, total] = await Promise.all([
    db.examAttempt.findMany({
      where,
      include: {
        session: {
          select: {
            id: true, refNumber: true, title: true,
            course: { select: { id: true, title: true, code: true, refNumber: true } },
          },
        },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.examAttempt.count({ where }),
  ]);

  const resultsOnly = isExamResultsOnly(user);

  return list(
    rows.map((a) => ({
      ...a,
      // A results-only caller (coordinator) may see scores but never the
      // question content itself.
      questionSet: resultsOnly ? [] : parseJsonColumn(a.questionSet, [], "examAttempt.questionSet"),
      answers: resultsOnly ? null : parseJsonColumn(a.answers, null, "examAttempt.answers"),
    })),
    buildListMeta(total, q)
  );
});
