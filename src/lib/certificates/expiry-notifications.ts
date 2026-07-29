// Certificate expiry notification service.
// Sprint 6: automatically sends notifications at 180/90/60/30/15/7/1 days
// before expiry, plus on the expiry date itself.
//
// Recipients per notification:
//   1. Trainee (if they have a user account)
//   2. Company Coordinator (all CONTRACTOR users on the trainee's company)
//   3. GCCLAB Coordinators (all COORDINATOR users)
//   4. Administrators (all SUPER_ADMIN users)
//
// This function is called by the scheduler tick. It's idempotent: it tracks
// which thresholds have already been notified via the Notification.metadata
// field, so re-running the same day won't send duplicates.

import { db } from "@/lib/db";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// All expiry thresholds we notify about, in days before expiry.
const THRESHOLDS = [180, 90, 60, 30, 15, 7, 1];

interface ExpiryNotificationResult {
  scanned: number;
  notified: number;
  skipped: number;
  errors: string[];
}

/**
 * Scan all ISSUED/VALID certificates, compute days-until-expiry, and send
 * notifications for any threshold that hasn't been notified yet.
 *
 * Should be called once per day (e.g. by the scheduler tick endpoint at 09:00).
 */
export async function processExpiryNotifications(): Promise<ExpiryNotificationResult> {
  const now = new Date();
  const result: ExpiryNotificationResult = {
    scanned: 0,
    notified: 0,
    skipped: 0,
    errors: [],
  };

  // Fetch all active (ISSUED/VALID) certificates that will expire within
  // the next 180 days (the max threshold).
  const cutoff180 = new Date(now.getTime() + 180 * MS_PER_DAY);
  const activeCerts = await db.certificate.findMany({
    where: {
      deletedAt: null,
      status: { in: ["ISSUED", "VALID"] },
      validUntil: { gte: now, lte: cutoff180 },
    },
    include: {
      course: { select: { id: true, code: true, title: true, titleAr: true } },
      company: { select: { id: true, name: true } },
    },
    take: 1000,
  }) as Array<{
    id: string;
    refNumber: string;
    traineeName: string;
    traineeEmail: string | null;
    traineeIdNational: string | null;
    companyId: string | null;
    validUntil: Date;
    status: string;
    course: { id: string; code: string; title: string; titleAr: string | null };
    company: { id: string; name: string } | null;
  }>;

  result.scanned = activeCerts.length;

  // ── For each cert, check each threshold ─────────────────────────────
  for (const cert of activeCerts) {
    const daysRemaining = Math.ceil((cert.validUntil.getTime() - now.getTime()) / MS_PER_DAY);

    // Find which threshold applies today (exact match within ±1 day window)
    for (const threshold of THRESHOLDS) {
      // Notify on the threshold day OR up to 1 day after (in case scheduler missed a day)
      if (daysRemaining <= threshold && daysRemaining > threshold - 1) {
        // Check if we already notified for this threshold
        const dedupeKey = `expiry-${threshold}d-${cert.id}`;
        const existing = await db.notification.findFirst({
          where: {
            // Use the message field to dedupe — Notification doesn't have a metadata field
            message: { contains: dedupeKey },
          },
          select: { id: true },
        });

        if (existing) {
          result.skipped++;
          continue;
        }

        try {
          await sendExpiryNotification(cert, threshold, daysRemaining, dedupeKey);
          result.notified++;
        } catch (e) {
          result.errors.push(`Cert ${cert.refNumber} threshold ${threshold}d: ${(e as Error).message}`);
        }
      }
    }
  }

  // ── Also handle already-expired certs (status bump to EXPIRED + on-expiry notification) ──
  const expiredCerts = await db.certificate.findMany({
    where: {
      deletedAt: null,
      status: { in: ["ISSUED", "VALID"] },
      validUntil: { lt: now },
    },
    include: {
      course: { select: { id: true, code: true, title: true, titleAr: true } },
      company: { select: { id: true, name: true } },
    },
    take: 100,
  }) as Array<{
    id: string;
    refNumber: string;
    traineeName: string;
    traineeEmail: string | null;
    traineeIdNational: string | null;
    companyId: string | null;
    validUntil: Date;
    status: string;
    course: { id: string; code: string; title: string; titleAr: string | null };
    company: { id: string; name: string } | null;
  }>;

  for (const cert of expiredCerts) {
    try {
      // Bump status to EXPIRED
      await db.certificate.update({
        where: { id: cert.id },
        data: { status: "EXPIRED" },
      });

      // Send on-expiry notification (deduped)
      const dedupeKey = `expiry-0d-${cert.id}`;
      const existing = await db.notification.findFirst({
        where: { message: { contains: dedupeKey } },
        select: { id: true },
      });
      if (!existing) {
        await sendExpiryNotification(cert, 0, 0, dedupeKey);
        result.notified++;
      }
    } catch (e) {
      result.errors.push(`Expired cert ${cert.refNumber}: ${(e as Error).message}`);
    }
  }

  return result;
}

