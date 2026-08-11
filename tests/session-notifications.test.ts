// Session reminders & contractor notifications — acceptance tests.
// =====================================================================
// Covers the 13 required scenarios end-to-end against an in-memory fake db:
//   TEST 1  session tomorrow → 24h reminder dispatched (all channels)
//   TEST 2  cron twice → no duplicate
//   TEST 3  channel independence (Email SENT / WhatsApp FAILED / SMS SENT / in-app)
//   TEST 4  morning session → "صباحية"
//   TEST 5  evening session → "مسائية"
//   TEST 6  trainer assigned → correct name shown
//   TEST 7  no trainer → "لم يتم التعيين بعد" (reminder still sent)
//   TEST 8  date change on approved session → SESSION_SCHEDULE_UPDATED on 4 channels
//   TEST 9  date change → old reminder never sent + new reminder scheduled
//   TEST 10 location-only change → update on 4 channels, no extra reminder
//   TEST 11 trainer-only change → update on 4 channels
//   TEST 12 multi-contractor scoping: A=5, B=8, C=7 — each sees only its own
//   TEST 13 contractor sees only the session's assigned trainer
//
// The fake db is stateful so a second cron run really sees the SENT ledger rows
// the first run wrote (the dedupe guarantee is exercised against persisted state).

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { NotificationChannel } from "@/lib/notifications/types";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory fake db (stateful) + captured channel sends
// ─────────────────────────────────────────────────────────────────────────────

interface FakeDb {
  db: Record<string, unknown>;
  state: {
    sessions: Array<Record<string, unknown>>;
    enrollments: Array<Record<string, unknown>>;
    users: Array<Record<string, unknown>>;
    trainers: Array<Record<string, unknown>>;
    notifications: Array<Record<string, unknown>>;
    logs: Array<Record<string, unknown>>;
  };
}

function matches(where: unknown, obj: Record<string, unknown>): boolean {
  if (!where || typeof where !== "object") return true;
  return Object.entries(where as Record<string, unknown>).every(([key, cond]) => {
    const value = obj[key];
    if (cond && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
      const c = cond as Record<string, unknown>;
      const opKeys = ["equals", "gte", "lte", "not", "contains", "in", "startsWith"].filter((k) => k in c);
      if (opKeys.length > 0) {
        const cmp = (a: unknown, b: unknown) => (a instanceof Date && b instanceof Date ? a.getTime() === b.getTime() : a === b);
        const toMillis = (v: unknown): unknown =>
          v && typeof v === "object" && "getTime" in v ? (v as { getTime: () => number }).getTime() : v;
        return opKeys.every((op) => {
          const v = toMillis(value);
          const cond = c[op];
          switch (op) {
            case "equals": return cmp(value, cond);
            case "gte": return (v as number) >= (toMillis(cond) as number);
            case "lte": return (v as number) <= (toMillis(cond) as number);
            case "not": return value !== cond;
            case "contains": return String(value ?? "").includes(String(cond));
            case "startsWith": return String(value ?? "").startsWith(String(cond));
            case "in": return (cond as unknown[]).includes(value);
            default: return true;
          }
        });
      }
      // Nested plain object (e.g. nothing in our flows) — deep-equal fallback.
      return JSON.stringify(value) === JSON.stringify(cond);
    }
    if (cond === null) return value == null;
    return value === cond;
  });
}

function createFakeDb(): FakeDb {
  const state = {
    sessions: [],
    enrollments: [],
    users: [],
    trainers: [],
    notifications: [],
    logs: [],
  } as FakeDb["state"];

  const db = {
    trainingSession: {
      findMany: async ({ where }: { where?: unknown }) =>
        state.sessions.filter((s) => matches(where, s)),
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.sessions.find((s) => s.id === where.id) ?? null,
    },
    sessionEnrollment: {
      count: async ({ where }: { where: Record<string, unknown> }) =>
        state.enrollments.filter((e) => matches(where, e)).length,
    },
    user: {
      findMany: async ({ where }: { where?: unknown }) =>
        state.users.filter((u) => matches(where, u)),
    },
    trainer: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.trainers.find((t) => t.id === where.id) ?? null,
    },
    notification: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const match = state.notifications.find((n) => {
          const userIdMatch = where.userId === undefined || n.userId === where.userId;
          const messageCond = where.message as { contains?: string } | undefined;
          const messageMatch = !messageCond?.contains || String(n.message ?? "").includes(messageCond.contains);
          return userIdMatch && messageMatch;
        });
        return match ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: `notif-${state.notifications.length + 1}` };
        state.notifications.push(row);
        return row;
      },
    },
    notificationLog: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        const row = state.logs.find(
          (l) =>
            l.type === where.type &&
            l.referenceId === where.referenceId &&
            l.companyId === where.companyId &&
            l.channel === where.channel
        );
        return row ?? null;
      },
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { ...data, id: `log-${state.logs.length + 1}` };
        state.logs.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = state.logs.find((l) => l.id === where.id);
        if (row) Object.assign(row, data);
        return row;
      },
    },
  };

  return { db, state };
}

