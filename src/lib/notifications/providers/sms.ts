// GCCLAB TMS — SMS channel provider
// =====================================================================
// Adapter for a generic SMS gateway (Twilio / Vonage / local aggregator).
// Point `notif.sms.apiUrl` at any vendor accepting { to, message, senderId }
// with a Bearer token.

import type { ChannelProvider, ChannelResult, NotificationChannel } from "../types";
import { getSmsSettings, postToProvider } from "../provider-settings";

function simulate(): ChannelResult | null {
  const mode = process.env.SMS_SIMULATE_MODE?.toLowerCase();
  if (mode === "success") {
    return { channel: "SMS", status: "SENT", messageId: `sms-sim-${Date.now()}`, sentAt: new Date() };
  }
  if (mode === "fail") {
    return { channel: "SMS", status: "FAILED", error: "Simulated SMS failure", sentAt: new Date() };
  }
  return null;
}

export const smsProvider: ChannelProvider & { channel: NotificationChannel } = {
  channel: "SMS",
  async send({ to, body }) {
    const sim = simulate();
    if (sim) return sim;

    const cfg = await getSmsSettings();
    if (!cfg.enabled || !cfg.apiUrl || !cfg.apiToken) {
      return {
        channel: "SMS",
        status: "FAILED",
        error: "SMS provider not configured (notif.sms.* or SMS_API_URL/TOKEN)",
        sentAt: new Date(),
      };
    }

    const result = await postToProvider(cfg.apiUrl, cfg.apiToken, {
      to,
      message: body,
      ...(cfg.senderId ? { senderId: cfg.senderId } : {}),
    });

    return result.ok
      ? { channel: "SMS", status: "SENT", messageId: result.messageId, sentAt: new Date() }
      : { channel: "SMS", status: "FAILED", error: result.error, sentAt: new Date() };
  },
};
