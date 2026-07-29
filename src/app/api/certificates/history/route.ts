// /api/certificates/history — full renewal chain for a trainee
// Sprint 6: Certificate History
//
// Query params (one of): traineeEmail, traineeIdNational, traineeName
// Returns all certs grouped by course, showing the renewal chain.
import { db } from "@/lib/db";
import { withErrorEnvelope, requireAuth, ok, fail } from "@/lib/auth/api";

export const GET = withErrorEnvelope(async function GET(req: Request) {
  const user = await requireAuth();

  const url = new URL(req.url);
  const traineeEmail = url.searchParams.get("traineeEmail");
  const traineeIdNational = url.searchParams.get("traineeIdNational");
  const traineeName = url.searchParams.get("traineeName");

  if (!traineeEmail && !traineeIdNational && !traineeName) {
    return fail("One of traineeEmail, traineeIdNational, or traineeName is required", 422, "VALIDATION_ERROR");
  }

  const traineeWhere: Record<string, unknown> = { deletedAt: null };
  const or: Record<string, unknown>[] = [];
  if (traineeEmail) or.push({ traineeEmail });
  if (traineeIdNational) or.push({ traineeIdNational });
  if (traineeName) or.push({ traineeName: { equals: traineeName } });
  traineeWhere.OR = or;

  if (user.role === "CONTRACTOR" && user.companyId) {
    traineeWhere.companyId = user.companyId;
  }

  const certs = await db.certificate.findMany({
    where: traineeWhere,
    include: {
      course: { select: { id: true, code: true, title: true, validityMonths: true } },
      company: { select: { id: true, name: true } },
      session: { select: { id: true, refNumber: true, startDate: true, endDate: true, trainer: { select: { fullName: true } } } },
      renewedFrom: { select: { id: true, refNumber: true, version: true, validUntil: true, status: true } },
    },
    orderBy: [{ courseId: "asc" }, { issuedAt: "desc" }],
  });

  // Group by course to show renewal chains
  const byCourse = new Map<string, typeof certs>();
  for (const c of certs) {
    const list = byCourse.get(c.courseId) ?? [];
    list.push(c);
    byCourse.set(c.courseId, list);
  }

  return ok({
    traineeEmail: traineeEmail ?? certs[0]?.traineeEmail ?? null,
    traineeIdNational: traineeIdNational ?? certs[0]?.traineeIdNational ?? null,
    traineeName: traineeName ?? certs[0]?.traineeName ?? null,
    totalCertificates: certs.length,
    certificates: certs.map((c) => ({
      id: c.id,
      refNumber: c.refNumber,
      version: c.version ?? 1,
      status: c.status,
      issuedAt: c.issuedAt,
      validUntil: c.validUntil,
      renewedAt: c.renewedAt,
      courseCode: c.course.code,
      courseTitle: c.course.title,
      companyName: c.company?.name ?? null,
      trainerName: c.session.trainer?.fullName ?? null,
      renewedFrom: c.renewedFrom
        ? { id: c.renewedFrom.id, refNumber: c.renewedFrom.refNumber, version: c.renewedFrom.version ?? 1 }
        : null,
    })),
    byCourse: Array.from(byCourse.entries()).map(([courseId, certList]) => ({
      courseId,
      courseCode: certList[0].course.code,
      courseTitle: certList[0].course.title,
      validityMonths: certList[0].course.validityMonths,
      chain: certList
        .sort((a, b) => (a.version ?? 1) - (b.version ?? 1))
        .map((c) => ({
          id: c.id,
          refNumber: c.refNumber,
          version: c.version ?? 1,
          status: c.status,
          issuedAt: c.issuedAt,
          validUntil: c.validUntil,
          renewedAt: c.renewedAt,
          renewedFrom: c.renewedFrom
            ? { id: c.renewedFrom.id, refNumber: c.renewedFrom.refNumber, version: c.renewedFrom.version ?? 1 }
            : null,
        })),
    })),
  });
});
