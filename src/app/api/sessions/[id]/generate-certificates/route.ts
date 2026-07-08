// /api/sessions/[id]/generate-certificates — bulk generate certificates for all eligible trainees
import { db } from "@/lib/db";
import { withModuleAction, ok, fail, audit } from "@/lib/auth/api";
import { checkCertificateEligibility } from "@/lib/api/certificate-eligibility";
import { nextRefNumber } from "@/lib/api/ref-number";
import { randomBytes } from "crypto";

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
        companyId: session.request?.companyId ?? null,
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

    results.push({
      traineeName: trainee.traineeName,
      eligible: true,
      certificateRef: cert.refNumber,
    });
    generated++;
  }

  await audit({
    user,
    action: "CERTIFICATE_GENERATE",
    entity: "CERTIFICATE",
    entityId: sessionId,
    entityRef: session.refNumber,
    description: `Bulk certificate generation: ${generated} issued, ${skipped} skipped for session ${session.refNumber}`,
    descriptionAr: `توليد جماعي للشهادات: ${generated} صادر، ${skipped} متخطى للجلسة ${session.refNumber}`,
    req,
    metadata: { generated, skipped, total: presentTrainees.length },
  });

  return ok({
    sessionRef: session.refNumber,
    totalTrainees: presentTrainees.length,
    generated,
    skipped,
    results,
  });
});
