// GCCLAB TMS — Provider settings + generic HTTP dispatch helper
// =====================================================================
// WhatsApp and SMS providers read their configuration from the Settings table
// (`notif.whatsapp.*`, `notif.sms.*`, category NOTIFICATION) with environment
// fallbacks. This keeps vendor credentials out of UI components — they are
// stored server-side, tokens encrypted at rest.

import { db } from "@/lib/db";

export interface ProviderConfig {
  enabled: boolean;
  apiUrl: string;
  apiToken: string;
  senderId?: string;
}

interface ProviderSettingsSpec {
  prefix: "notif.whatsapp" | "notif.sms";
  env: {
    url?: string;
    token?: string;
    senderId?: string;
  };
}

async function loadProviderSettings(spec: ProviderSettingsSpec): Promise<ProviderConfig> {
  const settings = await db.setting.findMany({ where: { key: { startsWith: `${spec.prefix}.` } } });
  const map: Record<string, string> = {};
  for (const s of settings) map[s.key] = s.value;

  const apiUrl = (map[`${spec.prefix}.apiUrl`]?.trim() || spec.env.url || "").trim();
  const apiToken = (map[`${spec.prefix}.apiToken`]?.trim() || spec.env.token || "").trim();
  const senderId = (map[`${spec.prefix}.senderId`]?.trim() || spec.env.senderId || "").trim();
  const enabled = map[`${spec.prefix}.enabled`] !== "false";

  return { enabled, apiUrl, apiToken, senderId: senderId || undefined };
}

export async function getWhatsAppSettings(): Promise<ProviderConfig> {
  return loadProviderSettings({
    prefix: "notif.whatsapp",
    env: {
      url: process.env.WHATSAPP_API_URL,
      token: process.env.WHATSAPP_API_TOKEN,
      senderId: process.env.WHATSAPP_SENDER_ID,
    },
  });
}

export async function getSmsSettings(): Promise<ProviderConfig> {
  return loadProviderSettings({
    prefix: "notif.sms",
    env: {
      url: process.env.SMS_API_URL,
      token: process.env.SMS_API_TOKEN,
      senderId: process.env.SMS_SENDER_ID,
    },
  });
}

/**
 * POST JSON to a vendor endpoint. Any transport error (timeout, 4xx/5xx, DNS)
 * is turned into a FAILED result so the ledger records the failure — the
 * orchestration never throws through this layer.
 */
export async function postToProvider(
  apiUrl: string,
  apiToken: string,
  payload: Record<string, unknown>
): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiToken ? { Authorization: `Bearer ${apiToken}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = (await res.text().catch(() => "")).slice(0, 300);
      return { ok: false, error: `Provider responded ${res.status}${text ? `: ${text}` : ""}` };
    }
    const bodyText = await res.text().catch(() => "");
    let messageId: string | undefined;
    try {
      const json = JSON.parse(bodyText || "{}");
      messageId = json?.messageId ?? json?.message_id ?? json?.id ?? undefined;
    } catch {
      // vendor returned non-JSON — ignore
    }
    return { ok: true, messageId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Provider request failed" };
  }
}
