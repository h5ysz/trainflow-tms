// Session Reminder (24h) — unit tests for the pure logic + dispatch service.
// Covers the acceptance scenarios that don't need a real database:
//   S4  morning → "صباحية"            S5  evening → "مسائية"
//   S6  trainer assigned → name       S7  no trainer → "لم يتم التعيين بعد"
//   S8  correct location              S9  correct trainee count
//   S1/S10/S11 window logic           S2  dedupe (cron twice)
//   S3  per-channel independence (Email SENT, WhatsApp FAILED, SMS SENT)
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import {
  sessionPeriodFromTime,
  periodLabel,
} from "@/lib/notifications/types";
import {
  buildSessionReminderTemplates,
  trainerFallback,
} from "@/lib/notifications/templates/session-reminder";
import { reminderWindow, inReminderWindow, buildReminderSessionWhere, REMINDER_HOURS, REMINDER_TOLERANCE_HOURS } from "@/lib/notifications/session-reminder";

/** A base session reminder payload the tests mutate per scenario. */
function baseData(overrides: Partial<Parameters<typeof buildSessionReminderTemplates>[1]> = {}) {
  return {
    courseTitle: "الإسعافات الأولية",
    dateLabel: "12 أغسطس 2026",
    period: "MORNING" as const,
    startTime: "8:00 ص",
    endTime: "12:00 م",
    location: "مركز GCCLAB للتدريب – الدمام",
    trainerName: "أحمد العباد",
    traineeCount: 8,
    sessionRef: "SES-000010",
    ...overrides,
  };
}

describe("S4/S5 — session period derived from start time, never typed by hand", () => {
  it("sessions starting before noon are MORNING (صباحية)", () => {
    const morning = new Date("2026-08-12T05:00:00Z"); // 08:00 Asia/Riyadh
    expect(sessionPeriodFromTime(morning)).toBe("MORNING");
    expect(periodLabel("MORNING", "ar")).toBe("صباحية");
    expect(periodLabel("MORNING", "en")).toBe("Morning");
  });

  it("sessions starting at/after noon are EVENING (مسائية)", () => {
    const evening = new Date("2026-08-12T12:00:00Z"); // 15:00 Asia/Riyadh
    expect(sessionPeriodFromTime(evening)).toBe("EVENING");
    expect(periodLabel("EVENING", "ar")).toBe("مسائية");
    expect(periodLabel("EVENING", "en")).toBe("Evening");
  });

  it("midnight is morning (hour 0, not a 24h edge)", () => {
    const midnight = new Date("2026-08-12T21:00:00Z"); // 00:00 Asia/Riyadh
    expect(sessionPeriodFromTime(midnight)).toBe("MORNING");
  });
});

describe("S7 — trainer fallback", () => {
  it("uses 'لم يتم التعيين بعد' when no trainer is assigned (Arabic)", () => {
    expect(trainerFallback("ar")).toBe("لم يتم التعيين بعد");
  });
  it("uses 'Not assigned yet' when no trainer is assigned (English)", () => {
    expect(trainerFallback("en")).toBe("Not assigned yet");
  });
});

describe("S6/S7 — trainer name in templates", () => {
  it("includes the assigned trainer's name", () => {
    const t = buildSessionReminderTemplates("ar", baseData());
    expect(t.whatsapp.body).toContain("أحمد العباد");
  });

  it("falls back to 'لم يتم التعيين بعد' when no trainer", () => {
    const t = buildSessionReminderTemplates("ar", baseData({ trainerName: trainerFallback("ar") }));
    expect(t.whatsapp.body).toContain("لم يتم التعيين بعد");
    expect(t.sms.body).toContain("لم يتم التعيين بعد");
  });
});

describe("S8 — location in templates", () => {
  it("includes the exact location in all channels", () => {
    const location = "مركز GCCLAB للتدريب – الدمام";
    const t = buildSessionReminderTemplates("ar", baseData({ location }));
    expect(t.email.html).toContain(location);
    expect(t.whatsapp.body).toContain(location);
    expect(t.sms.body).toContain(location);
  });
});

describe("S9 — trainee count in templates", () => {
  it("includes the per-company trainee count in every channel", () => {
    const t = buildSessionReminderTemplates("ar", baseData({ traineeCount: 8 }));
    expect(t.email.html).toContain("8");
    expect(t.whatsapp.body).toContain("عدد المتدربين: 8");
    expect(t.sms.body).toContain("المتدربون: 8");
  });
});

describe("S1/S10 — 24h reminder window", () => {
  const now = new Date("2026-08-11T06:00:00Z");

  it("includes a session starting tomorrow (~23.5h away) — the reminder fires now", () => {
    const session = new Date(now.getTime() + (REMINDER_HOURS - 0.5) * 3600_000);
    expect(inReminderWindow(session, now)).toBe(true);
  });

  it("includes a session starting exactly 24h from now", () => {
    const session = new Date(now.getTime() + REMINDER_HOURS * 3600_000);
    expect(inReminderWindow(session, now)).toBe(true);
  });

  it("excludes a session farther than 24h away — never sent early", () => {
    const session = new Date(now.getTime() + (REMINDER_HOURS + 1) * 3600_000);
    expect(inReminderWindow(session, now)).toBe(false);
    const far = new Date(now.getTime() + 30 * 3600_000);
    expect(inReminderWindow(far, now)).toBe(false);
  });

  it("excludes a session already past the reminder moment (tolerance expired)", () => {
    const session = new Date(now.getTime() + (REMINDER_HOURS - REMINDER_TOLERANCE_HOURS - 0.1) * 3600_000);
    expect(inReminderWindow(session, now)).toBe(false);
  });

  it("builds the expected absolute window bounds", () => {
    const { from, to } = reminderWindow(now);
    expect(from.getTime() - now.getTime()).toBe(23 * 3600_000);
    expect(to.getTime() - now.getTime()).toBe(24 * 3600_000);
  });
});

