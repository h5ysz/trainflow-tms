// Trainer Claim calculation engine — business rules against the real reference sheets.
// Pure unit tests: no DB, no mocks.
import { describe, expect, it } from "vitest";
import {
  computeClaim,
  overtimeCapHours,
  expandSessionDays,
  type ClaimSessionInput,
  type ClaimConfigInput,
  type ClaimType,
  type EngagementType,
} from "@/lib/claims/engine";

// Dates (UTC) used throughout — June 2026:
//   Mon 22 = weekday 1 (cap 4), Fri 26 = weekday 5 (cap 12), Sat 27 = weekday 6 (cap 12).
const MON = "2026-06-22";
const FRI = "2026-06-26";
const SAT = "2026-06-27";

const cfg: ClaimConfigInput = {
  mainLocation: "Dammam",
  employeeDailyAllowance: 600,
  contractorDailyAllowance: 900,
};

function day(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}

function session(over: Partial<ClaimSessionInput> & { id: string; durationHours: number; startDate: Date; endDate: Date }): ClaimSessionInput {
  return { courseCode: "OSH-101", courseTitle: "OHS Awareness", city: "Dammam", location: null, shift: "EVENING", ...over };
}

function run(claimType: ClaimType, engagementType: EngagementType, sessions: ClaimSessionInput[], from = MON, to = SAT) {
  return computeClaim(sessions, { claimType, engagementType, periodFrom: day(from), periodTo: day(to), config: cfg });
}

describe("overtimeCapHours", () => {
  it("is 4h Sun–Thu and 12h Fri/Sat", () => {
    expect(overtimeCapHours(day(MON))).toBe(4); // Monday
    expect(overtimeCapHours(day(FRI))).toBe(12); // Friday
    expect(overtimeCapHours(day(SAT))).toBe(12); // Saturday
    expect(overtimeCapHours(day("2026-06-21"))).toBe(4); // Sunday
  });
});

describe("employee overtime", () => {
  it("a weekday session is worth the 4h daily cap regardless of duration", () => {
    const r = run("OVERTIME", "EMPLOYEE", [session({ id: "s1", durationHours: 6, startDate: day(MON), endDate: day(MON) })], MON, MON);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].value).toBe(4);
    expect(r.items[0].unit).toBe("HOURS");
    expect(r.items[0].actualHours).toBe(6);
    expect(r.items[0].rate).toBeNull();
    expect(r.totalHours).toBe(4);
    expect(r.totalDays).toBe(0);
  });

  it("a Friday session is worth the 12h weekend cap", () => {
    const r = run("OVERTIME", "EMPLOYEE", [session({ id: "s1", durationHours: 6, startDate: day(FRI), endDate: day(FRI) })], FRI, FRI);
    expect(r.items[0].value).toBe(12);
  });

  it("a Saturday session is worth the 12h weekend cap", () => {
    const r = run("OVERTIME", "EMPLOYEE", [session({ id: "s1", durationHours: 4, startDate: day(SAT), endDate: day(SAT) })], SAT, SAT);
    expect(r.items[0].value).toBe(12);
  });

  it("two sessions on a Friday split the 12h cap proportionally — 6 + 6 (reference)", () => {
    const r = run("OVERTIME", "EMPLOYEE", [
      session({ id: "s1", durationHours: 6, startDate: day(FRI), endDate: day(FRI) }),
      session({ id: "s2", durationHours: 6, startDate: day(FRI), endDate: day(FRI) }),
    ], FRI, FRI);
    expect(r.items).toHaveLength(2);
    expect(r.items[0].value).toBe(6);
    expect(r.items[1].value).toBe(6);
    expect(r.totalHours).toBe(12);
  });

  it("multiple weekday sessions still total the 4h cap", () => {
    const r = run("OVERTIME", "EMPLOYEE", [
      session({ id: "s1", durationHours: 2, startDate: day(MON), endDate: day(MON) }),
      session({ id: "s2", durationHours: 4, startDate: day(MON), endDate: day(MON) }),
    ], MON, MON);
    expect(r.totalHours).toBe(4);
    expect(r.items[0].value + r.items[1].value).toBe(4);
  });

  it("an afternoon hours-only session still earns the full daily cap", () => {
    const r = run("OVERTIME", "EMPLOYEE", [session({ id: "s1", durationHours: 3, startDate: day(MON), endDate: day(MON) })], MON, MON);
    expect(r.items[0].value).toBe(4);
  });
});

