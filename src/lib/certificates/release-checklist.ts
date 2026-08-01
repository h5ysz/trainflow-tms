// GCCLAB TMS — Certificate Release Checklist Service
// =====================================================================
// Computes the release checklist for a certificate (or for all certificates
// in a session for a given company). The checklist verifies:
//
//   1. Invoice fully paid (SessionPayment.paidAmount >= totalAmount)
//   2. Attendance completed (trainee PRESENT + checked in)
//   3. Exam completed (final test passed — if course hasFinalTest)
//   4. Profession verified (if course.requiresProfessionVerification)
//   5. Coordinator approval (releaseStatus === "RELEASED")
//
// The coordinator can only release certificates when items 1-4 are all true.
// Contractors cannot access PDF/QR/download until item 5 is true.
import { db } from "@/lib/db";

/**
 * Cap an array for audit-log storage (prevents unbounded row growth).
 */
export const AUDIT_ARRAY_CAP = 50;
export function truncateForAudit<T>(arr: T[]): { items: T[]; total: number } {
  return { items: arr.slice(0, AUDIT_ARRAY_CAP), total: arr.length };
}

export interface ReleaseChecklistItem {
  key: string;
  label: string;
  labelAr: string;
  passed: boolean;
  details?: string;
  detailsAr?: string;
}

export interface ReleaseChecklist {
  certificateId: string;
  certificateRef: string;
  traineeName: string;
  courseTitle: string;
  courseRequiresProfessionVerification: boolean;
  items: ReleaseChecklistItem[];
  // True when all prerequisites (items 1-4) are satisfied — coordinator can release
  readyForRelease: boolean;
  // True when coordinator has approved (releaseStatus === "RELEASED")
  released: boolean;
  // Overall release status: DRAFT | READY_FOR_RELEASE | RELEASED | DOWNLOADED
  releaseStatus: string;
  // Missing requirements (labels for display)
  missingRequirements: string[];
  missingRequirementsAr: string[];
  // Payment info
  payment?: {
    totalAmount: number;
    paidAmount: number;
    remainingBalance: number;
    paymentPercentage: number;
    paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
    currency: string;
    invoiceRef?: string | null;
  };
}

/**
 * Compute the release checklist for a single certificate.
 */
