// /api/exam-attempts — list exam attempts
import { db } from "@/lib/db";
import { withModuleAction, ok, fail } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { list } from "@/lib/api/response";

const ALLOWED_SORT_FIELDS = ["refNumber", "createdAt", "assignedAt", "startedAt", "submittedAt", "status", "scorePercent"];

export const GET = withModuleAction("pre-test", "view", async ({ req }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.filters.sessionId) where.sessionId = q.filters.sessionId;
  if (q.filters.testType) where.testType = q.filters.testType;
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

  return list(
    rows.map((a) => ({
      ...a,
      questionSet: a.questionSet ? JSON.parse(a.questionSet) : [],
      answers: a.answers ? JSON.parse(a.answers) : null,
    })),
    buildListMeta(total, q)
  );
});