describe("contractor overtime = regular hours", () => {
  it("records actual session hours with no cap and no OT labeling", () => {
    const r = run("OVERTIME", "CONTRACTOR", [
      session({ id: "s1", durationHours: 8, startDate: day(MON), endDate: day(MON) }),
      session({ id: "s2", durationHours: 8, startDate: day(FRI), endDate: day(FRI) }),
    ], MON, FRI);
    expect(r.items).toHaveLength(2);
    expect(r.items.map((i) => i.value)).toEqual([8, 8]);
    expect(r.totalHours).toBe(16);
    expect(r.items[0].rate).toBeNull();
  });
});

describe("business mission", () => {
  it("one qualifying away day earns one mission day at the employee rate", () => {
    const r = run("BUSINESS_MISSION", "EMPLOYEE", [session({ id: "s1", durationHours: 6, city: "Al Qassim", startDate: day(MON), endDate: day(MON) })], MON, MON);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].value).toBe(1);
    expect(r.items[0].unit).toBe("DAYS");
    expect(r.items[0].rate).toBe(600);
    expect(r.items[0].amount).toBe(600);
    expect(r.totalDays).toBe(1);
    expect(r.totalAmount).toBe(600);
  });

  it("multiple away sessions on the same day still count one mission day", () => {
    const r = run("BUSINESS_MISSION", "EMPLOYEE", [
      session({ id: "s1", durationHours: 6, city: "Al Qassim", startDate: day(MON), endDate: day(MON) }),
      session({ id: "s2", durationHours: 6, city: "Al Qassim", startDate: day(MON), endDate: day(MON) }),
    ], MON, MON);
    expect(r.items).toHaveLength(1);
    expect(r.totalDays).toBe(1);
  });

  it("a contractor away day earns the contractor rate", () => {
    const r = run("BUSINESS_MISSION", "CONTRACTOR", [session({ id: "s1", durationHours: 8, city: "Al Qassim", startDate: day(MON), endDate: day(MON) })], MON, MON);
    expect(r.items[0].rate).toBe(900);
    expect(r.items[0].amount).toBe(900);
  });

  it("a day at the main location does not qualify", () => {
    const r = run("BUSINESS_MISSION", "EMPLOYEE", [session({ id: "s1", durationHours: 6, city: "Dammam", startDate: day(MON), endDate: day(MON) })], MON, MON);
    expect(r.items).toHaveLength(0);
    expect(r.totalDays).toBe(0);
  });

  it("a day with no location is flagged and conservatively counted", () => {
    const r = run("BUSINESS_MISSION", "EMPLOYEE", [session({ id: "s1", durationHours: 6, city: null, location: null, startDate: day(MON), endDate: day(MON) })], MON, MON);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].locationFlagged).toBe(true);
    expect(r.items[0].flagReason).toContain("Missing location");
    expect(r.items[0].value).toBe(1);
    expect(r.totalDays).toBe(1);
  });

  it("a mixed main+away day is flagged and counted", () => {
    const r = run("BUSINESS_MISSION", "EMPLOYEE", [
      session({ id: "s1", durationHours: 6, city: "Dammam", startDate: day(MON), endDate: day(MON) }),
      session({ id: "s2", durationHours: 6, city: "Al Qassim", startDate: day(MON), endDate: day(MON) }),
    ], MON, MON);
    expect(r.items).toHaveLength(1);
    expect(r.items[0].locationFlagged).toBe(true);
    expect(r.items[0].flagReason).toContain("Mixed locations");
  });

  it("does not double-count the same qualifying day across sessions spanning multiple days", () => {
    const r = run("BUSINESS_MISSION", "EMPLOYEE", [
      session({ id: "s1", durationHours: 6, city: "Al Qassim", startDate: day("2026-06-22"), endDate: day("2026-06-24") }),
    ], "2026-06-22", "2026-06-24");
    expect(r.items).toHaveLength(3);
    expect(r.totalDays).toBe(3);
    expect(r.totalAmount).toBe(1800);
  });
});

describe("period clipping and multi-day expansion", () => {
  it("expands a multi-day session into one row per day", () => {
    const days = expandSessionDays(session({ id: "s1", durationHours: 6, startDate: day("2026-06-22"), endDate: day("2026-06-24") }), day("2026-06-20"), day("2026-06-30"));
    expect(days).toHaveLength(3);
    expect(days.map((d) => d.date.toISOString().slice(0, 10))).toEqual(["2026-06-22", "2026-06-23", "2026-06-24"]);
    expect(days.every((d) => d.actualHours === 6)).toBe(true);
  });

  it("clips days outside the claim period", () => {
    const days = expandSessionDays(session({ id: "s1", durationHours: 6, startDate: day("2026-06-19"), endDate: day("2026-06-23") }), day("2026-06-21"), day("2026-06-22"));
    expect(days.map((d) => d.date.toISOString().slice(0, 10))).toEqual(["2026-06-21", "2026-06-22"]);
  });
});
