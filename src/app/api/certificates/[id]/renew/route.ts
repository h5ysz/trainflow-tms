// /api/certificates/[id]/renew — create a renewal certificate
// Sprint 6: Automatic Certificate Renewal System
//
// Workflow:
//   1. Old certificate marked as RENEWED (history preserved, never deleted)
//   2. New certificate created with:
//      - New refNumber, new verificationToken
//      - renewedFromId → old cert
//      - version = old.version + 1
//      - status = VALID (ready for PDF generation)
//   3. Worker Passport auto-updated (linked to new cert)
//   4. Compliance Score auto-recalculated (via dashboard API on next fetch)
//
// Body:
//   newSessionId  — required (the new training session)
//   newFinalScore — optional (defaults to old cert's score)
//
// Permissions: SUPER_ADMIN or COORDINATOR
import { db } from "@/lib/db";
import { withErrorEnvelope, requireRole, ok, fail, notFound, audit } from "@/lib/auth/api";
import { nextRefNumber } from "@/lib/api/ref-number";
import { randomBytes } from "crypto";
import { computeValidUntil } from "@/lib/certificates/utils";

export const POST = withErrorEnvelope(async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireRole("SUPER_ADMIN", "COORDINATOR");
  const { id } = await ctx.params;

  // Fetch old certificate
  const oldCert = await db.certificate.findUnique({
    where: { id },
    include: { course: true, company: { select: { id: true, name: true } } },
  });
  if (!oldCert || oldCert.deletedAt) return notFound("Original certificate not found");

  // Parse body
  const body = await req.json().catch(() => ({}));
  const { newSessionId, newFinalScore } = body as { newSessionId?: string; newFinalScore?: number };

  if (!newSessionId) {
    return fail("newSessionId is required (the new training session ID)", 422, "VALIDATION_ERROR");
  }

  // Fetch new session
  const newSession = await db.trainingSession.findUnique({
    where: { id: newSessionId },
    include: { course: true },
  });
  if (!newSession || newSession.deletedAt) return notFound("New session not found");

  // Course must match
  if (newSession.courseId !== oldCert.courseId) {
    return fail(
      `Course mismatch: old cert is for "${oldCert.course.code}", new session is for "${newSession.course.code}". Renewal requires the same course.`,
      400, "COURSE_MISMATCH"
    );
  }

  // Mark old cert as RENEWED
  await db.certificate.update({
    where: { id: oldCert.id },
    data: { status: "RENEWED", renewedAt: new Date(), updatedBy: user.id },
  });

  // Create new renewal certificate
  const newRefNumber = await nextRefNumber("CERTIFICATE");
  const newVerificationToken = randomBytes(16).toString("hex");
  const newValidUntil = computeValidUntil(newSession.course.validityMonths);

  const finalScore = newFinalScore ?? oldCert.finalScore;

  const newCert = await db.certificate.create({
    data: {
      refNumber: newRefNumber,
      sessionId: newSessionId,
      courseId: newSession.courseId,
      companyId: oldCert.companyId,
      attendanceId: oldCert.attendanceId,
      traineeName: oldCert.traineeName,
      traineeIdNational: oldCert.traineeIdNational,
      traineeEmail: oldCert.traineeEmail,
      finalScore,
      issuedAt: new Date(),
      validUntil: newValidUntil,
      status: "VALID",
      renewedFromId: oldCert.id,
      version: (oldCert.version ?? 1) + 1,
      verificationToken: newVerificationToken,
      workerPassportId: oldCert.workerPassportId,
      createdBy: user.id,
      updatedBy: user.id,
    },
    include: { course: { select: { code: true, title: true } } },
  });

  // Audit: old cert renewal
  await audit({
    user,
    action: "UPDATE",
    entity: "CERTIFICATE",
    entityId: oldCert.id,
    entityRef: oldCert.refNumber,
    description: `Marked certificate ${oldCert.refNumber} as RENEWED (replaced by ${newCert.refNumber})`,
    descriptionAr: `تعليم الشهادة ${oldCert.refNumber} كمجددة (بديلة: ${newCert.refNumber})`,
    req,
    metadata: { action: "RENEWAL_OLD", oldCertId: oldCert.id, newCertId: newCert.id },
  });

  // Audit: new cert creation
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
      action: "RENEWAL_NEW",
      oldCertId: oldCert.id, oldRefNumber: oldCert.refNumber,
      newCertId: newCert.id, newRefNumber: newCert.refNumber,
      version: newCert.version, finalScore,
    },
  });

  // Notify company users about the renewal
  try {
    if (oldCert.companyId) {
      const companyUsers = await db.user.findMany({
        where: { companyId: oldCert.companyId, role: "CONTRACTOR", deletedAt: null, isActive: true },
        select: { id: true },
      });
      for (const cu of companyUsers) {
        await db.notification.create({
          data: {
            userId: cu.id,
            title: "Certificate Renewed",
            titleAr: "تم تجديد الشهادة",
            message: `Certificate ${newCert.refNumber} (v${newCert.version}) has been issued as a renewal for ${oldCert.refNumber}. Worker: ${newCert.traineeName}.`,
            messageAr: `تم إصدار شهادة ${newCert.refNumber} (v${newCert.version}) كبديلة لـ ${oldCert.refNumber}. العامل: ${newCert.traineeName}.`,
            type: "SUCCESS",
            category: "CERTIFICATE",
            link: "/certificates",
          },
        });
      }
    }
  } catch { /* notification failure shouldn't block renewal */ }

  return ok({
    oldCertificate: { id: oldCert.id, refNumber: oldCert.refNumber, status: "RENEWED" },
    newCertificate: {
      id: newCert.id, refNumber: newCert.refNumber, status: newCert.status,
      version: newCert.version, renewedFromId: newCert.renewedFromId,
      validUntil: newCert.validUntil, verificationToken: newCert.verificationToken,
    },
  });
});