describe("S11 — ended sessions are never reminded", () => {
  const now = new Date("2026-08-11T06:00:00Z");

  it("the cron WHERE only selects SCHEDULED sessions inside the window", () => {
    const where = buildReminderSessionWhere(now);
    expect(where.status).toBe("SCHEDULED");
    expect(where.deletedAt).toBeNull();
    expect(where.startDate.gte.getTime() - now.getTime()).toBe(23 * 3600_000);
    expect(where.startDate.lte.getTime() - now.getTime()).toBe(24 * 3600_000);
  });

  it("sessions starting after the window are not in window (never reminded early)", () => {
    const tooEarly = new Date(now.getTime() + 25 * 3600_000);
    expect(inReminderWindow(tooEarly, now)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Dispatch service — S2 (dedupe) and S3 (channel independence)
// ─────────────────────────────────────────────────────────────────────────────

const findFirstLog = vi.fn();
const createLog = vi.fn();
const updateLog = vi.fn();

function mockDbForDispatch() {
  vi.resetModules();
  vi.doMock("@/lib/db", () => ({
    db: {
      notificationLog: {
        findFirst: (...a: unknown[]) => findFirstLog(...a),
        create: (...a: unknown[]) => createLog(...a),
        update: (...a: unknown[]) => updateLog(...a),
      },
    },
  }));
}

afterAll(() => {
  vi.doUnmock("@/lib/db");
  delete process.env.EMAIL_SIMULATE_MODE;
  delete process.env.WHATSAPP_SIMULATE_MODE;
  delete process.env.SMS_SIMULATE_MODE;
});

describe("S3 — per-channel independence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstLog.mockResolvedValue(null);
    createLog.mockImplementation(({ data }) => Promise.resolve({ id: `log-${data.channel}` }));
    updateLog.mockResolvedValue({});
    mockDbForDispatch();
    process.env.EMAIL_SIMULATE_MODE = "success";
    process.env.WHATSAPP_SIMULATE_MODE = "fail";
    process.env.SMS_SIMULATE_MODE = "success";
  });

  it("Email → SENT, WhatsApp → FAILED, SMS → SENT, all recorded independently", async () => {
    const { dispatchNotification } = await import("@/lib/notifications/service");
    const summary = await dispatchNotification({
      type: "SESSION_REMINDER_24H",
      referenceType: "SESSION",
      referenceId: "s-1",
      companyId: "c-1",
      scheduledAt: new Date("2026-08-12T05:00:00Z"),
      recipients: [
        {
          name: "Contractor",
          email: "contractor@example.com",
          phone: "+966500000000",
          language: "en",
        },
      ],
      buildContent: () => [
        { channel: "EMAIL", subject: "Reminder", body: "email body" },
        { channel: "WHATSAPP", body: "wa body" },
        { channel: "SMS", body: "sms body" },
      ],
    });

    const statuses = Object.fromEntries(summary.results.map((r) => [r.channel, r.status]));
    expect(statuses).toEqual({ EMAIL: "SENT", WHATSAPP: "FAILED", SMS: "SENT" });
    expect(summary.sent).toBe(2);
    expect(summary.failed).toBe(1);
    // Every attempt was logged: one create per channel, then SENT/FAILED updates.
    expect(createLog).toHaveBeenCalledTimes(3);
    expect(updateLog).toHaveBeenCalledTimes(3);
  });
});

describe("S2 — cron running twice never re-sends", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbForDispatch();
    process.env.EMAIL_SIMULATE_MODE = "success";
    process.env.WHATSAPP_SIMULATE_MODE = "success";
    process.env.SMS_SIMULATE_MODE = "success";
  });

  it("a second run with SENT ledger rows skips every channel", async () => {
    // First run: no ledger rows yet → everything is sent.
    findFirstLog.mockResolvedValue(null);
    createLog.mockImplementation(({ data }) => Promise.resolve({ id: `log-${data.channel}` }));
    updateLog.mockResolvedValue({});

    const { dispatchNotification } = await import("@/lib/notifications/service");
    const input = {
      type: "SESSION_REMINDER_24H",
      referenceType: "SESSION",
      referenceId: "s-2",
      companyId: "c-2",
      recipients: [{ name: "C", email: "c@example.com", phone: "+9665", language: "en" as const }],
      buildContent: () => [
        { channel: "EMAIL" as const, subject: "R", body: "b" },
        { channel: "WHATSAPP" as const, body: "b" },
        { channel: "SMS" as const, body: "b" },
      ],
    };

    const first = await dispatchNotification(input);
    expect(first.sent).toBe(3);

    // Second run simulates the persisted state: ledger rows now exist as SENT.
    createLog.mockClear();
    updateLog.mockClear();
    findFirstLog.mockImplementation(async ({ where }) => ({
      id: `log-${where.channel}`,
      status: "SENT",
      messageId: `m-${where.channel}`,
      sentAt: new Date(),
    }));

    const second = await dispatchNotification(input);
    expect(second.sent).toBe(0);
    // The deduplicated channels count as skipped, never as fresh sends.
    expect(second.skipped).toBe(3);
    // No new rows created and nothing re-sent (no updates either).
    expect(createLog).toHaveBeenCalledTimes(0);
    expect(updateLog).toHaveBeenCalledTimes(0);
  });
});
