// /api/sessions/[id]/release-certificates — coordinator releases certificates to contractor
// =====================================================================
// POST: transitions all READY_FOR_RELEASE certificates in the session
// (optionally filtered by companyId) to RELEASED status.
//
// Requirements:
//   - Only COORDINATOR + SUPER_ADMIN can call this
//   - Each certificate must have releaseStatus === "READY_FOR_RELEASE"
//   - The checklist (invoice/attendance/exam/profession) must be satisfied
//
// Body: {
//   companyId?: string,   // optional: release only for this company
//   certificateIds?: string[],  // optional: release only these certificates
// }
//
// Returns: { released: number, skipped: number, results: [...] }
import { db } from "@/lib/db";
import { withAuth, ok, fail, notFound, audit } from "@/lib/auth/api";
import { canPerformAction } from "@/lib/auth/permissions";
import { computeReleaseChecklist, truncateForAudit } from "@/lib/certificates/release-checklist";
import { recordAudit } from "@/lib/auth/audit";

export const POST = withAuth(async ({ req, params, user }) => {
  const sessionId = params.id as string;

  // Only coordinators + super admins can release certificates
  if (user.role !== "COORDINATOR" && user.role !== "SUPER_ADMIN") {
    return fail("Only coordinators can release certificates", 403, "FORBIDDEN");
  }
  if (!canPerformAction(user.permissions, "certificates", "edit")) {
    return fail("You do not have permission to release certificates", 403, "FORBIDDEN");
  }

  const body = await req.json().catch(() => ({}));
  const { companyId, certificateIds } = body as { companyId?: string; certificateIds?: string[] };

  const session = await db.trainingSession.findFirst({
    where: { id: sessionId, deletedAt: null },
    select: { id: true, refNumber: true, title: true, courseId: true },
  });
  if (!session) return notFound("Session not found");

  // Fetch certificates to release
  const where: Record<string, unknown> = {
    sessionId,
    deletedAt: null,
    releaseStatus: { in: ["DRAFT", "READY_FOR_RELEASE"] },
  };
  if (companyId) where.companyId = companyId;
  if (certificateIds && certificateIds.length > 0) where.id = { in: certificateIds };

  const certs = await db.certificate.findMany({
    where,
    include: {
      course: { select: { title: true, requiresProfessionVerification: true } },
      company: { select: { name: true, refNumber: true } },
      session: { select: { refNumber: true } },
    },
  });

  if (certs.length === 0) {
    return fail("No certificates found that are eligible for release", 400, "NO_ELIGIBLE_CERTS");
  }

  const results: Array<{
    certificateId: string;
    certificateRef: string;
    traineeName: string;
    released: boolean;
    reason?: string;
  }> = [];

  const now = new Date();
  let releasedCount = 0;
  let skippedCount = 0;

  // Process each certificate
  for (const cert of certs) {
    // Compute the checklist to verify all prerequisites are met
    const checklist = await computeReleaseChecklist(cert.id);
    if (!checklist) {
      results.push({ certificateId: cert.id, certificateRef: cert.refNumber, traineeName: cert.traineeName, released: false, reason: "Checklist computation failed" });
      skippedCount++;
      continue;
    }

    if (!checklist.readyForRelease) {
      results.push({
        certificateId: cert.id,
        certificateRef: cert.refNumber,
        traineeName: cert.traineeName,
        released: false,
        reason: `Missing: ${checklist.missingRequirements.join(", ")}`,
      });
      skippedCount++;
      continue;
    }

    // ── Payment printing release check ────────────────────────────────────
    // Even if the invoice is paid, the coordinator must explicitly release
    // printing permission via /api/session-payments/[id]/release-printing.
    // This is the final administrative gate before certificates become
    // downloadable by the contractor.
    if (cert.companyId) {
      const sp = await db.sessionPayment.findUnique({
        where: { sessionId_companyId: { sessionId: cert.sessionId, companyId: cert.companyId } },
        select: { printingReleased: true },
      });
      if (sp && !sp.printingReleased) {
        results.push({
          certificateId: cert.id,
          certificateRef: cert.refNumber,
          traineeName: cert.traineeName,
          released: false,
          reason: "Printing not released by coordinator",
        });
        skippedCount++;
        continue;
      }
    }

    // Release the certificate
    await db.certificate.update({
      where: { id: cert.id },
      data: {
        releaseStatus: "RELEASED",
        releasedAt: now,
        releasedBy: user.id,
        updatedBy: user.id,
      },
    });
    releasedCount++;

    results.push({
      certificateId: cert.id,
      certificateRef: cert.refNumber,
      traineeName: cert.traineeName,
      released: true,
    });

    // Individual audit entry for each released certificate
    await recordAudit({
      userId: user.id,
      userRole: user.role,
      action: "ISSUE_CERT",
      entity: "CERTIFICATE",
      entityId: cert.id,
      entityRef: cert.refNumber,
      description: `Certificate ${cert.refNumber} released to ${cert.company?.name ?? "contractor"} by ${user.fullName}`,
      descriptionAr: `تم إصدار الشهادة ${cert.refNumber} إلى ${cert.company?.name ?? "المقاول"} بواسطة ${user.fullName}`,
      req,
      oldValue: { releaseStatus: cert.releaseStatus },
      newValue: { releaseStatus: "RELEASED", releasedAt: now, releasedBy: user.id },
      metadata: {
        aiGenerated: false,
        certificateRelease: true,
        coordinatorName: user.fullName,
        coordinatorId: user.id,
        contractorName: cert.company?.name,
        contractorRef: cert.company?.refNumber,
        course: cert.course.title,
        sessionRef: cert.session.refNumber,
        invoiceStatus: checklist.payment?.paymentStatus,
        invoiceAmount: checklist.payment?.totalAmount,
        paidAmount: checklist.payment?.paidAmount,
        professionVerified: checklist.items.find((i) => i.key === "profession_verified")?.passed ?? true,
        action: "Certificate Release Approved",
      },
    });
  }

  // Summary audit entry
  await audit({
    user,
    action: "ISSUE_CERT",
    entity: "SESSION",
    entityId: session.id,
    entityRef: session.refNumber,
    description: `Released ${releasedCount} certificate(s) for session ${session.refNumber} (${skippedCount} skipped)`,
    descriptionAr: `تم إصدار ${releasedCount} شهادة للجلسة ${session.refNumber} (${skippedCount} متخطى)`,
    req,
    metadata: {
      aiGenerated: false,
      certificateReleaseBatch: true,
      newValue: { released: releasedCount, skipped: skippedCount, results: truncateForAudit(results) },
    },
  });

  return ok({
    released: releasedCount,
    skipped: skippedCount,
    results,
  });
});
