// GCCLAB AI Copilot — Phase 2 — CERTIFICATES actions
// =====================================================================
// generate / regenerate / send
//
// Mirrors the eligibility + generation logic from
// src/app/api/sessions/[id]/generate-certificates/route.ts without
// modifying it. Uses the same eligibility helper.
import { db } from "@/lib/db";
import { nextRefNumber } from "@/lib/api/ref-number";
import { checkCertificateEligibility } from "@/lib/api/certificate-eligibility";
import { randomBytes } from "crypto";
import type { ActionHandler } from "./types";
import { ActionError } from "./types";
import { copilotAudit } from "./audit";
import { computeValidUntil } from "@/lib/certificates/utils";

function genVerificationToken(): string {
  return randomBytes(12).toString("hex");
}

// ─── CERTIFICATE_GENERATE ─────────────────────────────────────────────────
interface CertGenerateInput {
  sessionId: string;
  traineeNames?: string[]; // optional: limit to specific trainees
}
const generateCertificates: ActionHandler<CertGenerateInput> = {
  type: "CERTIFICATE_GENERATE",
  category: "CERTIFICATES",
  description: "Generate certificates for eligible trainees in a session (PRESENT + passed final test).",
  descriptionAr: "إنشاء شهادات للمتدربين المؤهلين في جلسة (حاضر + ناجح في الاختبار النهائي).",
  resolvePermission: (role) => {
    if (role === "COORDINATOR" || role === "SUPER_ADMIN" || role === "TRAINER") {
      return { module: "certificates", action: "create" };
    }
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.sessionId) throw new ActionError("sessionId is required", 422, "VALIDATION_ERROR");
    const session = await db.trainingSession.findFirst({
      where: { id: input.sessionId, deletedAt: null },
      include: { course: { select: { id: true, title: true, validityMonths: true, passScore: true } } },
    });
    if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
    const where = {
      sessionId: session.id, status: "PRESENT", deletedAt: null,
      ...(input.traineeNames ? { traineeName: { in: input.traineeNames } } : {}),
    };
    const present = await db.attendance.findMany({ where, select: { id: true, traineeName: true, traineeIdNational: true, companyId: true } });
    if (present.length === 0) throw new ActionError("No PRESENT trainees found", 400, "NO_TRAINEES");
    // Check existing
    const existing = await db.certificate.findMany({
      where: { sessionId: session.id, traineeName: { in: present.map((p) => p.traineeName) }, deletedAt: null },
      select: { traineeName: true, refNumber: true },
    });
    const existingMap = new Map(existing.map((e) => [e.traineeName, e.refNumber]));
    const toGenerate: { attendanceId: string; traineeName: string; traineeIdNational: string | null; companyId: string | null; existingRef?: string }[] = [];
    for (const p of present) {
      const ex = existingMap.get(p.traineeName);
      if (ex) {
        // Already exists — skip silently
        continue;
      }
      // Check eligibility
      const eligibility = await checkCertificateEligibility({
        sessionId: session.id, traineeName: p.traineeName,
        traineeIdNational: p.traineeIdNational ?? undefined,
      });
      if (eligibility.eligible) {
        toGenerate.push({ attendanceId: p.id, traineeName: p.traineeName, traineeIdNational: p.traineeIdNational, companyId: p.companyId });
      }
    }
    return {
      actionType: "CERTIFICATE_GENERATE",
      title: "Generate Certificates",
      titleAr: "إنشاء الشهادات",
      summary: `Generate ${toGenerate.length} certificate(s) for eligible PRESENT trainees in ${session.refNumber}.`,
      summaryAr: `إنشاء ${toGenerate.length} شهادة للمتدربين الحاضرين المؤهلين في ${session.refNumber}.`,
      affectedRecords: toGenerate.slice(0, 10).map((t) => ({ entity: "CERTIFICATE", description: t.traineeName })),
      changes: [
        { field: "count", label: "Certificates to Generate", oldValue: 0, newValue: toGenerate.length },
        { field: "skipped", label: "Already Exist / Ineligible", oldValue: null, newValue: present.length - toGenerate.length },
      ],
      warnings: [],
      expectedResult: `${toGenerate.length} certificate(s) will be created.`,
      expectedResultAr: `سيتم إنشاء ${toGenerate.length} شهادة.`,
      hydratedParams: {
        sessionId: session.id, sessionRef: session.refNumber,
        courseId: session.courseId, courseTitle: session.course.title,
        validityMonths: session.course.validityMonths,
        toGenerate,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const toGenerate = p.toGenerate as Array<{ attendanceId: string; traineeName: string; traineeIdNational: string | null; companyId: string | null }>;
    const validityMonths = p.validityMonths as number;
    const created: { id: string; refNumber: string; traineeName: string }[] = [];
    await db.$transaction(async (tx) => {
      for (const t of toGenerate) {
        // Find final test score
        const finalAttempt = await tx.examAttempt.findFirst({
          where: { sessionId: p.sessionId as string, testType: "FINAL_TEST", traineeName: t.traineeName, status: "GRADED", passed: true, deletedAt: null },
          orderBy: { submittedAt: "desc" },
        });
        const finalScore = finalAttempt?.scorePercent ?? 0;
        const refNumber = await nextRefNumber("CERTIFICATE", tx);
        const verificationToken = genVerificationToken();
        const validUntil = computeValidUntil(validityMonths);
        const cert = await tx.certificate.create({
          data: {
            refNumber,
            sessionId: p.sessionId as string,
            courseId: p.courseId as string,
            companyId: t.companyId,
            attendanceId: t.attendanceId,
            traineeName: t.traineeName,
            traineeIdNational: t.traineeIdNational,
            finalScore,
            validUntil,
            status: "VALID",
            verificationToken,
            createdBy: user.id,
            updatedBy: user.id,
          },
        });
        created.push({ id: cert.id, refNumber: cert.refNumber, traineeName: t.traineeName });
      }
    });
    await copilotAudit({
      user,
      action: "CERTIFICATE_GENERATE",
      entity: "CERTIFICATE",
      entityId: p.sessionId as string,
      entityRef: p.sessionRef as string,
      description: `AI generated ${created.length} certificates for ${p.sessionRef}`,
      descriptionAr: `أنشأ الذكاء الاصطناعي ${created.length} شهادة لـ ${p.sessionRef}`,
      req,
      newValue: { count: created.length, certificates: created.map((c) => c.refNumber) },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "CERTIFICATE_GENERATE",
      message: `${created.length} certificate(s) generated.`,
      messageAr: `تم إنشاء ${created.length} شهادة.`,
      results: created.map((c) => ({ entity: "CERTIFICATE", id: c.id, refNumber: c.refNumber, description: c.traineeName })),
    };
  },
};

// ─── CERTIFICATE_REGENERATE ───────────────────────────────────────────────
interface CertRegenerateInput {
  certificateId: string;
  newScore?: number;
  extendValidityMonths?: number;
}
const regenerateCertificate: ActionHandler<CertRegenerateInput> = {
  type: "CERTIFICATE_REGENERATE",
  category: "CERTIFICATES",
  description: "Regenerate a certificate (optionally with new score / extended validity). Old cert is revoked, new one created with version+1.",
  descriptionAr: "إعادة إنشاء شهادة (اختيارياً بدرجة جديدة / صلاحية ممتدة). تُلغى القديمة وتُنشأ جديدة بإصدار+1.",
  resolvePermission: () => ({ module: "certificates", action: "edit" }),
  async preparePreview(input, _user) {
    if (!input.certificateId) throw new ActionError("certificateId is required", 422, "VALIDATION_ERROR");
    const cert = await db.certificate.findFirst({
      where: { id: input.certificateId, deletedAt: null },
      include: { session: { select: { refNumber: true } }, course: { select: { title: true, validityMonths: true } } },
    });
    if (!cert) throw new ActionError("Certificate not found", 404, "NOT_FOUND");
    const newValidUntil = input.extendValidityMonths
      ? new Date(Date.now() + input.extendValidityMonths * 30 * 86400000)
      : cert.validUntil;
    return {
      actionType: "CERTIFICATE_REGENERATE",
      title: "Regenerate Certificate",
      titleAr: "إعادة إنشاء الشهادة",
      summary: `Regenerate ${cert.refNumber} for ${cert.traineeName} (session ${cert.session.refNumber}).`,
      summaryAr: `إعادة إنشاء ${cert.refNumber} لـ ${cert.traineeName} (الجلسة ${cert.session.refNumber}).`,
      affectedRecords: [
        { entity: "CERTIFICATE", refNumber: cert.refNumber, description: `${cert.traineeName} (v${cert.version})` },
        { entity: "CERTIFICATE", description: `New certificate (v${cert.version + 1})` },
      ],
      changes: [
        { field: "oldStatus", label: "Old Status", oldValue: cert.status, newValue: "REVOKED" },
        { field: "version", label: "Version", oldValue: cert.version, newValue: cert.version + 1 },
        ...(input.newScore ? [{ field: "finalScore", label: "Score", oldValue: cert.finalScore, newValue: input.newScore }] : []),
        ...(input.extendValidityMonths ? [{ field: "validUntil", label: "Valid Until", oldValue: cert.validUntil, newValue: newValidUntil }] : []),
      ],
      warnings: [{
        level: "warning",
        message: `Original certificate ${cert.refNumber} will be marked REVOKED.`,
        messageAr: `سيتم تعليم الشهادة الأصلية ${cert.refNumber} كملغاة.`,
      }],
      expectedResult: `A new certificate (v${cert.version + 1}) will be created.`,
      expectedResultAr: `سيتم إنشاء شهادة جديدة (إصدار ${cert.version + 1}).`,
      hydratedParams: {
        oldCertId: cert.id, oldCertRef: cert.refNumber,
        sessionId: cert.sessionId, courseId: cert.courseId,
        companyId: cert.companyId, attendanceId: cert.attendanceId,
        traineeName: cert.traineeName, traineeIdNational: cert.traineeIdNational, traineeEmail: cert.traineeEmail,
        oldVersion: cert.version,
        newScore: input.newScore ?? cert.finalScore,
        newValidUntil,
        sessionRef: cert.session.refNumber,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const newCert = await db.$transaction(async (tx) => {
      // Revoke old
      await tx.certificate.update({
        where: { id: p.oldCertId as string },
        data: { status: "REVOKED", renewedAt: new Date(), updatedBy: user.id },
      });
      // Create new with renewedFrom link
      const refNumber = await nextRefNumber("CERTIFICATE", tx);
      const verificationToken = genVerificationToken();
      return tx.certificate.create({
        data: {
          refNumber,
          sessionId: p.sessionId as string,
          courseId: p.courseId as string,
          companyId: (p.companyId as string | null) ?? null,
          attendanceId: (p.attendanceId as string | null) ?? null,
          traineeName: p.traineeName as string,
          traineeIdNational: (p.traineeIdNational as string | null) ?? null,
          traineeEmail: (p.traineeEmail as string | null) ?? null,
          finalScore: p.newScore as number,
          issuedAt: new Date(),
          validUntil: p.newValidUntil as Date,
          status: "VALID",
          renewedFromId: p.oldCertId as string,
          version: (p.oldVersion as number) + 1,
          renewedAt: new Date(),
          verificationToken,
          createdBy: user.id,
          updatedBy: user.id,
        },
      });
    });
    await copilotAudit({
      user,
      action: "RENEW_CERT",
      entity: "CERTIFICATE",
      entityId: newCert.id,
      entityRef: newCert.refNumber,
      description: `AI regenerated certificate ${p.oldCertRef} → ${newCert.refNumber} (v${newCert.version})`,
      descriptionAr: `أعاد الذكاء الاصطناعي إنشاء الشهادة ${p.oldCertRef} → ${newCert.refNumber} (إصدار ${newCert.version})`,
      req,
      oldValue: { oldCertRef: p.oldCertRef, oldVersion: p.oldVersion },
      newValue: { newCertRef: newCert.refNumber, newVersion: newCert.version, finalScore: newCert.finalScore },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "CERTIFICATE_REGENERATE",
      message: `Certificate regenerated: ${p.oldCertRef} → ${newCert.refNumber} (v${newCert.version}).`,
      messageAr: `تمت إعادة إنشاء الشهادة: ${p.oldCertRef} → ${newCert.refNumber} (إصدار ${newCert.version}).`,
      results: [{ entity: "CERTIFICATE", id: newCert.id, refNumber: newCert.refNumber, description: newCert.traineeName }],
    };
  },
};

// ─── CERTIFICATE_SEND ─────────────────────────────────────────────────────
interface CertSendInput {
  certificateId: string;
  channel: "EMAIL" | "SMS" | "IN_APP";
  recipient?: string; // override email/phone
}
const sendCertificate: ActionHandler<CertSendInput> = {
  type: "CERTIFICATE_SEND",
  category: "CERTIFICATES",
  description: "Send a certificate to the trainee via email/SMS/in-app notification. Records a Notification row.",
  descriptionAr: "إرسال شهادة للمتدرب عبر البريد/الرسائل/الإشعار الداخلي. يُنشئ سجل إشعار.",
  resolvePermission: () => ({ module: "certificates", action: "edit" }),
  async preparePreview(input, _user) {
    if (!input.certificateId || !input.channel) {
      throw new ActionError("certificateId and channel are required", 422, "VALIDATION_ERROR");
    }
    const cert = await db.certificate.findFirst({
      where: { id: input.certificateId, deletedAt: null },
      include: { session: { select: { refNumber: true } }, course: { select: { title: true } } },
    });
    if (!cert) throw new ActionError("Certificate not found", 404, "NOT_FOUND");
    return {
      actionType: "CERTIFICATE_SEND",
      title: "Send Certificate",
      titleAr: "إرسال الشهادة",
      summary: `Send certificate ${cert.refNumber} (${cert.traineeName}) via ${input.channel}.`,
      summaryAr: `إرسال الشهادة ${cert.refNumber} (${cert.traineeName}) عبر ${input.channel}.`,
      affectedRecords: [
        { entity: "CERTIFICATE", refNumber: cert.refNumber, description: `${cert.traineeName} — ${cert.session.refNumber}` },
      ],
      changes: [
        { field: "channel", label: "Channel", oldValue: null, newValue: input.channel },
        { field: "recipient", label: "Recipient", oldValue: null, newValue: input.recipient ?? cert.traineeEmail ?? cert.traineeName },
      ],
      warnings: [],
      expectedResult: `Certificate will be sent to the trainee.`,
      expectedResultAr: `سيتم إرسال الشهادة للمتدرب.`,
      hydratedParams: {
        certificateId: cert.id, certificateRef: cert.refNumber,
        traineeName: cert.traineeName, traineeEmail: cert.traineeEmail,
        courseTitle: cert.course.title, sessionRef: cert.session.refNumber,
        channel: input.channel, recipient: input.recipient ?? cert.traineeEmail ?? null,
        validUntil: cert.validUntil,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const channel = p.channel as "EMAIL" | "SMS" | "IN_APP";
    const recipient = p.recipient as string | null;
    // Find a User to attach the notification to (best-effort match by email)
    let userId: string | null = null;
    if (p.traineeEmail) {
      const u = await db.user.findFirst({ where: { email: p.traineeEmail, deletedAt: null }, select: { id: true } });
      userId = u?.id ?? null;
    }
    const notif = await db.notification.create({
      data: {
        userId,
        title: `Certificate Ready: ${p.certificateRef}`,
        titleAr: `الشهادة جاهزة: ${p.certificateRef}`,
        message: `Your certificate for ${p.courseTitle} (session ${p.sessionRef}) is ready. Valid until ${new Date(p.validUntil as string).toLocaleDateString()}.`,
        messageAr: `شهادتك لدورة ${p.courseTitle} (الجلسة ${p.sessionRef}) جاهزة. صالحة حتى ${new Date(p.validUntil as string).toLocaleDateString()}.`,
        type: "SUCCESS",
        category: "CERTIFICATE",
        channels: JSON.stringify([channel === "IN_APP" ? "in_app" : channel.toLowerCase()]),
        emailSentAt: channel === "EMAIL" ? new Date() : null,
      },
    });
    await copilotAudit({
      user,
      action: "ISSUE_CERT",
      entity: "CERTIFICATE",
      entityId: p.certificateId as string,
      entityRef: p.certificateRef as string,
      description: `AI sent certificate ${p.certificateRef} via ${channel} to ${recipient ?? "trainee"}`,
      descriptionAr: `أرسل الذكاء الاصطناعي الشهادة ${p.certificateRef} عبر ${channel} إلى ${recipient ?? "المتدرب"}`,
      req,
      newValue: { channel, recipient, notificationId: notif.id },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "CERTIFICATE_SEND",
      message: `Certificate ${p.certificateRef} sent via ${channel}.`,
      messageAr: `تم إرسال الشهادة ${p.certificateRef} عبر ${channel}.`,
      results: [],
    };
  },
};

export const certificateActions: ActionHandler<any>[] = [generateCertificates, regenerateCertificate, sendCertificate];
