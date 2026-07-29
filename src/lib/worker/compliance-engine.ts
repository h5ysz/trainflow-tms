// Compliance calculation engine.
// Sprint 6: Worker Training Passport & Compliance Matrix
//
// Calculates compliance % for a worker based on:
//   1. Core mandatory courses (OHS Orientation, Fire Safety, First Aid) — always required
//   2. Dynamic mandatory courses from ComplianceRule table (scoped to worker's company/job/etc)
//
// Formula: (completed mandatory courses / required mandatory courses) × 100
//
// Color coding:
//   Green  ≥ 90%
//   Orange 70-89%
//   Red    < 70%
import { db } from "@/lib/db";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type ComplianceLevel = "GREEN" | "ORANGE" | "RED";

export interface ComplianceRequirement {
  courseId: string;
  courseCode: string;
  courseTitle: string;
  validityMonths: number;
  isCoreMandatory: boolean;
  scopeType: string;
  scopeLabel?: string | null;
  // Worker's status for this course
  hasValidCertificate: boolean;
  certificateId?: string | null;
  certificateRefNumber?: string | null;
  certificateExpiry?: Date | null;
  daysRemaining?: number | null;
  status: "VALID" | "EXPIRED" | "EXPIRING_SOON" | "MISSING";
}

export interface ComplianceResult {
  compliancePercent: number;
  level: ComplianceLevel;
  totalRequired: number;
  totalCompleted: number;
  totalMissing: number;
  totalExpired: number;
  totalExpiringSoon: number;
  requirements: ComplianceRequirement[];
}

/**
 * Get all compliance rules that apply to a worker.
 * Rules are matched in order: ALL → COMPANY → JOB_TITLE → PROJECT → CLIENT.
 * If multiple rules exist for the same course, the most specific one wins.
 */
export async function getApplicableRules(worker: {
  nationalId: string;
  companyId?: string | null;
  jobTitle?: string | null;
}) {
  const allRules = await db.complianceRule.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      isMandatory: true,
      course: { deletedAt: null },
    },
    include: {
      course: { select: { id: true, code: true, title: true, validityMonths: true } },
    },
  });

  // Filter rules that apply to this worker
  const applicableRules = allRules.filter((rule) => {
    switch (rule.scopeType) {
      case "ALL":
        return true;
      case "COMPANY":
        return worker.companyId && rule.scopeValue === worker.companyId;
      case "JOB_TITLE":
        return worker.jobTitle && rule.scopeValue === worker.jobTitle;
      case "PROJECT":
      case "CLIENT":
        // Project/Client scoping is handled via worker's project/client assignment
        // (not yet implemented — for now, these rules apply to all workers)
        return true;
      default:
        return false;
    }
  });

  // Deduplicate by courseId — most specific scope wins
  const scopePriority: Record<string, number> = {
    ALL: 1,
    COMPANY: 2,
    JOB_TITLE: 3,
    PROJECT: 4,
    CLIENT: 5,
  };
  const byCourse = new Map<string, typeof applicableRules[0]>();
  for (const rule of applicableRules) {
    const existing = byCourse.get(rule.courseId);
    if (!existing || scopePriority[rule.scopeType] > scopePriority[existing.scopeType]) {
      byCourse.set(rule.courseId, rule);
    }
  }

  return Array.from(byCourse.values());
}

/**
 * Calculate compliance for a worker.
 *
 * @param worker — { nationalId, companyId, jobTitle }
 * @param certificates — the worker's certificates (already fetched)
 * @returns ComplianceResult with %, level, and per-course breakdown
 */
export async function calculateCompliance(
  worker: { nationalId: string; companyId?: string | null; jobTitle?: string | null },
  certificates: Array<{
    id: string;
    refNumber: string;
    status: string;
    issuedAt: Date;
    validUntil: Date;
    courseId: string;
    course: { id: string; code: string; title: string; validityMonths: number };
  }>
): Promise<ComplianceResult> {
  const rules = await getApplicableRules(worker);
  const now = new Date();

  // Build a map of courseId → most recent valid certificate
  const certByCourse = new Map<string, (typeof certificates)[0]>();
  for (const cert of certificates) {
    if (cert.status === "REVOKED") continue;
    const existing = certByCourse.get(cert.courseId);
    if (!existing || cert.issuedAt > existing.issuedAt) {
      certByCourse.set(cert.courseId, cert);
    }
  }

  const requirements: ComplianceRequirement[] = [];
  let totalRequired = 0;
  let totalCompleted = 0;
  let totalMissing = 0;
  let totalExpired = 0;
  let totalExpiringSoon = 0;

  for (const rule of rules) {
    const cert = certByCourse.get(rule.courseId);
    const validityMonths = rule.validityMonths || rule.course.validityMonths;

    let status: ComplianceRequirement["status"] = "MISSING";
    let hasValidCertificate = false;
    let daysRemaining: number | null = null;

    if (cert) {
      const diffMs = cert.validUntil.getTime() - now.getTime();
      daysRemaining = Math.ceil(diffMs / MS_PER_DAY);

      if (daysRemaining < 0) {
        status = "EXPIRED";
      } else if (daysRemaining <= 60) {
        status = "EXPIRING_SOON";
      } else {
        status = "VALID";
        hasValidCertificate = true;
      }
    }

    totalRequired++;
    if (status === "VALID") {
      totalCompleted++;
    } else if (status === "MISSING") {
      totalMissing++;
    } else if (status === "EXPIRED") {
      totalExpired++;
    } else if (status === "EXPIRING_SOON") {
      totalExpiringSoon++;
    }

    requirements.push({
      courseId: rule.courseId,
      courseCode: rule.course.code,
      courseTitle: rule.course.title,
      validityMonths,
      isCoreMandatory: rule.isCoreMandatory,
      scopeType: rule.scopeType,
      scopeLabel: rule.scopeLabel,
      hasValidCertificate,
      certificateId: cert?.id ?? null,
      certificateRefNumber: cert?.refNumber ?? null,
      certificateExpiry: cert?.validUntil ?? null,
      daysRemaining,
      status,
    });
  }

  const compliancePercent =
    totalRequired > 0 ? Math.round((totalCompleted / totalRequired) * 100) : 100;

  let level: ComplianceLevel;
  if (compliancePercent >= 90) {
    level = "GREEN";
  } else if (compliancePercent >= 70) {
    level = "ORANGE";
  } else {
    level = "RED";
  }

  return {
    compliancePercent,
    level,
    totalRequired,
    totalCompleted,
    totalMissing,
    totalExpired,
    totalExpiringSoon,
    requirements,
  };
}
