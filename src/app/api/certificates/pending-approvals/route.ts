// /api/certificates/pending-approvals — list certificates waiting for approval
// =====================================================================
// Sprint 6: Coordinator dashboard — queue of PENDING_APPROVAL certificates.
//
// Returns certificates with status=PENDING_APPROVAL, sorted oldest-first
// (so coordinators see the longest-waiting at the top).
//
// Query params:
//   sessionId  — filter by session
//   courseId   — filter by course
//   companyId  — filter by company (coordinators may want to scope)
//
// Permissions: SUPER_ADMIN or COORDINATOR
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok } from "@/lib/auth/api";

export const GET = withErrorEnvelope(async function GET(req: Request) {
  await requireRole("SUPER_ADMIN", "COORDINATOR");

  const url = new URL(req.url);
  const sessionId = url.searchParams.get("sessionId");
  const courseId = url.searchParams.get("courseId");
  const companyId = url.searchParams.get("companyId");

  const where: Record<string, unknown> = {
    status: "PENDING_APPROVAL",
    deletedAt: null,
  };
  if (sessionId) where.sessionId = sessionId;
  if (courseId) where.courseId = courseId;
  if (companyId) where.companyId = companyId;

  const certs = await db.certificate.findMany({
    where,
    include: {
      course: { select: { id: true, code: true, title: true, titleAr: true } },
      session: { select: { id: true, refNumber: true, startDate: true, endDate: true } },
      company: { select: { id: true, name: true, refNumber: true } },
    },
    orderBy: [{ issuedAt: "asc" }, { createdAt: "asc" }],
    take: 200, // safety cap
  });

  return ok({
    count: certs.length,
    certificates: certs,
  });
});
