// Certificate expiry notification service.
// Sprint 6: Automatic Certificate Renewal System
//
// Sends notifications at: 90, 60, 30, 7, 1 day(s) before expiry + on expiry date.
//
// Recipients per notification:
//   1. Trainee (if they have a user account)
//   2. Company users (CONTRACTOR role on the trainee's company)
//   3. GCCLAB Coordinators (COORDINATOR role)
//   4. Administrators (SUPER_ADMIN role)
//
// Channels: System Notification (in-app) + Email (future SMS ready)
//
// Idempotent: dedupe key in notification message prevents duplicates.
import { db } from "@/lib/db";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// All expiry thresholds we notify about, in days before expiry.
const THRESHOLDS = [90, 60, 30, 7, 1];

interface ExpiryNotificationResult {
  scanned: number;
  notified: number;
  skipped: number;
  expiredMarked: number;
  errors: string[];
}

export async function processExpiryNotifications(): Promise<ExpiryNotificationResult> {
  const now = new Date();
  const result: ExpiryNotificationResult = {
    scanned: 0,
    notified: 0,
    skipped: 0,
    expiredMarked: 0,
    errors: [],
  };

  // Scan active certs expiring within 90 days (max threshold)
  const cutoff90 = new Date(now.getTime() + 90 * MS_PER_DAY);
  const activeCerts = await db.certificate.findMany({
    where: {
      deletedAt: null,
      status: { in: ["VALID", "ISSUED"] },
      validUntil: { gte: now, lte: cutoff90 },
    },
    include: {
      course: { select: { id: true, code: true, title: true, titleAr: true } },
      company: { select: { id: true, name: true } },
    },
    take: 1000,
  }) as Array<{
    id: string; refNumber: string; traineeName: string; traineeEmail: string | null;
    traineeIdNational: string | null; companyId: string | null; validUntil: Date; status: string;
    course: { id: string; code: string; title: string; titleAr: string | null };
    company: { id: string; name: string } | null;
  }>;

  result.scanned = activeCerts.length;

  for (const cert of activeCerts) {
    const daysRemaining = Math.ceil((cert.validUntil.getTime() - now.getTime()) / MS_PER_DAY);

    for (const threshold of THRESHOLDS) {
      if (daysRemaining <= threshold && daysRemaining > threshold - 1) {
        const dedupeKey = `expiry-${threshold}d-${cert.id}`;
        const existing = await db.notification.findFirst({
          where: { message: { contains: dedupeKey } },
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
          result.errors.push(`Cert ${cert.refNumber} ${threshold}d: ${(e as Error).message}`);
        }
      }
    }
  }

  // Mark already-expired certs and send on-expiry notification
  const expiredCerts = await db.certificate.findMany({
    where: {
      deletedAt: null,
      status: { in: ["VALID", "ISSUED"] },
      validUntil: { lt: now },
    },
    include: {
      course: { select: { id: true, code: true, title: true, titleAr: true } },
      company: { select: { id: true, name: true } },
    },
    take: 100,
  }) as Array<{
    id: string; refNumber: string; traineeName: string; traineeEmail: string | null;
    traineeIdNational: string | null; companyId: string | null; validUntil: Date; status: string;
    course: { id: string; code: string; title: string; titleAr: string | null };
    company: { id: string; name: string } | null;
  }>;

  for (const cert of expiredCerts) {
    try {
      await db.certificate.update({
        where: { id: cert.id },
        data: { status: "EXPIRED" },
      });
      result.expiredMarked++;

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

async function sendExpiryNotification(
  cert: {
    id: string; refNumber: string; traineeName: string; traineeEmail: string | null;
    traineeIdNational: string | null; companyId: string | null; validUntil: Date;
    course: { code: string; title: string; titleAr: string | null };
    company: { id: string; name: string } | null;
  },
  thresholdDays: number,
  daysRemaining: number,
  dedupeKey: string
): Promise<void> {
  let title: string;
  let titleAr: string;
  let message: string;
  let messageAr: string;
  let type: "INFO" | "WARNING" | "ERROR";

  if (thresholdDays === 0) {
    title = "Certificate Expired";
    titleAr = "انتهاء صلاحية الشهادة";
    message = `Certificate ${cert.refNumber} for ${cert.traineeName} (course: ${cert.course.title}) has EXPIRED. Renewal training is required.`;
    messageAr = `انتهت صلاحية الشهادة ${cert.refNumber} لـ ${cert.traineeName} (الدورة: ${cert.course.title}). مطلوب تدريب تجديد.`;
    type = "ERROR";
  } else if (thresholdDays <= 7) {
    title = `Certificate expires in ${daysRemaining} day(s) — URGENT`;
    titleAr = `الشهادة تنتهي خلال ${daysRemaining} يوم — عاجل`;
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

  message += ` [${dedupeKey}]`;
  messageAr += ` [${dedupeKey}]`;

  // Collect recipients
  const recipientIds = new Set<string>();

  if (cert.traineeEmail) {
    const traineeUser = await db.user.findFirst({
      where: { email: cert.traineeEmail, deletedAt: null, isActive: true },
      select: { id: true },
    });
    if (traineeUser) recipientIds.add(traineeUser.id);
  }

  if (cert.companyId) {
    const companyUsers = await db.user.findMany({
      where: { companyId: cert.companyId, role: "CONTRACTOR", deletedAt: null, isActive: true },
      select: { id: true },
    });
    for (const u of companyUsers) recipientIds.add(u.id);
  }

  const coordinators = await db.user.findMany({
    where: { role: "COORDINATOR", deletedAt: null, isActive: true },
    select: { id: true },
  });
  for (const c of coordinators) recipientIds.add(c.id);

  const admins = await db.user.findMany({
    where: { role: "SUPER_ADMIN", deletedAt: null, isActive: true },
    select: { id: true },
  });
  for (const a of admins) recipientIds.add(a.id);

  // Create notifications (system channel — email + SMS future-ready)
  for (const userId of recipientIds) {
    await db.notification.create({
      data: {
        userId,
        title,
        titleAr,
        message,
        messageAr,
        type,
        category: "CERTIFICATE",
        link: "/certificates",
        // channels field supports future SMS: JSON.stringify(["SYSTEM", "EMAIL", "SMS"])
      },
    });
  }
}
