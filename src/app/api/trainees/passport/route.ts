// /api/trainees/passport — digital training passport for a trainee
// =====================================================================
// Sprint 6: Training Passport
//
// Aggregates all certificates + training history for a single trainee into
// a single "passport" view.
//
// Query params (one of):
//   traineeEmail       — preferred
//   traineeIdNational  — alternative
//   traineeName        — fallback
//
// Returns:
//   - Trainee identity
//   - All active (valid + expiring-soon) certificates
//   - All expired certificates
//   - Full certificate history (renewal chains)
//   - Upcoming expiry dates (sorted by days-remaining)
//   - Verification status (verified / not verified)
//   - Training history (sessions attended)
//
// Permissions: SUPER_ADMIN / COORDINATOR see any trainee.
//              CONTRACTOR sees only trainees from their own company.
//              TRAINER sees any trainee (view-only).
import { db } from "@/lib/db";
import { withErrorEnvelope, requireAuth, ok, fail } from "@/lib/auth/api";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export const GET = withErrorEnvelope(async function GET(req: Request) {
  const user = await requireAuth();

  const url = new URL(req.url);
  const traineeEmail = url.searchParams.get("traineeEmail");
  const traineeIdNational = url.searchParams.get("traineeIdNational");
  const traineeName = url.searchParams.get("traineeName");

  if (!traineeEmail && !traineeIdNational && !traineeName) {
    return fail("One of traineeEmail, traineeIdNational, or traineeName is required", 422, "VALIDATION_ERROR");
  }

  // Build the trainee-identity filter
  const traineeWhere: Record<string, unknown> = { deletedAt: null };
  const or: Record<string, unknown>[] = [];
  if (traineeEmail) or.push({ traineeEmail });
  if (traineeIdNational) or.push({ traineeIdNational });
  if (traineeName) or.push({ traineeName: { equals: traineeName } });
  traineeWhere.OR = or;

  // Company scope
  if (user.role === "CONTRACTOR" && user.companyId) {
    traineeWhere.companyId = user.companyId;
  }

  // ── Fetch all certificates ─────────────────────────────────────────
  const certs = await db.certificate.findMany({
    where: traineeWhere,
    include: {
      course: { select: { id: true, code: true, title: true, durationHours: true, validityMonths: true } },
      company: { select: { id: true, name: true } },
      session: {
        select: {
          id: true,
          refNumber: true,
          startDate: true,
          endDate: true,
          trainer: { select: { fullName: true } },
        },
      },
    },
    orderBy: { issuedAt: "desc" },
  });

  if (certs.length === 0) {
    return ok({
      traineeEmail: traineeEmail ?? null,
      traineeIdNational: traineeIdNational ?? null,
      traineeName: traineeName ?? null,
      activeCertificates: [],
      expiredCertificates: [],
      upcomingExpiries: [],
      trainingHistory: [],
      verificationStatus: { totalVerifications: 0, lastVerifiedAt: null },
      summary: {
        totalCourses: 0,
        totalCertificates: 0,
        activeCount: 0,
        expiredCount: 0,
        expiringSoonCount: 0,
      },
    });
  }

  // ── Compute validity metadata for each cert ────────────────────────
  const now = new Date();
  const annotatedCerts = certs.map((c) => {
    const daysRemaining = Math.ceil((c.validUntil.getTime() - now.getTime()) / MS_PER_DAY);
    const isExpired = daysRemaining < 0;
    const isExpiringSoon = !isExpired && daysRemaining <= 30;
    const isActive = !isExpired && (c.status === "ISSUED" || c.status === "VALID" || c.status === "APPROVED");
    return {
      ...c,
      daysRemaining,
      isExpired,
      isExpiringSoon,
      isActive,
    };
  });

  // ── Categorize ─────────────────────────────────────────────────────
  const activeCertificates = annotatedCerts.filter((c) => c.isActive && !c.isExpiringSoon);
  const expiringSoonCertificates = annotatedCerts.filter((c) => c.isActive && c.isExpiringSoon);
  const expiredCertificates = annotatedCerts.filter((c) => c.isExpired || c.status === "EXPIRED");

  // Upcoming expiries: active certs sorted by daysRemaining ascending
  const upcomingExpiries = annotatedCerts
    .filter((c) => c.isActive)
    .sort((a, b) => a.daysRemaining - b.daysRemaining)
    .slice(0, 10)
    .map((c) => ({
      certificateId: c.id,
      refNumber: c.refNumber,
      courseTitle: c.course.title,
      validUntil: c.validUntil,
      daysRemaining: c.daysRemaining,
      isExpiringSoon: c.isExpiringSoon,
    }));

  // ── Training history: all sessions this trainee attended ───────────
  const traineeNameResolved = certs[0].traineeName;
  const traineeEmailResolved = certs[0].traineeEmail;
  const traineeIdResolved = certs[0].traineeIdNational;
  const companyIdResolved = certs[0].companyId;
  const companyNameResolved = certs[0].company?.name ?? null;

  // Find attendance records for this trainee
  const attendanceWhere: Record<string, unknown> = { deletedAt: null };
  const attOr: Record<string, unknown>[] = [];
  if (traineeEmailResolved) attOr.push({ traineeEmail: traineeEmailResolved });
  if (traineeIdResolved) attOr.push({ traineeIdNational: traineeIdResolved });
  attOr.push({ traineeName: { equals: traineeNameResolved } });
  attendanceWhere.OR = attOr;

  const attendances = await db.attendance.findMany({
    where: attendanceWhere,
    include: {
      session: {
        select: {
          id: true,
          refNumber: true,
          startDate: true,
          endDate: true,
          status: true,
          lifecycleStatus: true,
          course: { select: { id: true, code: true, title: true } },
          trainer: { select: { fullName: true } },
        },
      },
    },
    orderBy: { session: { startDate: "desc" } },
    take: 50,
  });

  const trainingHistory = attendances.map((a) => ({
    attendanceId: a.id,
    sessionRef: a.session.refNumber,
    sessionStartDate: a.session.startDate,
    sessionEndDate: a.session.endDate,
    sessionStatus: a.session.status,
    lifecycleStatus: a.session.lifecycleStatus,
    courseCode: a.session.course.code,
    courseTitle: a.session.course.title,
    trainerName: a.session.trainer?.fullName ?? null,
    attendanceStatus: a.status,
    checkInAt: a.checkInAt,
  }));

  // ── Verification status ────────────────────────────────────────────
  const totalVerifications = certs.reduce((sum, c) => sum + (c.verificationCount ?? 0), 0);
  const lastVerifiedAt = certs
    .map((c) => c.lastVerifiedAt)
    .filter(Boolean)
    .sort((a, b) => (b?.getTime() ?? 0) - (a?.getTime() ?? 0))[0];

  // ── Summary ────────────────────────────────────────────────────────
  const uniqueCourses = new Set(certs.map((c) => c.courseId));

  return ok({
    traineeEmail: traineeEmailResolved,
    traineeIdNational: traineeIdResolved,
    traineeName: traineeNameResolved,
    companyId: companyIdResolved,
    companyName: companyNameResolved,
    activeCertificates: activeCertificates.map((c) => ({
      id: c.id,
      refNumber: c.refNumber,
      courseCode: c.course.code,
      courseTitle: c.course.title,
      validityMonths: c.course.validityMonths,
      issuedAt: c.issuedAt,
      validUntil: c.validUntil,
      daysRemaining: c.daysRemaining,
      finalScore: c.finalScore,
      status: c.status,
      version: c.version ?? 1,
    })),
    expiringSoonCertificates: expiringSoonCertificates.map((c) => ({
      id: c.id,
      refNumber: c.refNumber,
      courseTitle: c.course.title,
      validUntil: c.validUntil,
      daysRemaining: c.daysRemaining,
    })),
    expiredCertificates: expiredCertificates.map((c) => ({
      id: c.id,
      refNumber: c.refNumber,
      courseTitle: c.course.title,
      validUntil: c.validUntil,
      daysSinceExpiry: Math.abs(c.daysRemaining),
      version: c.version ?? 1,
    })),
    upcomingExpiries,
    trainingHistory,
    verificationStatus: {
      totalVerifications,
      lastVerifiedAt,
    },
    summary: {
      totalCourses: uniqueCourses.size,
      totalCertificates: certs.length,
      activeCount: activeCertificates.length,
      expiringSoonCount: expiringSoonCertificates.length,
      expiredCount: expiredCertificates.length,
    },
  });
});
