// Cron evaluation decides when scheduled reports go out. The timezone field was stored
// on every schedule and never read, so on a UTC host every Asia/Riyadh schedule fired
// three hours late.
import { describe, it, expect } from "vitest";
import {
  cronMatches,
  getNextRunTime,
  buildCronExpression,
  zonedParts,
  DEFAULT_TIMEZONE,
} from "@/lib/reports/scheduler";

/** An instant expressed in UTC, for unambiguous assertions. */
function utc(iso: string): Date {
  return new Date(iso);
}

describe("zonedParts", () => {
  it("reports calendar fields as observed in the target zone", () => {
    // 06:00 UTC is 09:00 in Riyadh (UTC+3, no DST).
    const parts = zonedParts(utc("2026-03-10T06:00:00Z"), "Asia/Riyadh");
    expect(parts.hour).toBe(9);
    expect(parts.minute).toBe(0);
    expect(parts.day).toBe(10);
    expect(parts.month).toBe(3);
  });

  it("rolls the date over when the zone offset crosses midnight", () => {
    // 22:30 UTC on the 9th is 01:30 on the 10th in Riyadh.
    const parts = zonedParts(utc("2026-03-09T22:30:00Z"), "Asia/Riyadh");
    expect(parts.hour).toBe(1);
    expect(parts.day).toBe(10);
  });

  it("reports midnight as hour 0, not 24", () => {
    expect(zonedParts(utc("2026-03-09T21:00:00Z"), "Asia/Riyadh").hour).toBe(0);
  });
});

describe("cronMatches — timezone", () => {
  it("matches 09:00 Riyadh at 06:00 UTC, not at 09:00 UTC", () => {
    const expr = "0 9 * * *";
    expect(cronMatches(expr, utc("2026-03-10T06:00:00Z"), "Asia/Riyadh")).toBe(true);
    expect(cronMatches(expr, utc("2026-03-10T09:00:00Z"), "Asia/Riyadh")).toBe(false);
  });

  it("evaluates the same expression differently per zone", () => {
    const expr = "0 9 * * *";
    const instant = utc("2026-03-10T09:00:00Z");
    expect(cronMatches(expr, instant, "UTC")).toBe(true);
    expect(cronMatches(expr, instant, "Asia/Riyadh")).toBe(false);
  });

  it("uses the target zone's day of week near midnight", () => {
    // 21:30 UTC Monday is 00:30 Tuesday in Riyadh. Tuesday is day 2.
    const instant = utc("2026-03-09T21:30:00Z"); // Monday in UTC
    expect(cronMatches("30 0 * * 2", instant, "Asia/Riyadh")).toBe(true);
    expect(cronMatches("30 0 * * 1", instant, "Asia/Riyadh")).toBe(false);
  });

  it("defaults to Asia/Riyadh", () => {
    expect(DEFAULT_TIMEZONE).toBe("Asia/Riyadh");
    expect(cronMatches("0 9 * * *", utc("2026-03-10T06:00:00Z"))).toBe(true);
  });
});

describe("cronMatches — field syntax", () => {
  const t = utc("2026-03-10T06:00:00Z"); // 09:00, Tuesday 10 March, in Riyadh

  it("matches wildcards", () => {
    expect(cronMatches("* * * * *", t, "Asia/Riyadh")).toBe(true);
  });

  it("matches lists", () => {
    expect(cronMatches("0 8,9,10 * * *", t, "Asia/Riyadh")).toBe(true);
    expect(cronMatches("0 8,10 * * *", t, "Asia/Riyadh")).toBe(false);
  });

  it("matches ranges", () => {
    expect(cronMatches("0 8-10 * * *", t, "Asia/Riyadh")).toBe(true);
    expect(cronMatches("0 10-12 * * *", t, "Asia/Riyadh")).toBe(false);
  });

  it("rejects a reversed range rather than matching oddly", () => {
    expect(cronMatches("0 10-8 * * *", t, "Asia/Riyadh")).toBe(false);
  });

  it("counts steps from the field's minimum", () => {
    // Day-of-month starts at 1, so */5 must match the 1st, 6th, 11th …
    // Counting `value % step` instead matched the 5th and 10th but never the 1st.
    const first = utc("2026-03-01T06:00:00Z");
    expect(cronMatches("0 9 */5 * *", first, "Asia/Riyadh")).toBe(true);
    const sixth = utc("2026-03-06T06:00:00Z");
    expect(cronMatches("0 9 */5 * *", sixth, "Asia/Riyadh")).toBe(true);
    const fifth = utc("2026-03-05T06:00:00Z");
    expect(cronMatches("0 9 */5 * *", fifth, "Asia/Riyadh")).toBe(false);
  });

  it("rejects a zero step instead of dividing by zero", () => {
    expect(cronMatches("0 9 */0 * *", t, "Asia/Riyadh")).toBe(false);
  });

  it("rejects expressions with the wrong number of fields", () => {
    expect(cronMatches("0 9 * *", t, "Asia/Riyadh")).toBe(false);
    expect(cronMatches("0 9 * * * *", t, "Asia/Riyadh")).toBe(false);
    expect(cronMatches("", t, "Asia/Riyadh")).toBe(false);
  });

  it("rejects a non-numeric field", () => {
    expect(cronMatches("0 nine * * *", t, "Asia/Riyadh")).toBe(false);
  });
});

