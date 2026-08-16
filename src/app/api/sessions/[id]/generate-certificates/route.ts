// /api/sessions/[id]/generate-certificates — bulk generate certificates for all eligible trainees
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { checkCertificateEligibility } from "@/lib/api/certificate-eligibility";
import { nextRefNumber } from "@/lib/api/ref-number";
import { randomBytes } from "crypto";
import { linkCertificateToPassport } from "@/lib/worker/passport-service";
import { notifyResultsFinalized } from "@/lib/notifications/session-events";

function genVerificationToken(): string {
  return randomBytes(12).toString("hex");
}

export const POST = withModuleAction("certificates", "create", async ({ req, params, user }) => {
  const sessionId = params.id as string;

  const session = await db.trainingSession.findFirst({
    where: { id: sessionId, deletedAt: null },
    include: { course: true, request: { include: { company: true } } },
  });
  if (!session) return fail("Session not found", 404);
  if (!session.course) return fail("Course not found", 404);

  // Get all PRESENT trainees
  const presentTrainees = await db.attendance.findMany({
    where: {
      sessionId,
      status: "PRESENT",
      deletedAt: null,
    },
  });

  const results: Array<{
    traineeName: string;
    eligible: boolean;
    certificateRef?: string;
    passportId?: string | null;
    passportNumber?: string | null;
    reasons?: string[];
  }> = [];

  let generated = 0;
  let skipped = 0;

  for (const trainee of presentTrainees) {
    // Check if certificate already exists
    const existing = await db.certificate.findFirst({
      where: { sessionId, traineeName: trainee.traineeName, deletedAt: null },
    });
    if (existing) {
      results.push({
        traineeName: trainee.traineeName,
        eligible: true,
        certificateRef: existing.refNumber,
        reasons: ["Certificate already exists"],
      });
      skipped++;
      continue;
    }

    // Check eligibility
    const eligibility = await checkCertificateEligibility({
      sessionId,
      traineeName: trainee.traineeName,
      traineeIdNational: trainee.traineeIdNational ?? undefined,
    });

    if (!eligibility.eligible) {
      results.push({
        traineeName: trainee.traineeName,
        eligible: false,
        reasons: eligibility.reasons,
      });
      skipped++;
      continue;
    }

    // Get final test score
    const finalTestAttempt = await db.examAttempt.findFirst({
      where: {
        sessionId,
        testType: "FINAL_TEST",
        traineeName: trainee.traineeName,
        status: "GRADED",
        passed: true,
        deletedAt: null,
      },
      orderBy: { submittedAt: "desc" },
    });
    const finalScore = finalTestAttempt?.scorePercent ?? 0;

    const refNumber = await nextRefNumber("CERTIFICATE");
    const verificationToken = genVerificationToken();
    const validUntil = new Date();
    validUntil.setMonth(validUntil.getMonth() + session.course.validityMonths);

    const cert = await db.certificate.create({
      data: {
        refNumber,
        sessionId,
        courseId: session.courseId,
        companyId: trainee.companyId ?? session.request?.companyId ?? null, // MULTI-COMPANY: trainee's company
        attendanceId: trainee.id,
        traineeName: trainee.traineeName,
        traineeIdNational: trainee.traineeIdNational,
        traineeEmail: trainee.traineeEmail,
        finalScore,
        validUntil,
        status: "VALID",
        verificationToken,
        createdBy: user.id,
        updatedBy: user.id,
      },
    });

    // Link certificate to attendance
    await db.attendance.update({
      where: { id: trainee.id },
      data: { certificateId: cert.id, updatedBy: user.id },
    });

    // Auto-create / reuse Worker Passport and link the certificate to it.
    // Idempotent: same nationalId always resolves to the same passport.
    // Returns null only when the certificate has no nationalId (no key for passport).
    let passportId: string | null = null;
    let passportNumber: string | null = null;
    try {
      passportId = await linkCertificateToPassport(
        {
          id: cert.id,
          traineeName: cert.traineeName,
          traineeIdNational: cert.traineeIdNational,
          traineeEmail: cert.traineeEmail,
          companyId: cert.companyId,
        },
        user.id
      );

      if (passportId) {
        const passport = await db.workerPassport.findUnique({
          where: { id: passportId },
          select: { passportNumber: true },
        });
        passportNumber = passport?.passportNumber ?? null;

        await audit({
          user,
          action: "CERTIFICATE_GENERATE",
          entity: "WORKER_PASSPORT",
          entityId: passportId,
          entityRef: passportNumber ?? passportId,
          description: `Linked certificate ${cert.refNumber} to worker passport ${passportNumber ?? passportId} for ${cert.traineeName}`,
          descriptionAr: `ربط الشهادة ${cert.refNumber} بجواز العامل ${passportNumber ?? passportId} لـ ${cert.traineeName}`,
          req,
          metadata: {
            certificateId: cert.id,
            certificateRef: cert.refNumber,
            passportId,
            passportNumber,
            nationalId: cert.traineeIdNational,
          },
        });
      }
    } catch (e) {
      // Passport linkage must not roll back the certificate that was just issued.
      // Log the failure and continue; the certificate is valid on its own.
      console.error(
        `[generate-certificates] Failed to link certificate ${cert.refNumber} to worker passport:`,
        e
      );
    }

    results.push({
      traineeName: trainee.traineeName,
      eligible: true,
      certificateRef: cert.refNumber,
      passportId,
      passportNumber,
    });
    generated++;
  }

  const passportsLinked = results.filter((r) => r.passportId).length;

  await audit({
    user,
    action: "CERTIFICATE_GENERATE",
    entity: "CERTIFICATE",
    entityId: sessionId,
    entityRef: session.refNumber,
    description: `Bulk certificate generation: ${generated} issued, ${skipped} skipped, ${passportsLinked} passports linked for session ${session.refNumber}`,
    descriptionAr: `توليد جماعي للشهادات: ${generated} صادر، ${skipped} متخطى، ${passportsLinked} جواز مرتبط للجلسة ${session.refNumber}`,
    req,
    metadata: { generated, skipped, passportsLinked, total: presentTrainees.length },
  });

  // ── RESULTS_FINALIZED: results are confirmed when certificates are issued.
  //    Told to the contractors + coordinators once per session (deduped). ──
  if (generated > 0) {
    try {
      await notifyResultsFinalized(sessionId, { certificatesCount: generated });
    } catch (e) {
      console.error(`RESULTS_FINALIZED failed for session ${session.refNumber}:`, (e as Error).message);
    }
  }

  return ok({
    sessionRef: session.refNumber,
    totalTrainees: presentTrainees.length,
    generated,
    skipped,
    passportsLinked,
    results,
  });
});