export async function computeReleaseChecklist(certificateId: string): Promise<ReleaseChecklist | null> {
  const cert = await db.certificate.findUnique({
    where: { id: certificateId },
    include: {
      course: { select: { id: true, title: true, hasFinalTest: true, requiresProfessionVerification: true } },
      session: { select: { id: true, refNumber: true, status: true, lifecycleStatus: true } },
      company: { select: { id: true, name: true } },
    },
  });
  if (!cert || cert.deletedAt) return null;

  // 1. Payment check — look up SessionPayment for (sessionId, companyId)
  let payment: ReleaseChecklist["payment"] | undefined;
  let invoicePaid = false;
  if (cert.companyId) {
    const sp = await db.sessionPayment.findUnique({
      where: { sessionId_companyId: { sessionId: cert.sessionId, companyId: cert.companyId } },
    });
    if (sp) {
      const remaining = Math.max(0, sp.totalAmount - sp.paidAmount);
      const pct = sp.totalAmount > 0 ? Math.round((sp.paidAmount / sp.totalAmount) * 100) : (sp.paidAmount > 0 ? 100 : 0);
      const status = remaining <= 0.01 ? "PAID" : sp.paidAmount > 0 ? "PARTIALLY_PAID" : "UNPAID";
      payment = {
        totalAmount: sp.totalAmount,
        paidAmount: sp.paidAmount,
        remainingBalance: remaining,
        paymentPercentage: pct,
        paymentStatus: status,
        currency: sp.currency,
        invoiceRef: sp.invoiceRef,
      };
      invoicePaid = status === "PAID";
    } else {
      // No payment record — treat as unpaid (coordinator must create one)
      payment = {
        totalAmount: 0,
        paidAmount: 0,
        remainingBalance: 0,
        paymentPercentage: 0,
        paymentStatus: "UNPAID",
        currency: "SAR",
      };
      invoicePaid = false;
    }
  } else {
    // No company — no payment required (internal cert)
    invoicePaid = true;
  }

  // 2. Attendance check
  const attendance = cert.attendanceId
    ? await db.attendance.findUnique({ where: { id: cert.attendanceId }, select: { status: true, checkInAt: true } })
    : await db.attendance.findFirst({
        where: { sessionId: cert.sessionId, traineeName: cert.traineeName, deletedAt: null },
        select: { status: true, checkInAt: true },
      });
  const attendanceCompleted = !!attendance && attendance.status === "PRESENT" && !!attendance.checkInAt;

  // 3. Exam check (only if course has final test)
  let examPassed = true; // default true if no final test required
  let examDetails: string | undefined;
  if (cert.course.hasFinalTest) {
    const finalAttempt = await db.examAttempt.findFirst({
      where: { sessionId: cert.sessionId, testType: "FINAL_TEST", traineeName: cert.traineeName, status: "GRADED", passed: true, deletedAt: null },
      orderBy: { submittedAt: "desc" },
      select: { scorePercent: true },
    });
    examPassed = !!finalAttempt;
    examDetails = finalAttempt ? `Score: ${finalAttempt.scorePercent}%` : "No passed final test found";
  }

  // 4. Profession verification (only if course requires it)
  const professionRequired = cert.course.requiresProfessionVerification;
  const professionVerified = !professionRequired || cert.professionVerified;

  // Build checklist items
  const items: ReleaseChecklistItem[] = [
    {
      key: "invoice_paid",
      label: "Invoice Fully Paid",
      labelAr: "الفاتورة مدفوعة بالكامل",
      passed: invoicePaid,
      details: payment
        ? `${payment.paidAmount.toLocaleString()} / ${payment.totalAmount.toLocaleString()} ${payment.currency} (${payment.paymentPercentage}%)`
        : undefined,
      detailsAr: payment
        ? `${payment.paidAmount.toLocaleString()} / ${payment.totalAmount.toLocaleString()} ${payment.currency} (${payment.paymentPercentage}%)`
        : undefined,
    },
    {
      key: "attendance_completed",
      label: "Attendance Completed",
      labelAr: "اكتمال الحضور",
      passed: attendanceCompleted,
      details: attendance ? `Status: ${attendance.status}` : "No attendance record",
      detailsAr: attendance ? `الحالة: ${attendance.status}` : "لا يوجد سجل حضور",
    },
    {
      key: "exam_completed",
      label: "Exam Completed",
      labelAr: "اكتمال الامتحان",
      passed: examPassed,
      details: examDetails,
      detailsAr: examDetails,
    },
  ];

  if (professionRequired) {
    items.push({
      key: "profession_verified",
      label: "Profession Verified",
      labelAr: "تم التحقق من المهنة",
      passed: cert.professionVerified,
      details: cert.professionVerified
        ? `Verified on ${cert.professionVerifiedAt?.toLocaleDateString() ?? "—"}`
        : "Pending profession verification",
      detailsAr: cert.professionVerified
        ? `تم التحقق في ${cert.professionVerifiedAt?.toLocaleDateString() ?? "—"}`
        : "في انتظار التحقق من المهنة",
    });
  }

  const readyForRelease = invoicePaid && attendanceCompleted && examPassed && professionVerified;
  const released = cert.releaseStatus === "RELEASED" || cert.releaseStatus === "DOWNLOADED";

  const missingRequirements: string[] = [];
  const missingRequirementsAr: string[] = [];
  for (const item of items) {
    if (!item.passed) {
      missingRequirements.push(item.label);
      missingRequirementsAr.push(item.labelAr);
    }
  }

  return {
    certificateId: cert.id,
    certificateRef: cert.refNumber,
    traineeName: cert.traineeName,
    courseTitle: cert.course.title,
    courseRequiresProfessionVerification: professionRequired,
    items,
    readyForRelease,
    released,
    releaseStatus: cert.releaseStatus,
    missingRequirements,
    missingRequirementsAr,
    payment,
  };
}

/**
 * Compute checklists for all certificates in a session (optionally filtered by company).
 */
export async function computeSessionReleaseChecklists(
  sessionId: string,
  companyId?: string
): Promise<ReleaseChecklist[]> {
  const certs = await db.certificate.findMany({
    where: {
      sessionId,
      deletedAt: null,
      ...(companyId ? { companyId } : {}),
    },
    select: { id: true },
  });
  const checklists: ReleaseChecklist[] = [];
  for (const c of certs) {
    const cl = await computeReleaseChecklist(c.id);
    if (cl) checklists.push(cl);
  }
  return checklists;
}

/**
 * Auto-transition releaseStatus based on checklist state.
 * Called after any change to payment/attendance/exam/profession.
 *
 *   - If all prerequisites pass AND status is DRAFT → set to READY_FOR_RELEASE
 *   - If any prerequisite fails AND status is READY_FOR_RELEASE → revert to DRAFT
 *   - RELEASED + DOWNLOADED are only changed by explicit coordinator action
 */
export async function autoUpdateReleaseStatus(certificateId: string): Promise<void> {
  const checklist = await computeReleaseChecklist(certificateId);
  if (!checklist) return;

  const cert = await db.certificate.findUnique({ where: { id: certificateId }, select: { releaseStatus: true } });
  if (!cert) return;

  // Don't auto-change RELEASED or DOWNLOADED — those require explicit coordinator action
  if (cert.releaseStatus === "RELEASED" || cert.releaseStatus === "DOWNLOADED") return;

  if (checklist.readyForRelease && cert.releaseStatus === "DRAFT") {
    await db.certificate.update({
      where: { id: certificateId },
      data: { releaseStatus: "READY_FOR_RELEASE" },
    });
  } else if (!checklist.readyForRelease && cert.releaseStatus === "READY_FOR_RELEASE") {
    await db.certificate.update({
      where: { id: certificateId },
      data: { releaseStatus: "DRAFT" },
    });
  }
}
