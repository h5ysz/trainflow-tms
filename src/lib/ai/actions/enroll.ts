// GCCLAB AI Copilot — Phase 2 — Copilot enrollment helper
// =====================================================================
// Extends upsertEnrollment from src/lib/sessions/session-management.ts
// with the extra Phase-2 enrollment fields (isReExam, enrollmentSource,
// addedByTrainer, pendingReview) WITHOUT modifying the frozen training
// module. Calls upsertEnrollment first (handles the soft-deleted-revive
// pattern), then patches the extra fields on the same row.
import { db, type Prisma } from "@/lib/db";
import { upsertEnrollment } from "@/lib/sessions/session-management";

type Tx = Prisma.TransactionClient;

export interface CopilotEnrollOpts {
  tx?: Tx;
  enrollmentStatus?: string;
  isReExam?: boolean;
  enrollmentSource?: string;
  addedByTrainer?: boolean;
  pendingReview?: boolean;
  notes?: string | null;
}

/**
 * Same semantics as upsertEnrollment, but also sets the Phase-2 enrollment
 * metadata fields. Safe inside a transaction (pass tx).
 */
export async function copilotEnroll(
  sessionId: string,
  traineeId: string,
  companyId: string,
  userId: string,
  opts: CopilotEnrollOpts = {}
): Promise<void> {
  const tx = opts.tx ?? db;
  await upsertEnrollment(sessionId, traineeId, companyId, userId, {
    tx,
    enrollmentStatus: opts.enrollmentStatus,
    notes: opts.notes,
  });
  // Patch the extra fields on the revived/created row
  await tx.sessionEnrollment.update({
    where: { sessionId_traineeId: { sessionId, traineeId } },
    data: {
      isReExam: opts.isReExam ?? false,
      enrollmentSource: opts.enrollmentSource ?? "MANUAL",
      addedByTrainer: opts.addedByTrainer ?? false,
      pendingReview: opts.pendingReview ?? false,
      updatedBy: userId,
    },
  });
}