// Captured channel sends — the provider registry is mocked to these.
const emailSend = vi.fn();
const waSend = vi.fn();
const smsSend = vi.fn();

function setupProviderMocks(email: "SENT" | "FAILED", wa: "SENT" | "FAILED", sms: "SENT" | "FAILED") {
  const mk = (channel: NotificationChannel, status: "SENT" | "FAILED") =>
    vi.fn(async (opts: { to: string; subject?: string; body: string }) =>
      status === "SENT"
        ? { channel, status: "SENT" as const, messageId: `m-${channel}`, sentAt: new Date() }
        : { channel, status: "FAILED" as const, error: `Simulated ${channel} failure`, sentAt: new Date() }
    );
  emailSend.mockImplementation(mk("EMAIL", email));
  waSend.mockImplementation(mk("WHATSAPP", wa));
  smsSend.mockImplementation(mk("SMS", sms));
}

function setupMocks(fake: FakeDb) {
  vi.resetModules();
  vi.doMock("@/lib/db", () => ({ db: fake.db }));
  vi.doMock("@/lib/notifications/providers", () => ({
    getChannelProviders: () => ({
      EMAIL: { channel: "EMAIL", send: emailSend },
      WHATSAPP: { channel: "WHATSAPP", send: waSend },
      SMS: { channel: "SMS", send: smsSend },
    }),
    resetChannelProviders: () => {},
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

interface SessionSeed {
  id: string;
  refNumber: string;
  startDate: Date;
  endDate: Date;
  trainer?: { id: string; nameEn: string; nameAr: string } | null;
  trainerId?: string | null;
  companies: Array<{ companyId: string; count: number; name: string; nameAr: string }>;
  location?: string;
  venue?: string | null;
  city?: string | null;
}

function seedSession(fake: FakeDb, seed: SessionSeed) {
  const session = {
    id: seed.id,
    refNumber: seed.refNumber,
    title: seed.trainer ? "First Aid" : "First Aid",
    courseId: "crs-1",
    course: { title: "First Aid", titleAr: "الإسعافات الأولية" },
    trainer: seed.trainer ?? null,
    trainerId: seed.trainer?.id ?? null,
    request: { companyId: seed.companies[0]?.companyId ?? null, contact: null },
    sessionCompanies: seed.companies.map((c) => ({
      companyId: c.companyId,
      traineeCount: c.count,
      company: { name: c.name, nameAr: c.nameAr },
    })),
    location: seed.location ?? "GCCLAB Training Center",
    venue: seed.venue ?? null,
    city: seed.city ?? "Dammam",
    startDate: seed.startDate,
    endDate: seed.endDate,
    expectedTrainees: seed.companies.reduce((n, c) => n + c.count, 0),
    status: "SCHEDULED",
    deletedAt: null,
  };
  fake.state.sessions.push(session);

  for (const c of seed.companies) {
    for (let i = 0; i < c.count; i++) {
      fake.state.enrollments.push({
        id: `enr-${seed.id}-${c.companyId}-${i}`,
        sessionId: seed.id,
        companyId: c.companyId,
        enrollmentStatus: "CONFIRMED",
        deletedAt: null,
      });
    }
  }
  return session;
}

function seedContractor(fake: FakeDb, overrides: Record<string, unknown>) {
  const user = {
    id: "u-x",
    fullName: "Contractor",
    email: "c@example.com",
    phone: "+966500000000",
    language: "ar",
    role: "CONTRACTOR",
    companyId: "c-1",
    isActive: true,
    deletedAt: null,
    ...overrides,
  };
  fake.state.users.push(user);
  return user;
}

/** Convenience: run the reminder cron and return the module result. */
async function runReminder(now: Date) {
  const { processSessionReminders } = await import("@/lib/notifications/session-reminder");
  return processSessionReminders(now);
}

/** Convenience: fire the schedule-update notification for a session. */
async function runUpdate(sessionId: string, before: Record<string, unknown>) {
  const { notifySessionScheduleUpdate } = await import("@/lib/notifications/session-update");
  return notifySessionScheduleUpdate(sessionId, before as never);
}

function logRows(fake: FakeDb) {
  return fake.state.logs as Array<Record<string, unknown> & { channel: string; status: string; errorMessage?: string | null }>;
}

function notifMessages(fake: FakeDb) {
  return fake.state.notifications as Array<Record<string, unknown> & { message: string; messageAr: string; userId: string }>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  vi.doUnmock("@/lib/db");
  vi.doUnmock("@/lib/notifications/providers");
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 1 — session scheduled tomorrow → 24h reminder is dispatched
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 1 — 24h reminder is created for a session tomorrow", () => {
  it("dispatches Email/WhatsApp/SMS to the company's contractor and creates the in-app item", async () => {
    const fake = createFakeDb();
    seedContractor(fake, {
      id: "u-a", fullName: "مقاول أ", email: "a@example.com", phone: "+966500000001", companyId: "c-1",
    });
    seedSession(fake, {
      id: "s-1",
      refNumber: "SES-000010",
      startDate: new Date("2026-08-12T05:00:00Z"), // tomorrow 08:00 Riyadh → morning
      endDate: new Date("2026-08-12T09:00:00Z"),
      trainer: { id: "tr-1", nameEn: "Ahmed Al-Abbad", nameAr: "أحمد العباد" },
      trainerId: "tr-1",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    const result = await runReminder(new Date("2026-08-11T06:00:00Z"));

    expect(result.scanned).toBe(1);
    expect(result.sent).toBe(3);
    expect(result.failed).toBe(0);

    // One ledger row per channel, all SENT, scoped to session + company.
    const logs = logRows(fake);
    expect(logs).toHaveLength(3);
    for (const l of logs) {
      expect(l.type).toBe("SESSION_REMINDER_24H");
      expect(l.referenceId).toBe("s-1");
      expect(l.sessionId).toBe("s-1");
      expect(l.companyId).toBe("c-1");
      expect(l.status).toBe("SENT");
      expect(l.sentAt).toBeInstanceOf(Date);
    }
    expect(new Set(logs.map((l) => l.channel))).toEqual(new Set(["EMAIL", "WHATSAPP", "SMS"]));

    // Email body reaches the company's contractor.
    const emailOpts = emailSend.mock.calls.map((c) => c[0]);
    expect(emailOpts[0].to).toBe("a@example.com");
    expect(emailOpts[0].subject).toContain("SES-000010");

    // In-app notification created for the contractor user.
    const msgs = notifMessages(fake);
    expect(msgs.some((m) => m.userId === "u-a" && m.message.includes("[reminder-24h-"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 2 — cron running twice never re-sends
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 2 — running the cron twice never duplicates", () => {
  it("the second tick sees SENT ledger rows and skips every channel", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", email: "a@example.com", companyId: "c-1" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-12T05:00:00Z"),
      endDate: new Date("2026-08-12T09:00:00Z"),
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    const now = new Date("2026-08-11T06:00:00Z");
    const first = await runReminder(now);
    expect(first.sent).toBe(3);

    emailSend.mockClear();
    waSend.mockClear();
    smsSend.mockClear();

    const second = await runReminder(now);
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(3);
    expect(emailSend).not.toHaveBeenCalled();
    expect(waSend).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(logRows(fake)).toHaveLength(3); // no new rows
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 3 — channel independence + in-app
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 3 — each channel is logged independently", () => {
  it("Email SENT / WhatsApp FAILED / SMS SENT, in-app created regardless", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", email: "a@example.com", phone: "+9665", companyId: "c-1" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-12T05:00:00Z"),
      endDate: new Date("2026-08-12T09:00:00Z"),
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "FAILED", "SENT");

    const result = await runReminder(new Date("2026-08-11T06:00:00Z"));

    expect(result.sent).toBe(2);
    expect(result.failed).toBe(1);

    const statuses = Object.fromEntries(logRows(fake).map((l) => [l.channel, l.status]));
    expect(statuses).toEqual({ EMAIL: "SENT", WHATSAPP: "FAILED", SMS: "SENT" });

    const wa = logRows(fake).find((l) => l.channel === "WHATSAPP")!;
    expect(wa.errorMessage).toBeTruthy();
    expect(wa.status).toBe("FAILED");

    // The failed WhatsApp does NOT block the in-app item.
    expect(notifMessages(fake).some((m) => m.userId === "u-a")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 4/5 — period derived from the session start time (صباحية / مسائية)
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 4/5 — period is derived from the start time, never typed", () => {
  it("morning session (08:00) shows 'صباحية'", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", email: "a@example.com", phone: "+9665", companyId: "c-1" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-12T05:00:00Z"), // 08:00 Asia/Riyadh
      endDate: new Date("2026-08-12T09:00:00Z"),
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    await runReminder(new Date("2026-08-11T06:00:00Z"));
    expect(waSend.mock.calls[0][0].body).toContain("الفترة: صباحية");
  });

  it("evening session (16:00) shows 'مسائية'", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", email: "a@example.com", phone: "+9665", companyId: "c-1" });
    seedSession(fake, {
      id: "s-2", refNumber: "SES-000011",
      startDate: new Date("2026-08-12T13:00:00Z"), // 16:00 Asia/Riyadh
      endDate: new Date("2026-08-12T17:00:00Z"),
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    await runReminder(new Date("2026-08-11T13:00:00Z")); // 24h before 12 Aug 16:00 Riyadh
    expect(waSend.mock.calls[0][0].body).toContain("الفترة: مسائية");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 6/7 — trainer name (assigned / not assigned)
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 6/7 — trainer resolution never fails the reminder", () => {
  it("shows the assigned trainer's name", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", email: "a@example.com", phone: "+9665", companyId: "c-1" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-12T05:00:00Z"),
      endDate: new Date("2026-08-12T09:00:00Z"),
      trainer: { id: "tr-1", nameEn: "Ahmed Al-Abbad", nameAr: "أحمد العباد" },
      trainerId: "tr-1",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    await runReminder(new Date("2026-08-11T06:00:00Z"));
    expect(waSend.mock.calls[0][0].body).toContain("المدرب: أحمد العباد");
  });

  it("shows 'لم يتم التعيين بعد' when no trainer is assigned — and still sends", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", email: "a@example.com", phone: "+9665", companyId: "c-1" });
    seedSession(fake, {
      id: "s-2", refNumber: "SES-000011",
      startDate: new Date("2026-08-12T05:00:00Z"),
      endDate: new Date("2026-08-12T09:00:00Z"),
      trainer: null,
      trainerId: null,
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    const result = await runReminder(new Date("2026-08-11T06:00:00Z"));
    expect(result.sent).toBe(3);
    expect(waSend.mock.calls[0][0].body).toContain("المدرب: لم يتم التعيين بعد");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 8 — date change on an approved/scheduled session → SESSION_SCHEDULE_UPDATED
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 8 — SESSION_SCHEDULE_UPDATED on date change (4 channels)", () => {
  it("dispatches Email/WhatsApp/SMS + in-app with the change summary", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", email: "a@example.com", phone: "+9665", companyId: "c-1" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-15T08:00:00Z"), // NEW date (after the edit)
      endDate: new Date("2026-08-15T12:00:00Z"),
      trainer: { id: "tr-1", nameEn: "Ahmed Al-Abbad", nameAr: "أحمد العباد" },
      trainerId: "tr-1",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    const result = await runUpdate("s-1", {
      startDate: new Date("2026-08-12T05:00:00Z"), // OLD date 12 Aug 08:00
      endDate: new Date("2026-08-12T09:00:00Z"),
      location: "GCCLAB Training Center",
      venue: null,
      city: "Dammam",
      trainerId: "tr-1",
    });

    expect(result).not.toBeNull();
    expect(result!.sent).toBe(3);

    // Ledger rows carry the update type + the change-hash keyed reference.
    const logs = logRows(fake);
    expect(logs).toHaveLength(3);
    for (const l of logs) {
      expect(l.type).toBe("SESSION_SCHEDULE_UPDATED");
      expect(l.sessionId).toBe("s-1");
      expect(l.companyId).toBe("c-1");
      expect(String(l.referenceId)).toContain("s-1:update:");
    }

    // The WhatsApp body summarises the date change old → new.
    const wa = waSend.mock.calls[0][0].body;
    expect(wa).toContain("*تحديث بيانات الجلسة التدريبية*");
    expect(wa).toContain("التاريخ والوقت");
    expect(wa).toContain("١٥ أغسطس"); // new date visible (Arabic-Indic numerals)

    // In-app item created for the contractor user.
    expect(notifMessages(fake).some((m) => m.userId === "u-a" && m.message.includes("[update-s-1-c-1-"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 9 — date change: old reminder never sent + new reminder scheduled
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 9 — date change cancels the old reminder and schedules a new one", () => {
  it("never re-sends the old date and re-dispatches a fresh instance for the new date", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", email: "a@example.com", phone: "+9665", companyId: "c-1" });
    const session = seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-12T05:00:00Z"),
      endDate: new Date("2026-08-12T09:00:00Z"),
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    // 1) Reminder fires for the ORIGINAL date (12 Aug).
    await runReminder(new Date("2026-08-11T06:00:00Z"));
    expect(emailSend).toHaveBeenCalledTimes(1);
    const oldLog = logRows(fake)[0];
    expect(oldLog.scheduledAt).toEqual(new Date("2026-08-12T05:00:00Z"));

    // 2) The coordinator moves the session to 15 Aug 16:00.
    session.startDate = new Date("2026-08-15T13:00:00Z");
    session.endDate = new Date("2026-08-15T17:00:00Z");
    emailSend.mockClear(); waSend.mockClear(); smsSend.mockClear();

    // 3) A tick around the OLD date must find nothing to send.
    const oldTick = await runReminder(new Date("2026-08-12T06:00:00Z"));
    expect(oldTick.scanned).toBe(0);
    expect(emailSend).not.toHaveBeenCalled();
    expect(waSend).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();

    // 4) A tick 24h before the NEW date dispatches a fresh instance: the SENT
    //    rows for the old date are rolled forward, not duplicated.
    const newTick = await runReminder(new Date("2026-08-14T14:00:00Z")); // 23h before 15 Aug 13:00
    expect(newTick.sent).toBe(3);
    expect(emailSend).toHaveBeenCalledTimes(1);
    expect(waSend).toHaveBeenCalledTimes(1);
    expect(smsSend).toHaveBeenCalledTimes(1);
    for (const l of logRows(fake)) {
      expect((l.scheduledAt as Date).getTime()).toBe(new Date("2026-08-15T13:00:00Z").getTime());
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 10 — location-only change: update on 4 channels, no extra reminder
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 10 — location-only change", () => {
  it("sends the update notification and creates no reminder instance", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", email: "a@example.com", phone: "+9665", companyId: "c-1" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-12T05:00:00Z"),
      endDate: new Date("2026-08-12T09:00:00Z"),
      location: "GCCLAB Training Center – New Hall",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    const result = await runUpdate("s-1", {
      startDate: new Date("2026-08-12T05:00:00Z"),
      endDate: new Date("2026-08-12T09:00:00Z"),
      location: "GCCLAB Training Center – Old Hall",
      venue: null,
      city: "Dammam",
      trainerId: null,
    });

    expect(result!.sent).toBe(3);
    const wa = waSend.mock.calls[0][0].body;
    expect(wa).toContain("الموقع");
    expect(wa).toContain("New Hall");

    // The update produced only SESSION_SCHEDULE_UPDATED rows — no reminder rows,
    // and no in-app reminder was created.
    expect(logRows(fake).every((l) => l.type === "SESSION_SCHEDULE_UPDATED")).toBe(true);
    expect(notifMessages(fake).every((m) => !m.message.includes("[reminder-24h-"))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 11 — trainer-only change → update on 4 channels
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 11 — trainer-only change", () => {
  it("notifies all channels with old → new trainer", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", email: "a@example.com", phone: "+9665", companyId: "c-1" });
    fake.state.trainers.push({ id: "tr-old", nameEn: "Khalid Al-Ali", nameAr: "خالد العلي" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-12T05:00:00Z"),
      endDate: new Date("2026-08-12T09:00:00Z"),
      trainer: { id: "tr-new", nameEn: "Ahmed Al-Abbad", nameAr: "أحمد العباد" },
      trainerId: "tr-new",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    const result = await runUpdate("s-1", {
      startDate: new Date("2026-08-12T05:00:00Z"),
      endDate: new Date("2026-08-12T09:00:00Z"),
      location: "GCCLAB Training Center",
      venue: null,
      city: "Dammam",
      trainerId: "tr-old",
    });

    expect(result!.sent).toBe(3);
    const wa = waSend.mock.calls[0][0].body;
    expect(wa).toContain("المدرب");
    expect(wa).toContain("خالد العلي");
    expect(wa).toContain("أحمد العباد");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 12 — multi-contractor scoping: A=5, B=8, C=7
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 12 — every contractor sees only its own trainee count", () => {
  it("A sees 5, B sees 8, C sees 7 — never the session total", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", fullName: "A", email: "a@example.com", phone: "+966500000001", companyId: "c-1" });
    seedContractor(fake, { id: "u-b", fullName: "B", email: "b@example.com", phone: "+966500000002", companyId: "c-2" });
    seedContractor(fake, { id: "u-c", fullName: "C", email: "c@example.com", phone: "+966500000003", companyId: "c-3" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-12T05:00:00Z"),
      endDate: new Date("2026-08-12T09:00:00Z"),
      companies: [
        { companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" },
        { companyId: "c-2", count: 8, name: "Company B", nameAr: "الشركة ب" },
        { companyId: "c-3", count: 7, name: "Company C", nameAr: "الشركة ج" },
      ],
    });
    // Sanity: the session total is 20 — a scoping bug would leak "20".
    expect(fake.state.sessions[0].expectedTrainees).toBe(20);
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    const result = await runReminder(new Date("2026-08-11T06:00:00Z"));
    expect(result.sent).toBe(9); // 3 channels × 3 companies

    const byEmail = new Map(emailSend.mock.calls.map((c) => [c[0].to, c[0].subject]));
    const byWhatsApp = new Map(waSend.mock.calls.map((c) => [c[0].to, c[0].body]));
    expect(byWhatsApp.get("+966500000001")).toContain("عدد المتدربين: 5");
    expect(byWhatsApp.get("+966500000002")).toContain("عدد المتدربين: 8");
    expect(byWhatsApp.get("+966500000003")).toContain("عدد المتدربين: 7");

    // No message leaks another company's count or the session total.
    for (const body of byWhatsApp.values()) {
      expect(body).not.toContain("عدد المتدربين: 20");
      expect(body).not.toContain("عدد المتدربين: 15");
    }
    const aBody = byWhatsApp.get("+966500000001")!;
    expect(aBody).not.toContain("عدد المتدربين: 8");
    expect(aBody).not.toContain("عدد المتدربين: 7");
    expect(emailSend.mock.calls[0][0].to).toBe("a@example.com");
    expect(byEmail.has("a@example.com")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST 13 — contractor sees only the session's assigned trainer
// ─────────────────────────────────────────────────────────────────────────────

describe("TEST 13 — trainer shown to a contractor is the session's assigned trainer", () => {
  it("company A sees the session trainer (أحمد), never another company's trainer", async () => {
    const fake = createFakeDb();
    // Another company's trainer exists in the system but is NOT assigned to this
    // session — a scoping bug could surface it; the message must not.
    fake.state.trainers.push({ id: "tr-b", nameEn: "Khalid Al-Ali", nameAr: "خالد العلي" });
    seedContractor(fake, { id: "u-a", fullName: "A", email: "a@example.com", phone: "+966500000001", companyId: "c-1" });
    seedContractor(fake, { id: "u-b", fullName: "B", email: "b@example.com", phone: "+966500000002", companyId: "c-2" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-12T05:00:00Z"),
      endDate: new Date("2026-08-12T09:00:00Z"),
      trainer: { id: "tr-a", nameEn: "Ahmed Al-Abbad", nameAr: "أحمد العباد" },
      trainerId: "tr-a",
      companies: [
        { companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" },
        { companyId: "c-2", count: 8, name: "Company B", nameAr: "الشركة ب" },
      ],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    await runReminder(new Date("2026-08-11T06:00:00Z"));

    const aBody = waSend.mock.calls.find((c) => c[0].to === "+966500000001")![0].body;
    expect(aBody).toContain("المدرب: أحمد العباد");
    expect(aBody).not.toContain("خالد العلي");
  });
});
