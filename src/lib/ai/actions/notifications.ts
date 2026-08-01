// GCCLAB AI Copilot — Phase 2 — NOTIFICATIONS actions
// =====================================================================
// send_notification / send_reminder / draft_email / draft_sms
//
// All actions write to the existing Notification model (no schema change).
// Email/SMS drafts return content for the user to review/copy — they do
// NOT actually send emails (no email gateway integration in scope).
import { db } from "@/lib/db";
import type { ActionHandler } from "./types";
import { ActionError } from "./types";
import { copilotAudit } from "./audit";

// ─── NOTIFICATION_SEND ────────────────────────────────────────────────────
interface SendNotificationInput {
  userIds?: string[]; // specific users
  companyId?: string; // all users in this company
  role?: string; // all users with this role
  title: string;
  message: string;
  titleAr?: string;
  messageAr?: string;
  type?: string; // INFO | SUCCESS | WARNING | ERROR
  category?: string; // SYSTEM | REQUEST | SESSION | CERTIFICATE | TEST
  channels?: string[]; // ["in_app", "email", "sms", "push"]
  link?: string;
}
const sendNotification: ActionHandler<SendNotificationInput> = {
  type: "NOTIFICATION_SEND",
  category: "NOTIFICATIONS",
  description: "Send an in-app notification to one or more users (by IDs, by company, or by role).",
  descriptionAr: "إرسال إشعار داخلي لمستخدم أو أكثر (حسب المعرّف، الشركة، أو الدور).",
  resolvePermission: (role) => {
    if (role === "SUPER_ADMIN" || role === "COORDINATOR") return { module: "notifications", action: "create" };
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.title || !input.message) {
      throw new ActionError("title and message are required", 422, "VALIDATION_ERROR");
    }
    if (!input.userIds && !input.companyId && !input.role) {
      throw new ActionError("Specify at least one of: userIds, companyId, role", 422, "VALIDATION_ERROR");
    }
    let users: { id: string; email: string; fullName: string }[] = [];
    if (input.userIds && input.userIds.length > 0) {
      users = await db.user.findMany({
        where: { id: { in: input.userIds }, deletedAt: null, isActive: true },
        select: { id: true, email: true, fullName: true },
      });
    } else {
      const where: Record<string, unknown> = { deletedAt: null, isActive: true };
      if (input.companyId) where.companyId = input.companyId;
      if (input.role) where.role = input.role;
      users = await db.user.findMany({ where, select: { id: true, email: true, fullName: true }, take: 500 });
    }
    if (users.length === 0) {
      throw new ActionError("No matching users found", 400, "NO_USERS");
    }
    return {
      actionType: "NOTIFICATION_SEND",
      title: "Send Notification",
      titleAr: "إرسال الإشعار",
      summary: `Send "${input.title}" to ${users.length} user(s) via ${input.channels?.join(", ") ?? "in_app"}.`,
      summaryAr: `إرسال "${input.titleAr ?? input.title}" إلى ${users.length} مستخدم عبر ${input.channels?.join("، ") ?? "in_app"}.`,
      affectedRecords: users.slice(0, 10).map((u) => ({ entity: "USER", description: `${u.fullName} (${u.email})` })),
      changes: [
        { field: "recipients", label: "Recipients", oldValue: 0, newValue: users.length },
        { field: "channels", label: "Channels", oldValue: null, newValue: input.channels ?? ["in_app"] },
      ],
      warnings: users.length > 100 ? [{
        level: "info",
        message: `Large audience (${users.length} users). Email dispatch may take a few minutes.`,
        messageAr: `جمهور كبير (${users.length} مستخدم). قد يستغرق إرسال البريد عدة دقائق.`,
      }] : [],
      expectedResult: `${users.length} notification(s) will be created.`,
      expectedResultAr: `سيتم إنشاء ${users.length} إشعار.`,
      hydratedParams: {
        userIds: users.map((u) => u.id),
        title: input.title, message: input.message,
        titleAr: input.titleAr ?? null, messageAr: input.messageAr ?? null,
        type: input.type ?? "INFO",
        category: input.category ?? "SYSTEM",
        channels: input.channels ?? ["in_app"],
        link: input.link ?? null,
      },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const userIds = p.userIds as string[];
    const channels = p.channels as string[];
    const result = await db.notification.createMany({
      data: userIds.map((uid) => ({
        userId: uid,
        title: p.title as string,
        titleAr: (p.titleAr as string | null) ?? null,
        message: p.message as string,
        messageAr: (p.messageAr as string | null) ?? null,
        type: p.type as string,
        category: p.category as string,
        link: (p.link as string | null) ?? null,
        channels: JSON.stringify(channels),
        emailSentAt: channels.includes("email") ? new Date() : null,
      })),
    });
    await copilotAudit({
      user,
      action: "CREATE",
      entity: "USER",
      description: `AI sent notification "${p.title}" to ${result.count} user(s)`,
      descriptionAr: `أرسل الذكاء الاصطناعي إشعار "${p.title}" إلى ${result.count} مستخدم`,
      req,
      newValue: { count: result.count, title: p.title, channels },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "NOTIFICATION_SEND",
      message: `Notification sent to ${result.count} user(s).`,
      messageAr: `تم إرسال الإشعار إلى ${result.count} مستخدم.`,
      results: [],
    };
  },
};

// ─── NOTIFICATION_SEND_REMINDER ───────────────────────────────────────────
interface SendReminderInput {
  sessionId?: string;
  invoiceId?: string;
  reminderType: "SESSION_UPCOMING" | "SESSION_CHECK_IN" | "INVOICE_DUE" | "CERTIFICATE_EXPIRY" | "EXAM_REMINDER";
  daysBefore?: number;
}
const sendReminder: ActionHandler<SendReminderInput> = {
  type: "NOTIFICATION_SEND_REMINDER",
  category: "NOTIFICATIONS",
  description: "Send a contextual reminder (upcoming session, due invoice, expiring certificate, etc.).",
  descriptionAr: "إرسال تذكير سياقي (جلسة قادمة، فاتورة مستحقة، شهادة منتهية، إلخ).",
  resolvePermission: (role) => {
    if (role === "SUPER_ADMIN" || role === "COORDINATOR") return { module: "notifications", action: "create" };
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.reminderType) throw new ActionError("reminderType is required", 422, "VALIDATION_ERROR");
    let title = ""; let message = ""; let titleAr = ""; let messageAr = "";
    let affected: { entity: string; refNumber?: string | null; description: string }[] = [];
    let userIds: string[] = [];
    if (input.reminderType === "SESSION_UPCOMING" && input.sessionId) {
      const session = await db.trainingSession.findFirst({
        where: { id: input.sessionId, deletedAt: null },
        include: {
          course: { select: { title: true } },
          enrollments: {
            where: { deletedAt: null, enrollmentStatus: { not: "CANCELLED" } },
            select: { trainee: { select: { companyId: true } } },
          },
        },
      });
      if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
      const days = input.daysBefore ?? Math.ceil((session.startDate.getTime() - Date.now()) / 86400000);
      title = `Session Reminder: ${session.refNumber}`;
      titleAr = `تذكير بالجلسة: ${session.refNumber}`;
      message = `Your session "${session.course?.title ?? session.title}" is scheduled in ${days} day(s) on ${session.startDate.toLocaleDateString()}.`;
      messageAr = `جلسة "${session.course?.title ?? session.title}" مجدولة خلال ${days} يوم(s) في ${session.startDate.toLocaleDateString()}.`;
      affected = [{ entity: "SESSION", refNumber: session.refNumber, description: session.course?.title ?? session.title }];
      const companyIds = new Set<string>();
      for (const e of session.enrollments) companyIds.add(e.trainee.companyId);
      const users = await db.user.findMany({
        where: { companyId: { in: Array.from(companyIds) }, role: "CONTRACTOR", deletedAt: null, isActive: true },
        select: { id: true },
      });
      userIds = users.map((u) => u.id);
    } else if (input.reminderType === "INVOICE_DUE" && input.invoiceId) {
      const invoice = await db.invoice.findFirst({
        where: { id: input.invoiceId, deletedAt: null },
        include: { company: { select: { name: true, refNumber: true } } },
      });
      if (!invoice) throw new ActionError("Invoice not found", 404, "NOT_FOUND");
      title = `Invoice Due: ${invoice.refNumber}`;
      titleAr = `فاتورة مستحقة: ${invoice.refNumber}`;
      message = `Invoice ${invoice.refNumber} for ${invoice.grandTotal.toFixed(2)} ${invoice.currency} is due on ${invoice.dueDate?.toLocaleDateString() ?? "soon"}.`;
      messageAr = `الفاتورة ${invoice.refNumber} بقيمة ${invoice.grandTotal.toFixed(2)} ${invoice.currency} مستحقة في ${invoice.dueDate?.toLocaleDateString() ?? "قريباً"}.`;
      affected = [{ entity: "INVOICE", refNumber: invoice.refNumber, description: `${invoice.grandTotal.toFixed(2)} ${invoice.currency}` }];
      const invUsers = await db.user.findMany({
        where: { companyId: invoice.companyId, role: "CONTRACTOR", deletedAt: null, isActive: true },
        select: { id: true },
      });
      userIds = invUsers.map((u) => u.id);
    } else {
      throw new ActionError(`reminderType ${input.reminderType} requires the corresponding ID (sessionId/invoiceId)`, 422, "VALIDATION_ERROR");
    }
    if (userIds.length === 0) {
      return {
        actionType: "NOTIFICATION_SEND_REMINDER",
        title: "Send Reminder",
        titleAr: "إرسال التذكير",
        summary: `No recipients found for this reminder type.`,
        summaryAr: `لا يوجد مستلمون لهذا النوع من التذكير.`,
        affectedRecords: affected,
        changes: [],
        warnings: [{ level: "warning", message: "No matching users found — no notifications will be sent.", messageAr: "لا يوجد مستخدمون مطابقون — لن يتم إرسال إشعارات." }],
        expectedResult: `0 reminders sent.`,
        expectedResultAr: `تم إرسال 0 تذكير.`,
        hydratedParams: { userIds: [], title, titleAr, message, messageAr, type: "WARNING", category: "SYSTEM", channels: ["in_app"] },
      };
    }
    return {
      actionType: "NOTIFICATION_SEND_REMINDER",
      title: "Send Reminder",
      titleAr: "إرسال التذكير",
      summary: `Send reminder "${title}" to ${userIds.length} user(s).`,
      summaryAr: `إرسال تذكير "${titleAr}" إلى ${userIds.length} مستخدم.`,
      affectedRecords: affected,
      changes: [
        { field: "recipients", label: "Recipients", oldValue: 0, newValue: userIds.length },
        { field: "type", label: "Reminder Type", oldValue: null, newValue: input.reminderType },
      ],
      warnings: [],
      expectedResult: `${userIds.length} reminder(s) will be sent.`,
      expectedResultAr: `سيتم إرسال ${userIds.length} تذكير.`,
      hydratedParams: { userIds, title, titleAr, message, messageAr, type: "WARNING", category: "SYSTEM", channels: ["in_app"] },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    const userIds = p.userIds as string[];
    if (userIds.length === 0) {
      return {
        success: true,
        actionType: "NOTIFICATION_SEND_REMINDER",
        message: `No recipients — 0 reminders sent.`,
        messageAr: `لا يوجد مستلمون — تم إرسال 0 تذكير.`,
        results: [],
      };
    }
    const result = await db.notification.createMany({
      data: userIds.map((uid) => ({
        userId: uid,
        title: p.title as string,
        titleAr: p.titleAr as string,
        message: p.message as string,
        messageAr: p.messageAr as string,
        type: p.type as string,
        category: p.category as string,
        channels: JSON.stringify(p.channels as string[]),
      })),
    });
    await copilotAudit({
      user,
      action: "CREATE",
      entity: "USER",
      description: `AI sent reminder "${p.title}" to ${result.count} user(s)`,
      descriptionAr: `أرسل الذكاء الاصطناعي تذكير "${p.title}" إلى ${result.count} مستخدم`,
      req,
      newValue: { count: result.count, title: p.title },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "NOTIFICATION_SEND_REMINDER",
      message: `Reminder sent to ${result.count} user(s).`,
      messageAr: `تم إرسال التذكير إلى ${result.count} مستخدم.`,
      results: [],
    };
  },
};

// ─── NOTIFICATION_DRAFT_EMAIL ─────────────────────────────────────────────
interface DraftEmailInput {
  context: "SESSION_INVITE" | "INVOICE_NOTICE" | "CERTIFICATE_READY" | "GENERAL";
  sessionId?: string;
  invoiceId?: string;
  certificateId?: string;
  recipientName?: string;
  recipientEmail?: string;
  customMessage?: string;
}
const draftEmail: ActionHandler<DraftEmailInput> = {
  type: "NOTIFICATION_DRAFT_EMAIL",
  category: "NOTIFICATIONS",
  description: "Draft an email based on a context (session invite, invoice notice, certificate ready, or general). Returns the subject + body — does NOT send.",
  descriptionAr: "صياغة بريد إلكتروني حسب السياق (دعوة جلسة، إشعار فاتورة، شهادة جاهزة، أو عام). يُرجع الموضوع + النص — لا يُرسل.",
  resolvePermission: (role) => {
    if (role === "SUPER_ADMIN" || role === "COORDINATOR") return { module: "notifications", action: "view" };
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.context) throw new ActionError("context is required", 422, "VALIDATION_ERROR");
    if (!input.recipientEmail) throw new ActionError("recipientEmail is required", 422, "VALIDATION_ERROR");
    let subject = ""; let body = "";
    const recipient = input.recipientEmail;
    const recipientName = input.recipientName ?? "Recipient";
    if (input.context === "SESSION_INVITE" && input.sessionId) {
      const session = await db.trainingSession.findFirst({ where: { id: input.sessionId, deletedAt: null }, include: { course: { select: { title: true } } } });
      if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
      subject = `Training Session Invitation: ${session.course?.title ?? session.title}`;
      body = `Dear ${recipientName},\n\nYou are invited to attend the training session "${session.course?.title ?? session.title}".\n\nDate: ${session.startDate.toLocaleDateString()}\nTime: ${session.startDate.toLocaleTimeString()}\nLocation: ${session.venue ?? session.city ?? "TBD"}\nSession Ref: ${session.refNumber}\n\n${input.customMessage ?? ""}\n\nBest regards,\nGCC Electrical Testing Laboratory`;
    } else if (input.context === "INVOICE_NOTICE" && input.invoiceId) {
      const invoice = await db.invoice.findFirst({ where: { id: input.invoiceId, deletedAt: null }, include: { company: { select: { name: true } } } });
      if (!invoice) throw new ActionError("Invoice not found", 404, "NOT_FOUND");
      subject = `Invoice ${invoice.refNumber} — Payment Required`;
      body = `Dear ${recipientName},\n\nPlease find below the details of your invoice:\n\nInvoice Ref: ${invoice.refNumber}\nAmount: ${invoice.grandTotal.toFixed(2)} ${invoice.currency}\nDue Date: ${invoice.dueDate?.toLocaleDateString() ?? "—"}\nStatus: ${invoice.status}\n\n${input.customMessage ?? ""}\n\nBest regards,\nGCC Electrical Testing Laboratory`;
    } else if (input.context === "CERTIFICATE_READY" && input.certificateId) {
      const cert = await db.certificate.findFirst({ where: { id: input.certificateId, deletedAt: null }, include: { course: { select: { title: true } } } });
      if (!cert) throw new ActionError("Certificate not found", 404, "NOT_FOUND");
      subject = `Your Certificate is Ready: ${cert.refNumber}`;
      body = `Dear ${recipientName},\n\nYour certificate for the course "${cert.course.title}" is now ready.\n\nCertificate Ref: ${cert.refNumber}\nFinal Score: ${cert.finalScore}%\nValid Until: ${cert.validUntil.toLocaleDateString()}\n\n${input.customMessage ?? ""}\n\nBest regards,\nGCC Electrical Testing Laboratory`;
    } else if (input.context === "GENERAL") {
      subject = "Message from GCC Electrical Testing Laboratory";
      body = `Dear ${recipientName},\n\n${input.customMessage ?? ""}\n\nBest regards,\nGCC Electrical Testing Laboratory`;
    } else {
      throw new ActionError(`Context ${input.context} requires the corresponding ID`, 422, "VALIDATION_ERROR");
    }
    return {
      actionType: "NOTIFICATION_DRAFT_EMAIL",
      title: "Draft Email",
      titleAr: "صياغة البريد",
      summary: `Draft email "${subject}" for ${recipient}.`,
      summaryAr: `صياغة بريد "${subject}" لـ ${recipient}.`,
      affectedRecords: [{ entity: "USER", description: `${recipientName} <${recipient}>` }],
      changes: [
        { field: "subject", label: "Subject", oldValue: null, newValue: subject },
        { field: "body", label: "Body", oldValue: null, newValue: body },
      ],
      warnings: [{
        level: "info",
        message: "This is a draft only — no email will be sent. Copy the content and send via your email client.",
        messageAr: "هذه صياغة فقط — لن يتم إرسال بريد. انسخ المحتوى وأرسله عبر عميل البريد.",
      }],
      expectedResult: `Draft email returned for review.`,
      expectedResultAr: `تم إرجاع صياغة البريد للمراجعة.`,
      hydratedParams: { subject, body, recipient, recipientName, context: input.context },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    await copilotAudit({
      user,
      action: "CREATE",
      entity: "USER",
      description: `AI drafted email "${p.subject}" for ${p.recipient}`,
      descriptionAr: `صاغ الذكاء الاصطناعي بريد "${p.subject}" لـ ${p.recipient}`,
      req,
      newValue: { subject: p.subject, recipient: p.recipient, context: p.context },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "NOTIFICATION_DRAFT_EMAIL",
      message: `Draft email ready.`,
      messageAr: `صياغة البريد جاهزة.`,
      results: [
        { entity: "USER", description: `To: ${p.recipient}` },
        { entity: "USER", description: `Subject: ${p.subject}` },
      ],
    };
  },
};

// ─── NOTIFICATION_DRAFT_SMS ───────────────────────────────────────────────
interface DraftSmsInput {
  context: "SESSION_REMINDER" | "PAYMENT_DUE" | "CERTIFICATE_READY" | "GENERAL";
  sessionId?: string;
  invoiceId?: string;
  certificateId?: string;
  recipientPhone?: string;
  customMessage?: string;
}
const draftSms: ActionHandler<DraftSmsInput> = {
  type: "NOTIFICATION_DRAFT_SMS",
  category: "NOTIFICATIONS",
  description: "Draft an SMS (max 160 chars) based on a context. Returns the message — does NOT send.",
  descriptionAr: "صياغة رسالة SMS (حد أقصى 160 حرف) حسب السياق. يُرجع الرسالة — لا يُرسل.",
  resolvePermission: (role) => {
    if (role === "SUPER_ADMIN" || role === "COORDINATOR") return { module: "notifications", action: "view" };
    return null;
  },
  async preparePreview(input, _user) {
    if (!input.context) throw new ActionError("context is required", 422, "VALIDATION_ERROR");
    if (!input.recipientPhone) throw new ActionError("recipientPhone is required", 422, "VALIDATION_ERROR");
    let message = "";
    const phone = input.recipientPhone;
    if (input.context === "SESSION_REMINDER" && input.sessionId) {
      const session = await db.trainingSession.findFirst({ where: { id: input.sessionId, deletedAt: null }, include: { course: { select: { title: true } } } });
      if (!session) throw new ActionError("Session not found", 404, "NOT_FOUND");
      message = `Reminder: Your training "${session.course?.title ?? session.title}" is on ${session.startDate.toLocaleDateString()} at ${session.venue ?? session.city ?? "TBD"}. Ref: ${session.refNumber}`;
    } else if (input.context === "PAYMENT_DUE" && input.invoiceId) {
      const invoice = await db.invoice.findFirst({ where: { id: input.invoiceId, deletedAt: null } });
      if (!invoice) throw new ActionError("Invoice not found", 404, "NOT_FOUND");
      message = `Invoice ${invoice.refNumber} for ${invoice.grandTotal.toFixed(2)} ${invoice.currency} is due ${invoice.dueDate?.toLocaleDateString() ?? "soon"}. Please arrange payment.`;
    } else if (input.context === "CERTIFICATE_READY" && input.certificateId) {
      const cert = await db.certificate.findFirst({ where: { id: input.certificateId, deletedAt: null } });
      if (!cert) throw new ActionError("Certificate not found", 404, "NOT_FOUND");
      message = `Your certificate ${cert.refNumber} is ready. Valid until ${cert.validUntil.toLocaleDateString()}. Score: ${cert.finalScore}%.`;
    } else if (input.context === "GENERAL") {
      message = (input.customMessage ?? "").slice(0, 160);
    } else {
      throw new ActionError(`Context ${input.context} requires the corresponding ID`, 422, "VALIDATION_ERROR");
    }
    if (message.length > 160) message = message.slice(0, 157) + "...";
    return {
      actionType: "NOTIFICATION_DRAFT_SMS",
      title: "Draft SMS",
      titleAr: "صياغة الرسالة",
      summary: `Draft SMS (${message.length} chars) to ${phone}.`,
      summaryAr: `صياغة رسالة (${message.length} حرف) إلى ${phone}.`,
      affectedRecords: [{ entity: "USER", description: phone }],
      changes: [
        { field: "message", label: "Message", oldValue: null, newValue: message },
        { field: "length", label: "Length", oldValue: 0, newValue: message.length },
      ],
      warnings: [{
        level: "info",
        message: "This is a draft only — no SMS will be sent.",
        messageAr: "هذه صياغة فقط — لن يتم إرسال رسالة.",
      }],
      expectedResult: `Draft SMS returned.`,
      expectedResultAr: `تم إرجاع صياغة الرسالة.`,
      hydratedParams: { message, phone, context: input.context },
    };
  },
  async execute(preview, user, req) {
    const p = preview.hydratedParams;
    await copilotAudit({
      user,
      action: "CREATE",
      entity: "USER",
      description: `AI drafted SMS to ${p.phone} (${(p.message as string).length} chars)`,
      descriptionAr: `صاغ الذكاء الاصطناعي رسالة إلى ${p.phone} (${(p.message as string).length} حرف)`,
      req,
      newValue: { phone: p.phone, length: (p.message as string).length, context: p.context },
      copilotActionType: preview.actionType,
    });
    return {
      success: true,
      actionType: "NOTIFICATION_DRAFT_SMS",
      message: `Draft SMS ready.`,
      messageAr: `صياغة الرسالة جاهزة.`,
      results: [{ entity: "USER", description: `To: ${p.phone}` }],
    };
  },
};

export const notificationActions: ActionHandler<any>[] = [sendNotification, sendReminder, draftEmail, draftSms];