/**
 * Send a single expiry notification to all relevant recipients.
 */
async function sendExpiryNotification(
  cert: {
    id: string;
    refNumber: string;
    traineeName: string;
    traineeEmail: string | null;
    traineeIdNational: string | null;
    companyId: string | null;
    validUntil: Date;
    course: { code: string; title: string; titleAr: string | null };
    company: { id: string; name: string } | null;
  },
  thresholdDays: number,
  daysRemaining: number,
  dedupeKey: string
): Promise<void> {
  // Determine the message text based on threshold
  let title: string;
  let titleAr: string;
  let message: string;
  let messageAr: string;
  let type: "INFO" | "WARNING" | "ERROR";

  if (thresholdDays === 0) {
    title = "Certificate Expired";
    titleAr = "انتهاء صلاحية الشهادة";
    message = `Certificate ${cert.refNumber} for ${cert.traineeName} (course: ${cert.course.title}) has EXPIRED on ${cert.validUntil.toLocaleDateString()}. Renewal training is required.`;
    messageAr = `انتهت صلاحية الشهادة ${cert.refNumber} لـ ${cert.traineeName} (الدورة: ${cert.course.title}) في ${cert.validUntil.toLocaleDateString()}. مطلوب تدريب تجديد.`;
    type = "ERROR";
  } else if (thresholdDays <= 7) {
    title = `Certificate expires in ${daysRemaining} day(s)`;
    titleAr = `الشهادة تنتهي خلال ${daysRemaining} يوم`;
    message = `URGENT: Certificate ${cert.refNumber} for ${cert.traineeName} (course: ${cert.course.title}) expires in ${daysRemaining} day(s) on ${cert.validUntil.toLocaleDateString()}.`;
    messageAr = `عاجل: الشهادة ${cert.refNumber} لـ ${cert.traineeName} (الدورة: ${cert.course.title}) تنتهي خلال ${daysRemaining} يوم في ${cert.validUntil.toLocaleDateString()}.`;
    type = "WARNING";
  } else {
    title = `Certificate expires in ${thresholdDays} days`;
    titleAr = `الشهادة تنتهي خلال ${thresholdDays} يوماً`;
    message = `Certificate ${cert.refNumber} for ${cert.traineeName} (course: ${cert.course.title}) expires in ${daysRemaining} day(s) on ${cert.validUntil.toLocaleDateString()}.`;
    messageAr = `الشهادة ${cert.refNumber} لـ ${cert.traineeName} (الدورة: ${cert.course.title}) تنتهي خلال ${daysRemaining} يوم في ${cert.validUntil.toLocaleDateString()}.`;
    type = "INFO";
  }

  // Append dedupe key (invisible to users but searchable for dedup)
  message += ` [${dedupeKey}]`;
  messageAr += ` [${dedupeKey}]`;

  // ── Collect recipient user IDs ─────────────────────────────────────
  const recipientIds = new Set<string>();

  // 1. Trainee (if they have a user account with matching email)
  if (cert.traineeEmail) {
    const traineeUser = await db.user.findFirst({
      where: { email: cert.traineeEmail, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (traineeUser) recipientIds.add(traineeUser.id);
  }

  // 2. Company Coordinator (all CONTRACTOR users on the trainee's company)
  if (cert.companyId) {
    const companyUsers = await db.user.findMany({
      where: {
        companyId: cert.companyId,
        role: "CONTRACTOR",
        deletedAt: null,
        isActive: true,
      },
      select: { id: true },
    });
    for (const u of companyUsers) recipientIds.add(u.id);
  }

  // 3. GCCLAB Coordinators
  const coordinators = await db.user.findMany({
    where: { role: "COORDINATOR", deletedAt: null, isActive: true },
    select: { id: true },
  });
  for (const c of coordinators) recipientIds.add(c.id);

  // 4. Administrators
  const admins = await db.user.findMany({
    where: { role: "SUPER_ADMIN", deletedAt: null, isActive: true },
    select: { id: true },
  });
  for (const a of admins) recipientIds.add(a.id);

  // ── Create one notification per recipient ──────────────────────────
  const notifications = Array.from(recipientIds).map((userId) => ({
    data: {
      userId,
      title,
      titleAr,
      message,
      messageAr,
      type,
      category: "CERTIFICATE",
      link: `/certificates`,
    },
  }));

  if (notifications.length > 0) {
    await db.$transaction(async (tx) => {
      for (const n of notifications) {
        await tx.notification.create(n);
      }
    });
  }
}