describe("getNextRunTime", () => {
  it("returns the next instant matching the expression in the target zone", () => {
    const after = utc("2026-03-10T03:00:00Z"); // 06:00 Riyadh
    const next = getNextRunTime("0 9 * * *", after, "Asia/Riyadh");
    expect(next.toISOString()).toBe("2026-03-10T06:00:00.000Z"); // 09:00 Riyadh
  });

  it("rolls to the following day once today's slot has passed", () => {
    const after = utc("2026-03-10T07:00:00Z"); // 10:00 Riyadh, past 09:00
    const next = getNextRunTime("0 9 * * *", after, "Asia/Riyadh");
    expect(next.toISOString()).toBe("2026-03-11T06:00:00.000Z");
  });

  it("always returns a time strictly after the reference instant", () => {
    const after = utc("2026-03-10T06:00:00Z"); // exactly a matching minute
    const next = getNextRunTime("0 9 * * *", after, "Asia/Riyadh");
    expect(next.getTime()).toBeGreaterThan(after.getTime());
  });

  it("finds a monthly slot more than a week out", () => {
    // The old 7-day search window could not reach the next monthly occurrence and fell
    // back to "7 days from now", firing the schedule on the wrong date.
    const after = utc("2026-03-02T00:00:00Z");
    const next = getNextRunTime("0 9 1 * *", after, "Asia/Riyadh");
    expect(zonedParts(next, "Asia/Riyadh").day).toBe(1);
    expect(zonedParts(next, "Asia/Riyadh").month).toBe(4);
  });

  it("handles a DST transition in a zone that observes it", () => {
    // Europe/London springs forward on 29 March 2026 at 01:00 UTC.
    const after = utc("2026-03-28T12:00:00Z");
    const next = getNextRunTime("0 9 * * *", after, "Europe/London");
    expect(zonedParts(next, "Europe/London").hour).toBe(9);
  });
});

describe("buildCronExpression", () => {
  it("builds a weekly expression", () => {
    expect(buildCronExpression({ scheduleType: "WEEKLY", executionTime: "09:30", dayOfWeek: 1 }))
      .toBe("30 9 * * 1");
  });

  it("builds a monthly expression", () => {
    expect(buildCronExpression({ scheduleType: "MONTHLY", executionTime: "08:00", dayOfMonth: 15 }))
      .toBe("0 8 15 * *");
  });

  it("builds a daily expression", () => {
    expect(buildCronExpression({ scheduleType: "DAILY", executionTime: "23:45" })).toBe("45 23 * * *");
  });

  it("passes a custom expression through", () => {
    expect(buildCronExpression({ scheduleType: "CUSTOM", customCron: "*/15 * * * *" }))
      .toBe("*/15 * * * *");
  });

  it("round-trips through cronMatches", () => {
    const expr = buildCronExpression({ scheduleType: "WEEKLY", executionTime: "09:00", dayOfWeek: 2 });
    // Tuesday 10 March 2026, 09:00 Riyadh.
    expect(cronMatches(expr, utc("2026-03-10T06:00:00Z"), "Asia/Riyadh")).toBe(true);
  });
});
