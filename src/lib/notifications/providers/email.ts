// GCCLAB TMS — Email channel provider
// =====================================================================
// Uses the same SMTP settings as the report engine. Never claims SENT for an
// email that was only simulated: SMTP-disabled sends are SIMULATED and the
// service translates that into a FAILED ledger row.

import { sendNotificationEmail } from "@/lib/reports/email-service";
import type { ChannelProvider, ChannelResult, NotificationChannel } from "../types";

function simulate(): ChannelResult | null {
  const mode = process.env.EMAIL_SIMULATE_MODE?.toLowerCase();
  if (mode === "success") {
    return { channel: "EMAIL", status: "SENT", messageId: `sim-${Date.now()}`, sentAt: new Date() };
  }
  if (mode === "fail") {
    return { channel: "EMAIL", status: "FAILED", error: "Simulated email failure", sentAt: new Date() };
  }
  return null;
}

export const emailProvider: ChannelProvider & { channel: NotificationChannel } = {
  channel: "EMAIL",
  async send({ to, subject, body }) {
    const sim = simulate();
    if (sim) return sim;

    const result = await sendNotificationEmail({ to, subject: subject ?? "GCCLAB TMS", html: body });
    if (result.status === "SENT") {
      return { channel: "EMAIL", status: "SENT", messageId: result.messageId, sentAt: result.sentAt };
    }
    return {
      channel: "EMAIL",
      status: "FAILED",
      error: result.error ?? (result.status === "SIMULATED" ? "SMTP not configured" : "Email send failed"),
      sentAt: result.sentAt,
    };
  },
};
