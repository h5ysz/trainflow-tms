// Pure helpers from the public check-in path. The QR activity window is the primary
// control on a code that anyone in the room can photograph, so its boundaries matter.
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

const { windowState, qrWindow } = await import("@/lib/sessions/check-in-service");

const session = {
  qrActiveFrom: new Date("2026-03-10T08:00:00Z"),
  qrActiveTo: new Date("2026-03-10T17:00:00Z"),
  startDate: new Date("2026-03-10T09:00:00Z"),
  endDate: new Date("2026-03-10T15:00:00Z"),
};

describe("qrWindow", () => {
  it("prefers the explicit QR window over the session times", () => {
    const { from, to } = qrWindow(session);
    expect(from.toISOString()).toBe("2026-03-10T08:00:00.000Z");
    expect(to.toISOString()).toBe("2026-03-10T17:00:00.000Z");
  });

  it("falls back to the session times when no window is set", () => {
    const { from, to } = qrWindow({ ...session, qrActiveFrom: null, qrActiveTo: null });
    expect(from.toISOString()).toBe("2026-03-10T09:00:00.000Z");
    expect(to.toISOString()).toBe("2026-03-10T15:00:00.000Z");
  });
});

describe("windowState", () => {
  it("is NOT_YET before the window opens", () => {
    expect(windowState(session, new Date("2026-03-10T07:59:59Z"))).toBe("NOT_YET");
  });

  it("is OPEN at the opening instant", () => {
    expect(windowState(session, new Date("2026-03-10T08:00:00Z"))).toBe("OPEN");
  });

  it("is OPEN during the window", () => {
    expect(windowState(session, new Date("2026-03-10T12:00:00Z"))).toBe("OPEN");
  });

  it("is OPEN at the closing instant", () => {
    expect(windowState(session, new Date("2026-03-10T17:00:00Z"))).toBe("OPEN");
  });

  it("is CLOSED after the window", () => {
    expect(windowState(session, new Date("2026-03-10T17:00:01Z"))).toBe("CLOSED");
  });

  it("closes immediately when qrActiveTo is set to now", () => {
    // How a trainer stops further check-ins mid-session.
    const closed = { ...session, qrActiveTo: new Date("2026-03-10T12:00:00Z") };
    expect(windowState(closed, new Date("2026-03-10T12:00:01Z"))).toBe("CLOSED");
  });
});
