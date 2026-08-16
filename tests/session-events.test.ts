// Session lifecycle event notifications — acceptance tests.
// =====================================================================
// Covers the six event-driven notifications added on top of the existing
// 24h reminder + SESSION_SCHEDULE_UPDATED (see session-notifications.test.ts):
//   EVENT A  SESSION_SCHEDULED   → trainer + contractor, coordinator excluded
//   EVENT B  TRAINER_ASSIGNED    → trainer + contractor, re-run is a no-op
//   EVENT C  SESSION_STARTED     → contractor + coordinator, each exactly once
//   EVENT D  ATTENDANCE_FINALIZED + SESSION_COMPLETED → contractor + coordinator
//   EVENT E  RESULTS_FINALIZED   → includes {{certificatesCount}}, deduped
//   EVENT F  channel independence (WhatsApp fails, Email/SMS still deliver)
//   EVENT G  bilingual {{var}} templates substitute cleanly (no leftover slots)
//   EVENT H  trainer without contact data → contractors still notified
//   EVENT I  guards: event only fires for the session state it belongs to
//   EVENT J  trainer with linked user account → in-app item created
//
// The fake db is stateful so a re-run really sees the SENT ledger rows the
// first run wrote (exact-dedupe is exercised against persisted state), exactly
// as in tests/session-notifications.test.ts.

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import type { NotificationChannel } from "@/lib/notifications/types";
import { applyTemplate, buildSessionStartedTemplates, buildResultsFinalizedTemplates } from "@/lib/notifications/templates/session-events";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory fake db (stateful) + captured channel sends
// ─────────────────────────────────────────────────────────────────────────────

interface FakeDb {
  db: Record<string, unknown>;
  state: {
    sessions: Array<Record<string, unknown>>;
    enrollments: Array<Record<string, unknown>>;
    users: Array<Record<string, unknown>>;
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
          const cnd = c[op];
          switch (op) {
            case "equals": return cmp(value, cnd);
            case "gte": return (v as number) >= (toMillis(cnd) as number);
            case "lte": return (v as number) <= (toMillis(cnd) as number);
            case "not": return value !== cnd;
            case "contains": return String(value ?? "").includes(String(cnd));
            case "startsWith": return String(value ?? "").startsWith(String(cnd));
            case "in": return (cnd as unknown[]).includes(value);
            default: return true;
          }
        });
      }
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
  trainer?: {
    id: string;
    nameEn: string;
    nameAr?: string | null;
    email?: string | null;
    phone?: string | null;
    mobile?: string | null;
    user?: { id: string; language: string | null } | null;
  } | null;
  trainerId?: string | null;
  companies: Array<{ companyId: string; count: number; name: string; nameAr: string }>;
  location?: string;
  venue?: string | null;
  city?: string | null;
  status?: string;
}

