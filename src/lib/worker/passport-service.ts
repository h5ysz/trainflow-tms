// Worker Training Passport service.
// Auto-generates and manages worker passports.
//
// The passport is keyed by (nationalId, companyId) — one passport per worker
// per company. This ensures Company A and Company B maintain separate
// training/certification histories for the same worker.
//
// It's auto-generated when a certificate is first issued to a trainee
// whose nationalId + companyId isn't yet linked to a passport.
//
// The worker does NOT create or edit the passport — it's purely system-managed.
import { db } from "@/lib/db";
import { nextRefNumber } from "@/lib/api/ref-number";

export interface WorkerPassportInfo {
  nationalId: string;
  fullName: string;
  companyId: string;
  jobTitle?: string | null;
  mobile?: string | null;
  email?: string | null;
}

/**
 * Find an existing passport by (nationalId, companyId), or create one if it
 * doesn't exist. Idempotent: calling with the same nationalId + companyId
 * always returns the same passport.
 */
export async function findOrCreatePassport(
  info: WorkerPassportInfo,
  createdBy?: string | null
) {
  // Try to find existing passport for this worker + company
  const existing = await db.workerPassport.findFirst({
    where: { nationalId: info.nationalId, companyId: info.companyId, deletedAt: null },
  });
  if (existing) return existing;

  // Generate passport number
  const passportNumber = await nextRefNumber("WORKER_PASSPORT");

  // Create new passport scoped to this company
  return db.workerPassport.create({
    data: {
      passportNumber,
      nationalId: info.nationalId,
      fullName: info.fullName,
      companyId: info.companyId,
      jobTitle: info.jobTitle ?? null,
      mobile: info.mobile ?? null,
      email: info.email ?? null,
      createdBy: createdBy ?? null,
      updatedBy: createdBy ?? null,
    },
  });
}

/**
 * Link a certificate to a worker passport.
 * If no passport exists for the trainee's nationalId + companyId, one is
 * auto-created. Returns the passport ID (or null if the cert has no nationalId).
 */
export async function linkCertificateToPassport(
  certificate: {
    id: string;
    traineeName: string;
    traineeIdNational: string | null;
    traineeEmail?: string | null;
    companyId?: string | null;
  },
  createdBy?: string | null
): Promise<string | null> {
  if (!certificate.traineeIdNational || !certificate.companyId) return null;

  const passport = await findOrCreatePassport(
    {
      nationalId: certificate.traineeIdNational,
      fullName: certificate.traineeName,
      companyId: certificate.companyId,
      email: certificate.traineeEmail ?? null,
    },
    createdBy
  );

  // Link the certificate to the passport
  await db.certificate.update({
    where: { id: certificate.id },
    data: { workerPassportId: passport.id },
  });

  return passport.id;
}

/**
 * Get a passport by ID, including all certificates + compliance info.
 */
export async function getPassportWithCertificates(passportId: string) {
  const passport = await db.workerPassport.findUnique({
    where: { id: passportId },
    include: {
      company: { select: { id: true, name: true, refNumber: true } },
      certificates: {
        where: { deletedAt: null },
        include: {
          course: { select: { id: true, code: true, title: true, validityMonths: true } },
          session: {
            select: {
              id: true,
              refNumber: true,
              startDate: true,
              endDate: true,
              trainer: { select: { nameEn: true } },
            },
          },
        },
        orderBy: { issuedAt: "desc" },
      },
    },
  });
  return passport;
}

/**
 * Get a passport by QR token (for public QR scan).
 * Each qrToken is globally unique and maps to exactly one company-specific passport.
 */
export async function getPassportByQrToken(qrToken: string) {
  return db.workerPassport.findUnique({
    where: { qrToken },
    include: {
      company: { select: { id: true, name: true } },
    },
  });
}
