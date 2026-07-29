// /api/certificates/[id]/renew — create a renewal certificate from an expired/expiring one
// =====================================================================
// Sprint 6: Renewal Management
//
// Workflow:
//   1. Old certificate (expired or expiring soon) is marked as EXPIRED
//   2. New certificate is created with:
//      - New refNumber (GCCLAB-ES-YYYY-NNNNNN)
//      - New verificationToken (new QR code)
//      - renewedFromId → old cert
//      - version = old.version + 1
//      - status = PENDING_APPROVAL (new approval workflow)
//   3. Old certificate remains archived (never deleted)
//
// Prerequisites:
//   - Old certificate must exist
//   - A new session + attendance + final test + evaluation must already exist
//     for the trainee (this endpoint does NOT re-run the training pipeline —
//     it assumes the trainee has completed the renewal training)
//
// Body:
//   newSessionId  — required (the new training session that earned this renewal)
//   newFinalScore — optional (defaults to old cert's finalScore if not provided)
//
// Permissions: SUPER_ADMIN or COORDINATOR
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, fail, notFound, audit } from "@/lib/auth/api";
import { nextRefNumber } from "@/lib/api/ref-number";
import { syncCertificateStatus } from "@/lib/api/enrollment-sync";
import { checkCertificateEligibility } from "@/lib/api/certificate-eligibility";
import { randomBytes } from "crypto";

