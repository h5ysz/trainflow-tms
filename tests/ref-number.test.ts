import { describe, it, expect, vi, beforeEach } from "vitest";

const upsert = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { refNumberCounter: { upsert: (...a: unknown[]) => upsert(...a) } },
}));

const { nextRefNumber, formatRef } = await import("@/lib/api/ref-number");

beforeEach(() => {
  vi.clearAllMocks();
  upsert.mockResolvedValue({ sequence: 1 });
});

describe("formatRef", () => {
  it("formats a yearly reference", () => {
    expect(formatRef("CERTIFICATE", 1, 2026)).toBe("CERT-2026-000001");
    expect(formatRef("TRAINING_REQUEST", 42, 2026)).toBe("TR-2026-000042");
    expect(formatRef("EXAM", 7, 2026)).toBe("EXAM-2026-000007");
  });

  it("formats a continuous reference", () => {
    expect(formatRef("TRAINER", 1)).toBe("TRN-000001");
    expect(formatRef("COMPANY", 999999)).toBe("COM-999999");
    expect(formatRef("SESSION", 5)).toBe("SES-000005");
  });

  it("pads to six digits and does not truncate beyond that", () => {
    expect(formatRef("COURSE", 1)).toBe("CRS-000001");
    expect(formatRef("COURSE", 1234567)).toBe("CRS-1234567");
  });
});

describe("nextRefNumber", () => {
  it("keys continuous counters on year 0, never NULL", () => {
    // SQL treats NULLs as distinct, so a NULL year can never satisfy the
    // @@unique([entityType, year]) lookup: the upsert would insert a fresh counter at
    // sequence 1 on every call and hand out duplicate reference numbers.
    return nextRefNumber("TRAINER").then(() => {
      const arg = upsert.mock.calls[0][0] as { where: { entityType_year: { year: number } } };
      expect(arg.where.entityType_year.year).toBe(0);
      expect(arg.where.entityType_year.year).not.toBeNull();
    });
  });

  it("keys yearly counters on the current year", async () => {
    await nextRefNumber("CERTIFICATE");
    const arg = upsert.mock.calls[0][0] as { where: { entityType_year: { year: number } } };
    expect(arg.where.entityType_year.year).toBe(new Date().getFullYear());
  });

  it("includes the year in a yearly reference and omits it from a continuous one", async () => {
    upsert.mockResolvedValue({ sequence: 3 });
    const year = new Date().getFullYear();
    expect(await nextRefNumber("CERTIFICATE")).toBe(`CERT-${year}-000003`);
    expect(await nextRefNumber("TRAINER")).toBe("TRN-000003");
  });

  it("increments rather than overwriting the counter", async () => {
    await nextRefNumber("SESSION");
    const arg = upsert.mock.calls[0][0] as { update: { sequence: { increment: number } } };
    expect(arg.update.sequence).toEqual({ increment: 1 });
  });

  it("uses the supplied transaction client instead of the global one", async () => {
    // SQLite allows one writer: issuing this write on the global connection while an
    // interactive transaction holds the lock deadlocks until the timeouts fire.
    const txUpsert = vi.fn().mockResolvedValue({ sequence: 9 });
    const tx = { refNumberCounter: { upsert: txUpsert } };

     
    const ref = await nextRefNumber("SESSION", tx as any);

    expect(ref).toBe("SES-000009");
    expect(txUpsert).toHaveBeenCalledTimes(1);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("gives every entity type a distinct prefix", async () => {
    const types = [
      "TRAINING_REQUEST", "CERTIFICATE", "EXAM", "TRAINER",
      "COMPANY", "COURSE", "SESSION", "TRAINEE",
    ] as const;
    const prefixes = types.map((t) => formatRef(t, 1).split("-")[0]);
    expect(new Set(prefixes).size).toBe(prefixes.length);
  });
});
