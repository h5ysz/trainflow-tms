// GCCLAB TMS — Retest notification helpers
// ====================================================================
// Sends notifications to the CONTRACTOR (the customer) when a trainee's
// retest status changes. The trainee does NOT receive notifications —
// only the contractor who owns the trainee's company.
//
// Notification types:
//   - FAILED_ASSESSMENT  → trainee failed the final test
//   - RETEST_SCHEDULED   → a retest has been scheduled
//   - RETEST_RESCHEDULED → the retest has been rescheduled
//   - RETEST_CANCELLED   → the retest has been cancelled
//   - RETEST_PASSED      → the trainee passed the retest
import { db } from "@/lib/db";

interface RetestNotificationContext {
  /** The company that owns the trainee. */
  companyId: string;
  /** The trainee's name (for the notification message). */
  traineeName: string;
  /** The course title (for context). */
  courseTitle?: string | null;
  /** The session ref number. */
  sessionRef?: string | null;
  /** The retest ref number. */
  retestRef?: string | null;
  /** Old score (for failed notifications). */
  scorePercent?: number | null;
  /** New retest date (for scheduled/rescheduled). */
  retestDate?: Date | null;
}

/**
 * Find all contractor users linked to a company and send them a notification.
 * Contractors are the "customer" — they need to know about retest status
 * changes so they can plan accordingly. The trainee does NOT receive
 * notifications (per business requirements).
 */
export async function notifyContractors(
  ctx: RetestNotificationContext,
  type: "FAILED_ASSESSMENT" | "RETEST_SCHEDULED" | "RETEST_RESCHEDULED" | "RETEST_CANCELLED" | "RETEST_PASSED",
): Promise<void> {
  // Find all contractor users for this company.
  const contractors = await db.user.findMany({
    where: {
      role: "CONTRACTOR",
      companyId: ctx.companyId,
      deletedAt: null,
      isActive: true,
    },
    select: { id: true },
  });

  if (contractors.length === 0) return;

  // Build the notification content based on type.
  const { title, titleAr, message, messageAr, notifType } = buildNotificationContent(type, ctx);

  // Send to each contractor.
  const now = new Date();
  await db.notification.createMany({
    data: contractors.map((c) => ({
      id: crypto.randomUUID(),
      userId: c.id,
      title,
      titleAr,
      message,
      messageAr,
      type: notifType,
      category: "TRAINING",
      link: `/sessions/${ctx.sessionRef ?? ""}`,
      updatedAt: now,
    })),
  });
}

function buildNotificationContent(
  type: "FAILED_ASSESSMENT" | "RETEST_SCHEDULED" | "RETEST_RESCHEDULED" | "RETEST_CANCELLED" | "RETEST_PASSED",
  ctx: RetestNotificationContext,
): {
  title: string;
  titleAr: string;
  message: string;
  messageAr: string;
  notifType: string;
} {
  const dateStr = ctx.retestDate
    ? new Date(ctx.retestDate).toLocaleDateString()
    : "";
  const coursePart = ctx.courseTitle ? ` (${ctx.courseTitle})` : "";

  switch (type) {
    case "FAILED_ASSESSMENT":
      return {
        title: "Assessment Failed",
        titleAr: "رسوب في التقييم",
        message: `Trainee ${ctx.traineeName}${coursePart} failed the final assessment with ${ctx.scorePercent ?? 0}%. A retest is required.`,
        messageAr: `المتدرب ${ctx.traineeName}${coursePart} رسب في التقييم النهائي بنسبة ${ctx.scorePercent ?? 0}%. مطلوب إعادة الاختبار.`,
        notifType: "WARNING",
      };
    case "RETEST_SCHEDULED":
      return {
        title: "Retest Scheduled",
        titleAr: "تمت جدولة إعادة الاختبار",
        message: `Retest scheduled for ${ctx.traineeName}${coursePart}${dateStr ? ` on ${dateStr}` : ""}. Ref: ${ctx.retestRef ?? "—"}`,
        messageAr: `تمت جدولة إعادة الاختبار للمتدرب ${ctx.traineeName}${coursePart}${dateStr ? ` بتاريخ ${dateStr}` : ""}. المرجع: ${ctx.retestRef ?? "—"}`,
        notifType: "INFO",
      };
    case "RETEST_RESCHEDULED":
      return {
        title: "Retest Rescheduled",
        titleAr: "تمت إعادة جدولة إعادة الاختبار",
        message: `Retest rescheduled for ${ctx.traineeName}${coursePart}${dateStr ? ` to ${dateStr}` : ""}. Ref: ${ctx.retestRef ?? "—"}`,
        messageAr: `تمت إعادة جدولة إعادة الاختبار للمتدرب ${ctx.traineeName}${coursePart}${dateStr ? ` إلى ${dateStr}` : ""}. المرجع: ${ctx.retestRef ?? "—"}`,
        notifType: "INFO",
      };
    case "RETEST_CANCELLED":
      return {
        title: "Retest Cancelled",
        titleAr: "تم إلغاء إعادة الاختبار",
        message: `Retest cancelled for ${ctx.traineeName}${coursePart}. Ref: ${ctx.retestRef ?? "—"}`,
        messageAr: `تم إلغاء إعادة الاختبار للمتدرب ${ctx.traineeName}${coursePart}. المرجع: ${ctx.retestRef ?? "—"}`,
        notifType: "WARNING",
      };
    case "RETEST_PASSED":
      return {
        title: "Retest Passed",
        titleAr: "نجاح في إعادة الاختبار",
        message: `Trainee ${ctx.traineeName}${coursePart} passed the retest. Certificate can now be issued.`,
        messageAr: `المتدرب ${ctx.traineeName}${coursePart} نجح في إعادة الاختبار. يمكن الآن إصدار الشهادة.`,
        notifType: "SUCCESS",
      };
  }
}
