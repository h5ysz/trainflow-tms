// /api/certificates — list + issue (CERT-YYYY-000001 ref number, verification token, CERTIFICATE_GENERATE audit)
// Sprint 3: Certificate generation now requires:
//   1. Attendance completed (PRESENT)
//   2. Final Test passed
//   3. Course Evaluation submitted
import { db } from "@/lib/db";
import { withModuleAction, ok, created, fail, audit } from "@/lib/auth/api";
import { parseListQuery, buildListMeta, buildOrderBy, whereWithSoftDelete } from "@/lib/api/query";
import { nextRefNumber } from "@/lib/api/ref-number";
import { list } from "@/lib/api/response";
import { checkCertificateEligibility } from "@/lib/api/certificate-eligibility";
import { randomBytes } from "crypto";

const ALLOWED_SORT_FIELDS = ["refNumber", "traineeName", "issuedAt", "validUntil", "status", "finalScore"];

function genVerificationToken(): string {
  return randomBytes(12).toString("hex");
}

export const GET = withModuleAction("certificates", "view", async ({ req, user }) => {
  const q = parseListQuery(req);
  const where: Record<string, unknown> = whereWithSoftDelete({}, q.includeDeleted);

  if (q.search) {
    where.OR = [
      { refNumber: { contains: q.search } },
      { traineeName: { contains: q.search } },
      { traineeEmail: { contains: q.search } },
      { traineeIdNational: { contains: q.search } },
      { verificationToken: { contains: q.search } },
    ];
  }
  if (q.filters.status) where.status = q.filters.status;
  if (q.filters.sessionId) where.sessionId = q.filters.sessionId;
  if (q.filters.companyId) where.companyId = q.filters.companyId;
  if (q.filters.courseId) where.courseId = q.filters.courseId;

  // Contractors see only their company's certificates
  if (user.role === "CONTRACTOR" && user.companyId) {
    where.companyId = user.companyId;
  }

  const orderBy = buildOrderBy(q.sortBy, q.sortDir, ALLOWED_SORT_FIELDS, "issuedAt");

  const [rows, total] = await Promise.all([
    db.certificate.findMany({
      where,
      include: {
        session: {
          select: { id: true, refNumber: true, title: true, startDate: true, endDate: true },
        },
        course: { select: { id: true, title: true, code: true, refNumber: true } },
        company: { select: { id: true, name: true, refNumber: true } },
      },
      orderBy,
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.certificate.count({ where }),
  ]);

  return list(
    rows.map((c) => ({
      id: c.id,
      refNumber: c.refNumber,
      sessionId: c.sessionId,
      sessionRef: c.session?.refNumber ?? null,
      sessionCode: c.session?.refNumber ?? null,
      sessionTitle: c.session?.title ?? null,
      courseId: c.courseId,
      courseTitle: c.course?.title ?? null,
      courseCode: c.course?.code ?? null,
      courseRef: c.course?.refNumber ?? null,
      companyId: c.companyId,
      companyName: c.company?.name ?? null,
      companyRef: c.company?.refNumber ?? null,
      traineeName: c.traineeName,
      traineeIdNational: c.traineeIdNational,
      traineeEmail: c.traineeEmail,
      finalScore: c.finalScore,
      issuedAt: c.issuedAt,
      validUntil: c.validUntil,
      status: c.status,
      pdfUrl: c.pdfUrl,
      verificationToken: c.verificationToken,
      verificationCount: c.verificationCount,
      lastVerifiedAt: c.lastVerifiedAt,
    })),
    buildListMeta(total, q)
  );
});

export const POST = withModuleAction("certificates", "create", async ({ req, user }) => {
  const body = await req.json().catch(() => ({}));
  const { sessionId, traineeName, traineeIdNational, traineeEmail } = body;

  if (!sessionId || !traineeName) {
    return fail("sessionId and traineeName are required", 422, "VALIDATION_ERROR");
  }

  const session = await db.trainingSession.findFirst({
    where: { id: sessionId, deletedAt: null },
    include: { course: true, request: { include: { company: true } } },
  });
  if (!session) return fail("Session not found", 404);
  if (!session.course) return fail("Course not found", 404);

  // ─── Sprint 3: Enforce 3-condition eligibility ───────────────────────
  const eligibility = await checkCertificateEligibility({
    sessionId,
    traineeName,
    traineeEmail,
    traineeIdNational,
  });

  if (!eligibility.eligible) {
    return fail(
      "Certificate cannot be issued: trainee has not completed all required steps",
      422,
      "ELIGIBILITY_FAILED",
      {
        attendanceCompleted: eligibility.attendanceCompleted,
        finalTestPassed: eligibility.finalTestPassed,
        evaluationCompleted: eligibility.evaluationCompleted,
        reasons: eligibility.reasons,
      }
    );
  }

  // Get the final test score from the most recent passed attempt
  const finalTestAttempt = await db.examAttempt.findFirst({
    where: {
      sessionId,
      testType: "FINAL_TEST",
      traineeName: { equals: traineeName },
      status: "GRADED",
      passed: true,
      deletedAt: null,
    },
    orderBy: { submittedAt: "desc" },
  });
  const finalScore = finalTestAttempt?.scorePercent ?? 0;

  // MULTI-COMPANY: Use the TRAINEE's company from the attendance record,
  // NOT the session's owning company. This preserves the trainee's original company
  // even when multiple companies participate in the same session.
  const attendanceForCompany = await db.attendance.findFirst({
    where: {
      sessionId,
      traineeName: { equals: traineeName },
      deletedAt: null,
    },
    select: { companyId: true },
  });
  const certificateCompanyId = attendanceForCompany?.companyId ?? session.request?.companyId ?? null;

  // Check pass score
  if (finalScore < session.course.passScore) {
    return fail(`Score ${finalScore}% is below passing score ${session.course.passScore}%`, 400);
  }

  // Prevent duplicate
  const existing = await db.certificate.findFirst({
    where: { sessionId, traineeName: { equals: traineeName }, deletedAt: null },
  });
  if (existing) {
    return fail("Certificate already issued for this trainee in this session", 400, "DUPLICATE_CERTIFICATE");
  }

  const refNumber = await nextRefNumber("CERTIFICATE");
  const verificationToken = genVerificationToken();

  const validUntil = new Date();
  validUntil.setMonth(validUntil.getMonth() + session.course.validityMonths);

  const cert = await db.certificate.create({
    data: {
      refNumber,
      sessionId,
      courseId: session.courseId,
      companyId: certificateCompanyId, // MULTI-COMPANY: trainee's company, not session's
      attendanceId: eligibility.attendanceId ?? null,
      traineeName,
      traineeIdNational: traineeIdNational ?? null,
      traineeEmail: traineeEmail ?? null,
      finalScore,
      validUntil,
      status: "VALID",
      verificationToken,
      createdBy: user.id,
      updatedBy: user.id,
    },
  });

  // Update attendance: link certificate
  if (eligibility.attendanceId) {
    await db.attendance.update({
      where: { id: eligibility.attendanceId },
      data: { certificateId: cert.id, updatedBy: user.id },
    });
  }

  // Audit: CERTIFICATE_GENERATE
  await audit({
    user,
    action: "CERTIFICATE_GENERATE",
    entity: "CERTIFICATE",
    entityId: cert.id,
    entityRef: cert.refNumber,
    description: `Issued certificate ${cert.refNumber} to ${traineeName} (${finalScore}%) — all eligibility conditions met`,
    descriptionAr: `تم إصدار شهادة ${cert.refNumber} لـ ${traineeName} (${finalScore}%) — استيفاء جميع شروط الأهلية`,
    req,
    metadata: {
      sessionId,
      courseId: session.courseId,
      verificationToken,
      finalScore,
      attendanceId: eligibility.attendanceId,
      finalTestAttemptId: finalTestAttempt?.id,
      evaluationId: eligibility.evaluationId,
    },
  });

  return created(cert);
});