export const POST = withErrorEnvelope(async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SUPER_ADMIN", "COORDINATOR");
  const { id } = await ctx.params;

  // ── Fetch the old certificate ──────────────────────────────────────
  const oldCert = await db.certificate.findUnique({
    where: { id },
    include: {
      course: true,
      company: { select: { id: true, name: true } },
    },
  });
  if (!oldCert || oldCert.deletedAt) return notFound("Original certificate not found");

  // ── Parse body ─────────────────────────────────────────────────────
  const body = await req.json().catch(() => ({}));
  const { newSessionId, newFinalScore, newAttendanceId } = body as {
    newSessionId?: string;
    newFinalScore?: number;
    newAttendanceId?: string;
  };

  if (!newSessionId) {
    return fail("newSessionId is required (the new training session ID)", 422, "VALIDATION_ERROR");
  }

  // ── Fetch the new session ──────────────────────────────────────────
  const newSession = await db.trainingSession.findUnique({
    where: { id: newSessionId },
    include: { course: true },
  });
  if (!newSession || newSession.deletedAt) return notFound("New session not found");

  // Course should match (renewal of an electrical safety cert → electrical safety course)
  if (newSession.courseId !== oldCert.courseId) {
    return fail(
      `Course mismatch: old certificate is for course "${oldCert.course.code}", new session is for "${newSession.course.code}". Renewal requires the same course.`,
      400,
      "COURSE_MISMATCH"
    );
  }

  // ── Verify eligibility for the new certificate ─────────────────────
  const eligibility = await checkCertificateEligibility({
    sessionId: newSessionId,
    traineeName: oldCert.traineeName,
    traineeEmail: oldCert.traineeEmail ?? undefined,
    traineeIdNational: oldCert.traineeIdNational ?? undefined,
  });

  if (!eligibility.eligible) {
    return fail(
      `Renewal certificate cannot be issued: ${eligibility.reasons.join(", ")}`,
      400,
      "ELIGIBILITY_FAILED",
      { reasons: eligibility.reasons }
    );
  }

  // ── Mark old certificate as EXPIRED (archived, never deleted) ──────
  await db.certificate.update({
    where: { id: oldCert.id },
    data: {
      status: "EXPIRED",
      updatedBy: user.id,
    },
  });

  // ── Create the new (renewal) certificate ───────────────────────────
  const newRefNumber = await nextRefNumber("CERTIFICATE");
  const newVerificationToken = randomBytes(16).toString("hex");
  const newValidUntil = new Date();
  newValidUntil.setMonth(newValidUntil.getMonth() + newSession.course.validityMonths);

  const finalScore = newFinalScore ?? oldCert.finalScore;

  const newCert = await db.certificate.create({
    data: {
      refNumber: newRefNumber,
      sessionId: newSessionId,
      courseId: newSession.courseId,
      companyId: oldCert.companyId,
      attendanceId: newAttendanceId ?? eligibility.attendanceId ?? null,
      traineeName: oldCert.traineeName,
      traineeIdNational: oldCert.traineeIdNational,
      traineeEmail: oldCert.traineeEmail,
      finalScore,
      issuedAt: new Date(),
      validUntil: newValidUntil,
      status: "PENDING_APPROVAL", // goes through the full approval workflow
      renewedFromId: oldCert.id,
      version: (oldCert.version ?? 1) + 1,
      verificationToken: newVerificationToken,
      createdBy: user.id,
      updatedBy: user.id,
    },
    include: {
      course: { select: { code: true, title: true } },
    },
  });

  // ── Sync enrollment ────────────────────────────────────────────────
  await syncCertificateStatus({
    sessionId: newSessionId,
    traineeName: oldCert.traineeName,
    traineeIdNational: oldCert.traineeIdNational ?? undefined,
    attendanceId: newAttendanceId ?? eligibility.attendanceId ?? undefined,
    status: "GENERATED",
    userId: user.id,
  });

  // ── Audit: both the old cert expiry + the new cert renewal ─────────
  await audit({
    user,
    action: "UPDATE",
    entity: "CERTIFICATE",
    entityId: oldCert.id,
    entityRef: oldCert.refNumber,
    description: `Marked certificate ${oldCert.refNumber} as EXPIRED (renewed by ${newCert.refNumber})`,
    descriptionAr: `تم تعليم الشهادة ${oldCert.refNumber} كمنتهية (تم تجديدها بـ ${newCert.refNumber})`,
    req,
    metadata: {
      action: "RENEWAL_EXPIRE_OLD",
      oldCertId: oldCert.id,
      newCertId: newCert.id,
    },
  });

  await audit({
    user,
    action: "CREATE",
    entity: "CERTIFICATE",
    entityId: newCert.id,
    entityRef: newCert.refNumber,
    description: `Created renewal certificate ${newCert.refNumber} (v${newCert.version}) for ${newCert.traineeName} — replaces ${oldCert.refNumber}`,
    descriptionAr: `إنشاء شهادة تجديد ${newCert.refNumber} (v${newCert.version}) لـ ${newCert.traineeName} — بديلة لـ ${oldCert.refNumber}`,
    req,
    metadata: {
      action: "RENEWAL_CREATE_NEW",
      oldCertId: oldCert.id,
      oldRefNumber: oldCert.refNumber,
      newCertId: newCert.id,
      newRefNumber: newCert.refNumber,
      version: newCert.version,
      finalScore,
    },
  });

  // ── Notify coordinators (same as new cert) ─────────────────────────
  try {
    const coordinators = await db.user.findMany({
      where: { role: "COORDINATOR", deletedAt: null, isActive: true },
      select: { id: true },
    });
    for (const coord of coordinators) {
      await db.notification.create({
        data: {
          userId: coord.id,
          title: "Renewal Certificate Waiting for Approval",
          titleAr: "شهادة تجديد بانتظار الاعتماد",
          message: `Renewal certificate ${newCert.refNumber} (v${newCert.version}) for ${newCert.traineeName} is ready for review.`,
          messageAr: `شهادة التجديد ${newCert.refNumber} (v${newCert.version}) لـ ${newCert.traineeName} بانتظار المراجعة.`,
          type: "INFO",
          category: "CERTIFICATE",
          link: `/certificates`,
        },
      });
    }
  } catch {
    // notification failure shouldn't block the renewal
  }

  return ok({
    oldCertificate: {
      id: oldCert.id,
      refNumber: oldCert.refNumber,
      status: "EXPIRED",
    },
    newCertificate: {
      id: newCert.id,
      refNumber: newCert.refNumber,
      status: newCert.status,
      version: newCert.version,
      renewedFromId: newCert.renewedFromId,
      validUntil: newCert.validUntil,
      verificationToken: newCert.verificationToken,
    },
  });
});
