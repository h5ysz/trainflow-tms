// /api/sessions/[id]/enrollments/[enrollmentId]/trainer-opportunity
// ====================================================================
// Marks the trainer opportunity as used on the enrollment. This is NOT
// a RetestRequest — per business rules, the trainer opportunity:
//   - Does NOT create a Retest record
//   - Does NOT notify the contractor
//   - Does NOT change the session or training request
//   - Is allowed ONLY once per enrollment
//   - Is available ONLY to the assigned trainer of the session
//   - Is available ONLY before session status = COMPLETED
//
// POST: mark the opportunity as used (sets trainerOpportunityUsed=true).
//   Body: { passed: boolean, scorePercent?: number }
//   - The trainer records whether the trainee passed or failed the
//     immediate opportunity. If passed, the normal certificate workflow
//     continues. If failed, the trainee becomes "Awaiting Official Retest".
//
// RBAC:
//   - TRAINER: allowed ONLY if they are the assigned trainer of the session.
//   - COORDINATOR / SUPER_ADMIN: always allowed.
//   - CONTRACTOR: blocked (no sessions.edit permission).
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { withModuleAction, ok, notFound, fail } from "@/lib/auth/api";
import { recalcCertificateEligibility } from "@/lib/api/enrollment-sync";
import { isTestTrainer } from "@/lib/api/trainer-scope";

export const POST = withModuleAction("sessions", "edit", async ({ req, params, user }) => {
  const sessionId = params.id as string;
  const enrollmentId = params.enrollmentId as string;
  const body = await req.json().catch(() => ({}));
  const { passed, scorePercent } = body;

  if (passed === undefined) {
    return fail("passed is required (true/false)", 422, "VALIDATION_ERROR");
  }

  // Fetch the enrollment + session (with trainerId for RBAC check)
  // + trainee (for certificate eligibility lookup)
  const enrollment = await db.sessionEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      session: {
        select: { id: true, refNumber: true, trainerId: true, status: true, lifecycleStatus: true },
      },
      trainee: {
        select: { id: true, fullName: true, nationalId: true },
      },
    },
  });

  if (!enrollment || enrollment.deletedAt || enrollment.sessionId !== sessionId) {
    return notFound("Enrollment not found");
  }

  const session = enrollment.session;

  // ── Rule: only before session COMPLETED ─────────────────────────────────
  if (session.status === "COMPLETED" || session.lifecycleStatus === "COMPLETED") {
    return fail(
      "Cannot use trainer opportunity: session is already completed. The opportunity is only available before the session is closed.",
      422,
      "SESSION_COMPLETED",
    );
  }

  // ── Rule: only the ASSIGNED trainer (or coordinator/admin) ──────────────
  // The QA Test Trainer is exempt (test-wide scope) and can use the
  // opportunity on any session.
  if (user.role === "TRAINER" && !isTestTrainer(user)) {
    // The user's trainerId must match the session's trainerId.
    const trainerUser = await db.user.findUnique({
      where: { id: user.id },
      select: { trainerId: true },
    });
    if (!trainerUser?.trainerId || trainerUser.trainerId !== session.trainerId) {
      return fail(
        "Forbidden — only the assigned trainer of this session can use the trainer opportunity.",
        403,
        "NOT_ASSIGNED_TRAINER",
      );
    }
  }

  // ── Rule: only once ─────────────────────────────────────────────────────
  if (enrollment.trainerOpportunityUsed) {
    return fail(
      "Trainer opportunity has already been used for this enrollment. It can never be repeated.",
      422,
      "TRAINER_OPPORTUNITY_ALREADY_USED",
    );
  }

  // ── Rule: final test must be FAILED ─────────────────────────────────────
  if (enrollment.finalTestStatus !== "FAILED") {
    return fail(
      `Cannot use trainer opportunity: final test status is ${enrollment.finalTestStatus}. The opportunity is only available after a failed final assessment.`,
      422,
      "FINAL_TEST_NOT_FAILED",
    );
  }

  // ── Mark the opportunity as used ────────────────────────────────────────
  const now = new Date();
  const updated = await db.sessionEnrollment.update({
    where: { id: enrollmentId },
    data: {
      trainerOpportunityUsed: true,
      trainerOpportunityPassed: Boolean(passed),
      trainerOpportunityAt: now,
      trainerOpportunityBy: user.id,
      // If passed, update finalTestStatus to PASSED so the certificate
      // workflow can continue.
      ...(passed && { finalTestStatus: "PASSED" }),
      updatedBy: user.id,
      updatedAt: now,
    },
  });

  // ── If PASSED: recalculate certificate eligibility ──────────────────────
  // When the trainee passes the trainer opportunity, their finalTestStatus
  // is now PASSED — the same as if they passed the original final assessment.
  // We must call recalcCertificateEligibility to check if all conditions
  // are met (attendance + final test + evaluation) and update
  // certificateStatus to ELIGIBLE so the certificate release workflow
  // can proceed normally.
  if (passed) {
    await recalcCertificateEligibility({
      sessionId,
      traineeName: enrollment.trainee?.fullName ?? undefined,
      traineeIdNational: enrollment.trainee?.nationalId ?? undefined,
      userId: user.id,
    });
  }

  // ── No Audit Log for Trainer Opportunity ────────────────────────────────
  // Per business rules: Trainer Opportunity is an instructional decision,
  // NOT an administrative workflow event. It must NOT appear in the Audit
  // Log. Only official administrative events (Official Retest actions,
  // session/trainer changes, enrollment changes) are audited.

  return ok({
    enrollmentId,
    trainerOpportunityUsed: true,
    trainerOpportunityPassed: Boolean(passed),
    finalTestStatus: passed ? "PASSED" : enrollment.finalTestStatus,
    nextStep: passed
      ? "Certificate workflow can continue."
      : "Trainee is now 'Awaiting Official Retest'. Create an official retest to proceed.",
  });
});