function seedSession(fake: FakeDb, seed: SessionSeed) {
  const session = {
    id: seed.id,
    refNumber: seed.refNumber,
    title: "First Aid",
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
    status: seed.status ?? "SCHEDULED",
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

function seedCoordinator(fake: FakeDb, overrides: Record<string, unknown>) {
  const user = {
    id: "coord-x",
    fullName: "Coordinator",
    email: "coord@example.com",
    phone: "+966555000000",
    language: "en",
    role: "COORDINATOR",
    companyId: null,
    isActive: true,
    deletedAt: null,
    ...overrides,
  };
  fake.state.users.push(user);
  return user;
}

async function runEvent<T extends Record<string, unknown>>(importPath: string, ...args: unknown[]): Promise<T | null> {
  const mod = await import(importPath);
  const fn = args.length > 1 ? mod[args[0] as string] : mod[args[0] as string];
  if (args.length > 1) return (fn as (...a: unknown[]) => Promise<T | null>)(...(args.slice(1) as unknown[]));
  return (fn as () => Promise<T | null>)();
}

function logRows(fake: FakeDb) {
  return fake.state.logs as Array<Record<string, unknown> & { channel: string; status: string; type: string; referenceId: string; companyId: string | null }>;
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
// EVENT A — SESSION_SCHEDULED → trainer + contractor, coordinator excluded
// ─────────────────────────────────────────────────────────────────────────────

describe("EVENT A — SESSION_SCHEDULED", () => {
  it("notifies the trainer + the company contractor; coordinators are not notified", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-c", fullName: "مقاول", email: "a@example.com", phone: "+966500000001", companyId: "c-1" });
    seedCoordinator(fake, { id: "u-coord", email: "coord@example.com" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-20T05:00:00Z"),
      endDate: new Date("2026-08-20T09:00:00Z"),
      trainer: { id: "tr-1", nameEn: "Ahmed Al-Abbad", nameAr: "أحمد العباد", email: "trainer@example.com", mobile: "+966511111111", user: { id: "u-tr", language: "en" } },
      trainerId: "tr-1",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    const result = await runEvent("@/lib/notifications/session-events", "notifySessionScheduled", "s-1");

    expect(result).not.toBeNull();
    expect(result!.trainers).toBe(1);
    expect(result!.companies).toBe(1);
    expect(result!.coordinators).toBe(0);
    expect(result!.sent).toBe(6); // 3 channels × (trainer + contractor)

    // Trainer + contractor got emails; the coordinator did not.
    const emails = emailSend.mock.calls.map((c) => c[0].to);
    expect(emails).toContain("trainer@example.com");
    expect(emails).toContain("a@example.com");
    expect(emails).not.toContain("coord@example.com");

    // Ledger: trainer keys on (sessionId:trainer, null), contractor on (sessionId, c-1).
    const logs = logRows(fake);
    expect(logs.some((l) => l.referenceId === "s-1:trainer" && l.companyId === null)).toBe(true);
    expect(logs.some((l) => l.referenceId === "s-1" && l.companyId === "c-1")).toBe(true);
    expect(logs.every((l) => l.type === "SESSION_SCHEDULED")).toBe(true);

    // In-app items for the trainer user + the contractor user.
    const msgs = notifMessages(fake);
    expect(msgs.some((m) => m.userId === "u-tr" && m.message.includes("[scheduled-s-1-trainer]"))).toBe(true);
    expect(msgs.some((m) => m.userId === "u-c" && m.message.includes("[scheduled-s-1-c-1]"))).toBe(true);
    expect(msgs.some((m) => m.userId === "u-coord")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENT B — TRAINER_ASSIGNED: re-run is a no-op (exact dedupe)
// ─────────────────────────────────────────────────────────────────────────────

describe("EVENT B — TRAINER_ASSIGNED dedupes on re-run", () => {
  it("first run notifies, second run is a no-op", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-c", email: "a@example.com", phone: "+966500000001", companyId: "c-1" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-20T05:00:00Z"),
      endDate: new Date("2026-08-20T09:00:00Z"),
      trainer: { id: "tr-1", nameEn: "Ahmed Al-Abbad", nameAr: "أحمد العباد", email: "trainer@example.com", mobile: "+966511111111" },
      trainerId: "tr-1",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    const first = await runEvent("@/lib/notifications/session-events", "notifyTrainerAssigned", "s-1", { notifyContractors: true });
    expect(first!.sent).toBe(6);
    expect(logRows(fake)).toHaveLength(6);

    emailSend.mockClear();
    waSend.mockClear();
    smsSend.mockClear();

    const second = await runEvent("@/lib/notifications/session-events", "notifyTrainerAssigned", "s-1", { notifyContractors: true });
    expect(second!.sent).toBe(0);
    expect(second!.skipped).toBe(6);
    expect(emailSend).not.toHaveBeenCalled();
    expect(waSend).not.toHaveBeenCalled();
    expect(smsSend).not.toHaveBeenCalled();
    expect(logRows(fake)).toHaveLength(6); // no new rows
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENT C — SESSION_STARTED → contractor + coordinator, each exactly once
// ─────────────────────────────────────────────────────────────────────────────

describe("EVENT C — SESSION_STARTED notifies contractors + coordinators", () => {
  it("two coordinators each get their own message; re-run sends nothing", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", fullName: "A", email: "a@example.com", phone: "+966500000001", companyId: "c-1" });
    seedContractor(fake, { id: "u-b", fullName: "B", email: "b@example.com", phone: "+966500000002", companyId: "c-2" });
    seedCoordinator(fake, { id: "u-c1", email: "c1@example.com", phone: "+966555000001" });
    seedCoordinator(fake, { id: "u-c2", email: "c2@example.com", phone: "+966555000002" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-20T05:00:00Z"),
      endDate: new Date("2026-08-20T09:00:00Z"),
      status: "IN_PROGRESS",
      companies: [
        { companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" },
        { companyId: "c-2", count: 8, name: "Company B", nameAr: "الشركة ب" },
      ],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    const result = await runEvent("@/lib/notifications/session-events", "notifySessionStarted", "s-1");
    expect(result!.companies).toBe(2);
    expect(result!.coordinators).toBe(2);
    expect(result!.sent).toBe(12); // 3 channels × (2 contractors + 2 coordinators)

    // Both coordinators received their own email (not deduplicated against each other).
    const emails = emailSend.mock.calls.map((c) => c[0].to);
    expect(emails).toContain("c1@example.com");
    expect(emails).toContain("c2@example.com");
    expect(new Set(emails.filter((e) => e.endsWith("@example.com"))).size).toBe(4);

    // Each coordinator has a distinct ledger key and one in-app item.
    const logs = logRows(fake);
    expect(logs.some((l) => l.referenceId === "s-1:coordinator:u-c1" && l.companyId === null)).toBe(true);
    expect(logs.some((l) => l.referenceId === "s-1:coordinator:u-c2" && l.companyId === null)).toBe(true);
    const msgs = notifMessages(fake);
    expect(msgs.some((m) => m.userId === "u-c1" && m.message.includes("[session-started-s-1-coordinator-u-c1]"))).toBe(true);
    expect(msgs.some((m) => m.userId === "u-c2" && m.message.includes("[session-started-s-1-coordinator-u-c2]"))).toBe(true);

    // Re-run: nothing re-sent.
    emailSend.mockClear();
    waSend.mockClear();
    smsSend.mockClear();
    const second = await runEvent("@/lib/notifications/session-events", "notifySessionStarted", "s-1");
    expect(second!.sent).toBe(0);
    expect(emailSend).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENT D — ATTENDANCE_FINALIZED + SESSION_COMPLETED both fire on COMPLETED
// ─────────────────────────────────────────────────────────────────────────────

describe("EVENT D — ATTENDANCE_FINALIZED and SESSION_COMPLETED", () => {
  it("record two distinct types and never duplicate on re-run", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", email: "a@example.com", phone: "+966500000001", companyId: "c-1" });
    seedCoordinator(fake, { id: "u-c1", email: "c1@example.com", phone: "+966555000001" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-20T05:00:00Z"),
      endDate: new Date("2026-08-20T09:00:00Z"),
      status: "COMPLETED",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    await runEvent("@/lib/notifications/session-events", "notifyAttendanceFinalized", "s-1");
    await runEvent("@/lib/notifications/session-events", "notifySessionCompleted", "s-1");

    const logs = logRows(fake);
    expect(logs.filter((l) => l.type === "ATTENDANCE_FINALIZED")).toHaveLength(6); // 3 channels × (contractor + coordinator)
    expect(logs.filter((l) => l.type === "SESSION_COMPLETED")).toHaveLength(6);
    expect(emailSend).toHaveBeenCalledTimes(4); // 2 events × (contractor + coordinator)

    emailSend.mockClear();
    waSend.mockClear();
    smsSend.mockClear();

    await runEvent("@/lib/notifications/session-events", "notifyAttendanceFinalized", "s-1");
    await runEvent("@/lib/notifications/session-events", "notifySessionCompleted", "s-1");
    expect(emailSend).not.toHaveBeenCalled();
    expect(logRows(fake)).toHaveLength(12);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENT E — RESULTS_FINALIZED carries {{certificatesCount}} and dedupes
// ─────────────────────────────────────────────────────────────────────────────

describe("EVENT E — RESULTS_FINALIZED", () => {
  it("includes the certificate count and only sends once", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", email: "a@example.com", phone: "+966500000001", companyId: "c-1" });
    seedCoordinator(fake, { id: "u-c1", email: "c1@example.com", phone: "+966555000001" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-20T05:00:00Z"),
      endDate: new Date("2026-08-20T09:00:00Z"),
      status: "COMPLETED",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    const result = await runEvent("@/lib/notifications/session-events", "notifyResultsFinalized", "s-1", { certificatesCount: 7 });
    expect(result!.sent).toBe(6);

    const waBodies = waSend.mock.calls.map((c) => c[0].body);
    // The contractor recipient is seeded Arabic, the coordinator English — both
    // locales must carry the certificate count.
    expect(waBodies.some((b) => b.includes("الشهادات: 7"))).toBe(true);
    expect(waBodies.some((b) => b.includes("Certificates: 7"))).toBe(true);
    for (const body of waBodies) {
      expect(body).toContain("7");
    }
    const smsBodies = smsSend.mock.calls.map((c) => c[0].body);
    expect(smsBodies.some((b) => b.includes("7"))).toBe(true);

    emailSend.mockClear();
    waSend.mockClear();
    smsSend.mockClear();
    const second = await runEvent("@/lib/notifications/session-events", "notifyResultsFinalized", "s-1", { certificatesCount: 7 });
    expect(second!.sent).toBe(0);
    expect(emailSend).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENT F — channel independence for the new events
// ─────────────────────────────────────────────────────────────────────────────

describe("EVENT F — a failed WhatsApp never blocks Email/SMS or in-app", () => {
  it("SESSION_STARTED with WhatsApp FAILED still sends Email + SMS + in-app", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-a", email: "a@example.com", phone: "+966500000001", companyId: "c-1" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-20T05:00:00Z"),
      endDate: new Date("2026-08-20T09:00:00Z"),
      status: "IN_PROGRESS",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "FAILED", "SENT");

    const result = await runEvent("@/lib/notifications/session-events", "notifySessionStarted", "s-1");
    expect(result!.sent).toBe(2);
    expect(result!.failed).toBe(1);

    const statuses = Object.fromEntries(logRows(fake).map((l) => [l.channel, l.status]));
    expect(statuses).toEqual({ EMAIL: "SENT", WHATSAPP: "FAILED", SMS: "SENT" });
    expect(notifMessages(fake).some((m) => m.userId === "u-a")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENT G — bilingual {{var}} templates
// ─────────────────────────────────────────────────────────────────────────────

describe("EVENT G — templates use {{variables}} and substitute cleanly", () => {
  it("applyTemplate replaces every slot and leaves no {{...}} behind", () => {
    expect(applyTemplate("Hello {{name}}!", { name: "GCCLAB" })).toBe("Hello GCCLAB!");
    expect(applyTemplate("No vars", {})).toBe("No vars");
  });

  it("SESSION_STARTED renders Arabic content with values substituted", () => {
    const t = buildSessionStartedTemplates(
      "ar",
      {
        courseTitle: "الإسعافات الأولية",
        dateLabel: "20 أغسطس 2026",
        period: "MORNING",
        startTime: "8:00 ص",
        endTime: "12:00 م",
        location: "مركز GCCLAB للتدريب – الدمام",
        trainerName: "أحمد العباد",
        traineeCount: 5,
        sessionRef: "SES-000010",
      },
      {}
    );
    expect(t.email.subject).toContain("SES-000010");
    expect(t.whatsapp.body).toContain("الإسعافات الأولية");
    expect(t.whatsapp.body).toContain("الفترة: صباحية");
    expect(t.sms.body).toContain("الدمام");
    expect(t.inApp.messageAr).toContain("بدأت جلسة التدريب");
    // No unresolved {{...}} slots anywhere.
    expect(t.email.subject).not.toMatch(/\{\{/);
    expect(t.whatsapp.body).not.toMatch(/\{\{/);
    expect(t.sms.body).not.toMatch(/\{\{/);
    expect(t.inApp.message).not.toMatch(/\{\{/);
    expect(t.inApp.messageAr).not.toMatch(/\{\{/);
  });

  it("RESULTS_FINALIZED substitutes {{certificatesCount}}", () => {
    const t = buildResultsFinalizedTemplates(
      "en",
      {
        courseTitle: "First Aid",
        dateLabel: "20 Aug 2026",
        period: "MORNING",
        startTime: "8:00 am",
        endTime: "12:00 pm",
        location: "GCCLAB Training Center – Dammam",
        trainerName: "Ahmed",
        traineeCount: 5,
        sessionRef: "SES-000010",
      },
      { certificatesCount: 3 }
    );
    expect(t.sms.body).toContain("3 certificate(s)");
    expect(t.whatsapp.body).toContain("Certificates: 3");
    expect(t.inApp.message).toContain("3 certificate(s)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENT H — trainer without contact data never breaks the event
// ─────────────────────────────────────────────────────────────────────────────

describe("EVENT H — trainer with no contact details", () => {
  it("skips the trainer but still notifies the contractor", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-c", email: "a@example.com", phone: "+966500000001", companyId: "c-1" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-20T05:00:00Z"),
      endDate: new Date("2026-08-20T09:00:00Z"),
      trainer: { id: "tr-1", nameEn: "Ahmed Al-Abbad", nameAr: "أحمد العباد", email: null, phone: null, mobile: null },
      trainerId: "tr-1",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    const result = await runEvent("@/lib/notifications/session-events", "notifyTrainerAssigned", "s-1", { notifyContractors: true });
    expect(result!.trainers).toBe(0);
    expect(result!.companies).toBe(1);
    expect(result!.sent).toBe(3); // contractor only
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENT I — state guards
// ─────────────────────────────────────────────────────────────────────────────

describe("EVENT I — events only fire for their session state", () => {
  it("SESSION_SCHEDULED returns null for a COMPLETED session", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-c", email: "a@example.com", phone: "+966500000001", companyId: "c-1" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-20T05:00:00Z"),
      endDate: new Date("2026-08-20T09:00:00Z"),
      status: "COMPLETED",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    const scheduled = await runEvent("@/lib/notifications/session-events", "notifySessionScheduled", "s-1");
    expect(scheduled).toBeNull();
    const started = await runEvent("@/lib/notifications/session-events", "notifySessionStarted", "s-1");
    expect(started).toBeNull();
    const completed = await runEvent("@/lib/notifications/session-events", "notifySessionCompleted", "s-1");
    expect(completed!.sent).toBe(3);
  });

  it("SESSION_STARTED only fires for IN_PROGRESS sessions", async () => {
    const fake = createFakeDb();
    seedSession(fake, {
      id: "s-2", refNumber: "SES-000011",
      startDate: new Date("2026-08-20T05:00:00Z"),
      endDate: new Date("2026-08-20T09:00:00Z"),
      status: "SCHEDULED",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");
    const started = await runEvent("@/lib/notifications/session-events", "notifySessionStarted", "s-2");
    expect(started).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EVENT J — trainer with a linked user account gets an in-app item
// ─────────────────────────────────────────────────────────────────────────────

describe("EVENT J — trainer in-app notification", () => {
  it("creates an in-app item for the trainer's linked user", async () => {
    const fake = createFakeDb();
    seedContractor(fake, { id: "u-c", email: "a@example.com", phone: "+966500000001", companyId: "c-1" });
    seedSession(fake, {
      id: "s-1", refNumber: "SES-000010",
      startDate: new Date("2026-08-20T05:00:00Z"),
      endDate: new Date("2026-08-20T09:00:00Z"),
      trainer: { id: "tr-1", nameEn: "Ahmed Al-Abbad", nameAr: "أحمد العباد", email: "trainer@example.com", mobile: "+966511111111", user: { id: "u-tr", language: "ar" } },
      trainerId: "tr-1",
      companies: [{ companyId: "c-1", count: 5, name: "Company A", nameAr: "الشركة أ" }],
    });
    setupMocks(fake);
    setupProviderMocks("SENT", "SENT", "SENT");

    await runEvent("@/lib/notifications/session-events", "notifySessionScheduled", "s-1");
    const msgs = notifMessages(fake);
    expect(msgs.some((m) => m.userId === "u-tr" && m.messageAr.includes("تم جدولة جلسة التدريب"))).toBe(true);
  });
});
