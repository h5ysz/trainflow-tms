// Certificate verification, shared by the public /verify page and the public JSON API.
//
// The lookup and the side effect are deliberately separate functions. The page renders
// server-side and the API route answers integrations; if the page called the API, every
// visit would bump `verificationCount` twice — once for the page, once for the fetch.
//
// Sprint 6: enhanced with parsed UA (browser/OS/device) and country fields.
import { db } from "@/lib/db";
import { parseUserAgent } from "@/lib/certificates/utils";

export type CertificateValidity = "VALID" | "EXPIRED" | "REVOKED" | "NOT_FOUND";

export type VerificationChannel = "WEB" | "API" | "QR_SCAN";

/** Pure read. No writes, no counters — safe to call from anywhere. */
export async function lookupCertificate(token: string) {
  return db.certificate.findFirst({
    where: { verificationToken: token, deletedAt: null },
    include: {
      course: { select: { id: true, title: true, titleAr: true, code: true, refNumber: true, durationHours: true, validityMonths: true } },
      session: {
        select: {
          id: true,
          refNumber: true,
          startDate: true,
          endDate: true,
          trainer: { select: { fullName: true, refNumber: true } },
        },
      },
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
  // Treat new workflow statuses (PENDING_APPROVAL, APPROVED, ISSUED) as VALID for
  // public verification purposes. The QR is only generated after PDF issuance, so
  // anyone scanning it has an issued certificate in hand.
  if (cert.status === "VALID" || cert.status === "ISSUED" || cert.status === "APPROVED") return "VALID";
  return "EXPIRED";
}

const DEDUPE_WINDOW_MS = 60_000;

/**
 * Record a verification and bump the certificate's counter.
 *
 * Repeats from the same IP within a minute are ignored so that a page refresh — or
 * React's development-mode double render — doesn't inflate the count.
 *
 * Sprint 6: also stores parsed browser/OS/device fields.
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

  // Parse user-agent into structured fields
  const ua = parseUserAgent(opts.userAgent);

  await db.$transaction(async (tx) => {
    await tx.certificateVerification.create({
      data: {
        certificateId: opts.certificateId,
        verificationToken: opts.token,
        ipAddress: opts.ipAddress ?? null,
        userAgent: opts.userAgent ?? null,
        browser: ua.browser,
        os: ua.os,
        device: ua.device,
        channel: opts.channel,
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
    courseTitleAr: cert.course.titleAr,
    courseCode: cert.course.code,
    durationHours: cert.course.durationHours,
    validityMonths: cert.course.validityMonths,
    finalScore: cert.finalScore,
    issuedAt: cert.issuedAt,
    validUntil: cert.validUntil,
    status: cert.status,
    sessionRef: cert.session.refNumber,
    companyName: cert.company?.name ?? null,
    trainerName: cert.session.trainer?.fullName ?? null,
    verificationCount: cert.verificationCount,
    lastVerifiedAt: cert.lastVerifiedAt,
  };
}
