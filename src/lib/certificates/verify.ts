// Certificate verification, shared by the public /verify page and the public JSON API.
//
// The lookup and the side effect are deliberately separate functions. The page renders
// server-side and the API route answers integrations; if the page called the API, every
// visit would bump `verificationCount` twice — once for the page, once for the fetch.
import { db } from "@/lib/db";

export type CertificateValidity = "VALID" | "EXPIRED" | "REVOKED" | "NOT_FOUND";

export type VerificationChannel = "WEB" | "API";

/** Pure read. No writes, no counters — safe to call from anywhere. */
export async function lookupCertificate(token: string) {
  return db.certificate.findFirst({
    where: { verificationToken: token, deletedAt: null },
    include: {
      course: { select: { id: true, title: true, code: true, refNumber: true, durationHours: true } },
      session: { select: { id: true, refNumber: true, startDate: true, endDate: true } },
      company: { select: { id: true, name: true, refNumber: true } },
    },
  });
}

export type LookedUpCertificate = NonNullable<Awaited<ReturnType<typeof lookupCertificate>>>;

/**
 * Classify a certificate. The JSON endpoint historically collapsed everything that
 * wasn't currently valid into `valid: false`; separating expired from revoked lets the
 * page tell the visitor which one it is.
 */
export function computeValidity(cert: LookedUpCertificate | null, now: Date = new Date()): CertificateValidity {
  if (!cert) return "NOT_FOUND";
  if (cert.status === "REVOKED") return "REVOKED";
  if (cert.validUntil <= now) return "EXPIRED";
  if (cert.status !== "VALID") return "EXPIRED";
  return "VALID";
}

const DEDUPE_WINDOW_MS = 60_000;

/**
 * Record a verification and bump the certificate's counter.
 *
 * Repeats from the same IP within a minute are ignored so that a page refresh — or
 * React's development-mode double render — doesn't inflate the count.
 */
export async function recordVerification(opts: {
  certificateId: string;
  token: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  channel: VerificationChannel;
}): Promise<void> {
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);

  if (opts.ipAddress) {
    const recent = await db.certificateVerification.findFirst({
      where: {
        certificateId: opts.certificateId,
        ipAddress: opts.ipAddress,
        verifiedAt: { gte: since },
      },
      select: { id: true },
    });
    if (recent) return;
  }

  await db.$transaction(async (tx) => {
    await tx.certificateVerification.create({
      data: {
        certificateId: opts.certificateId,
        verificationToken: opts.token,
        ipAddress: opts.ipAddress ?? null,
        userAgent: opts.userAgent ?? null,
      },
    });
    await tx.certificate.update({
      where: { id: opts.certificateId },
      data: { verificationCount: { increment: 1 }, lastVerifiedAt: new Date() },
    });
  });
}

/** The subset of certificate data that is safe to show an anonymous visitor. */
export function publicCertificateView(cert: LookedUpCertificate) {
  return {
    refNumber: cert.refNumber,
    traineeName: cert.traineeName,
    courseTitle: cert.course.title,
    courseCode: cert.course.code,
    durationHours: cert.course.durationHours,
    finalScore: cert.finalScore,
    issuedAt: cert.issuedAt,
    validUntil: cert.validUntil,
    status: cert.status,
    releaseStatus: cert.releaseStatus,
    sessionRef: cert.session.refNumber,
    companyName: cert.company?.name ?? null,
    verificationCount: cert.verificationCount,
  };
}
