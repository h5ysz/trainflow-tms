// GCCLAB TMS — WhatsApp channel provider
// =====================================================================
// Adapter for a generic WhatsApp Business API endpoint. The provider is
// swappable: point `notif.whatsapp.apiUrl` at any vendor that accepts
// { to, message, senderId } with a Bearer token and this adapter keeps working.

import type { ChannelProvider, ChannelResult, NotificationChannel } from "../types";
import { getWhatsAppSettings, postToProvider } from "../provider-settings";

function simulate(): ChannelResult | null {
  const mode = process.env.WHATSAPP_SIMULATE_MODE?.toLowerCase();
  if (mode === "success") {
    return { channel: "WHATSAPP", status: "SENT", messageId: `wa-sim-${Date.now()}`, sentAt: new Date() };
  }
  if (mode === "fail") {
    return { channel: "WHATSAPP", status: "FAILED", error: "Simulated WhatsApp failure", sentAt: new Date() };
  }
  return null;
}

export const whatsappProvider: ChannelProvider & { channel: NotificationChannel } = {
  channel: "WHATSAPP",
  async send({ to, body }) {
    const sim = simulate();
    if (sim) return sim;

    const cfg = await getWhatsAppSettings();
    if (!cfg.enabled || !cfg.apiUrl || !cfg.apiToken) {
      return {
        channel: "WHATSAPP",
        status: "FAILED",
        error: "WhatsApp provider not configured (notif.whatsapp.* or WHATSAPP_API_URL/TOKEN)",
        sentAt: new Date(),
      };
    }

    const result = await postToProvider(cfg.apiUrl, cfg.apiToken, {
      to,
      message: body,
      ...(cfg.senderId ? { senderId: cfg.senderId } : {}),
    });

    return result.ok
      ? { channel: "WHATSAPP", status: "SENT", messageId: result.messageId, sentAt: new Date() }
      : { channel: "WHATSAPP", status: "FAILED", error: result.error, sentAt: new Date() };
  },
};
