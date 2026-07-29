// Runs against a real SQLite database, because the invariant under test is a claim
// about the database engine that a mock cannot prove: SQL treats NULLs as distinct, so
// a NULL year could never satisfy the @@unique([entityType, year]) lookup and every
// call would insert a fresh counter at sequence 1 — handing out duplicate references.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { nextRefNumber } from "@/lib/api/ref-number";

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = new PrismaClient();
  await prisma.$connect();
  await prisma.refNumberCounter.deleteMany({});
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("nextRefNumber against a real database", () => {
  it("never repeats a continuous reference number", async () => {
    const refs = new Set<string>();
    for (let i = 0; i < 25; i++) {
      refs.add(await nextRefNumber("SESSION", prisma));
    }
    expect(refs.size).toBe(25);
  });

  it("increments monotonically from one", async () => {
    await prisma.refNumberCounter.deleteMany({ where: { entityType: "COMPANY" } });
    expect(await nextRefNumber("COMPANY", prisma)).toBe("COM-000001");
    expect(await nextRefNumber("COMPANY", prisma)).toBe("COM-000002");
    expect(await nextRefNumber("COMPANY", prisma)).toBe("COM-000003");
  });

  it("keeps one counter row per entity type rather than one per call", async () => {
    await prisma.refNumberCounter.deleteMany({ where: { entityType: "COURSE" } });
    for (let i = 0; i < 5; i++) await nextRefNumber("COURSE", prisma);

    const rows = await prisma.refNumberCounter.findMany({ where: { entityType: "COURSE" } });
    expect(rows).toHaveLength(1);
    expect(rows[0].sequence).toBe(5);
    expect(rows[0].year).toBe(0); // the whole point: 0, never NULL
  });

  it("keeps yearly and continuous sequences independent", async () => {
    await prisma.refNumberCounter.deleteMany({ where: { entityType: { in: ["CERTIFICATE", "TRAINER"] } } });
    const year = new Date().getFullYear();

    expect(await nextRefNumber("CERTIFICATE", prisma)).toBe(`CERT-${year}-000001`);
    expect(await nextRefNumber("TRAINER", prisma)).toBe("TRN-000001");
    expect(await nextRefNumber("CERTIFICATE", prisma)).toBe(`CERT-${year}-000002`);
  });

  it("does not collide under concurrent allocation", async () => {
    await prisma.refNumberCounter.deleteMany({ where: { entityType: "TRAINEE" } });
    const refs = await Promise.all(
      Array.from({ length: 10 }, () => nextRefNumber("TRAINEE", prisma))
    );
    expect(new Set(refs).size).toBe(10);
  });
});
