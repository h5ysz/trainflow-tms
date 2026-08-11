// GCCLAB TMS — Notification channel providers
// =====================================================================
// Pluggable provider registry. Each channel (EMAIL / WHATSAPP / SMS) has an
// independent adapter; swapping a WhatsApp vendor (e.g. Meta API → Twilio →
// Wati) only means editing one adapter or the settings it reads — no rebuild
// of the service, templates, cron or UI.
//
// Provider credentials live in the Settings table (category NOTIFICATION) with
// env fallbacks — never inside UI components. Tokens are encrypted at rest via
// the same secret-settings pipeline as the SMTP password.
//
// Honesty rule (inherited from the email service): a provider never reports
// SENT for a message it did not send. Unconfigured providers return FAILED so
// the ledger records the truth. `*_SIMULATE_MODE=success|fail` exists purely
// for tests/demos to exercise the full dispatch flow without live vendors.

import type { NotificationChannel, ChannelResult, ChannelProvider } from "./types";

import { emailProvider } from "./providers/email";
import { whatsappProvider } from "./providers/whatsapp";
import { smsProvider } from "./providers/sms";

let registry: Record<NotificationChannel, ChannelProvider> | null = null;

/**
 * Get the provider registry. Built lazily so tests can re-import after setting
 * simulation env vars without stale references.
 */
export function getChannelProviders(): Record<NotificationChannel, ChannelProvider> {
  if (!registry) {
    registry = {
      EMAIL: emailProvider,
      WHATSAPP: whatsappProvider,
      SMS: smsProvider,
    };
  }
  return registry;
}

/** Force the registry to rebuild (used by tests that swap env vars). */
export function resetChannelProviders(): void {
  registry = null;
}
