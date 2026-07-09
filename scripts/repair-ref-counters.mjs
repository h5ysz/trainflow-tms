// Repair RefNumberCounter rows orphaned by the NULL-year upsert bug.
//
// nextRefNumber() used to look up `year: year ?? 0` while creating with
// `year: null`. Because SQL treats NULLs as distinct, the @@unique([entityType,
// year]) lookup never matched and every call inserted a fresh counter at
// sequence 1 — handing out duplicate ref numbers and 500ing on the unique
// constraint for the second record of any continuous entity type.
//
// This consolidates the duplicates onto the year=0 sentinel and resets each
// sequence to the highest number actually in use.
//
//   node scripts/repair-ref-counters.mjs

import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

// Continuous (non-yearly) sequences and the table each one numbers.
const CONTINUOUS = [
  { entityType: "COMPANY", prefix: "COM", model: "company" },
  { entityType: "TRAINER", prefix: "TRN", model: "trainer" },
  { entityType: "COURSE", prefix: "CRS", model: "course" },
  { entityType: "SESSION", prefix: "SES", model: "trainingSession" },
  { entityType: "TRAINEE", prefix: "TRA", model: "trainee" },
];

function sequenceOf(refNumber, prefix) {
  const m = new RegExp(`^${prefix}-(\\d+)$`).exec(refNumber ?? "");
  return m ? parseInt(m[1], 10) : 0;
}

let repaired = 0;

for (const { entityType, prefix, model } of CONTINUOUS) {
  const rows = await db[model].findMany({ select: { refNumber: true } });
  const maxUsed = rows.reduce((max, r) => Math.max(max, sequenceOf(r.refNumber, prefix)), 0);

  const existing = await db.refNumberCounter.findMany({ where: { entityType } });
  const stale = existing.filter((c) => c.year === null);

  if (stale.length === 0 && existing.length <= 1) {
    console.log(`  ${entityType.padEnd(8)} ok (max in use: ${maxUsed})`);
    continue;
  }

  await db.refNumberCounter.deleteMany({ where: { entityType } });
  await db.refNumberCounter.create({
    data: { entityType, year: 0, sequence: maxUsed },
  });

  console.log(
    `  ${entityType.padEnd(8)} removed ${existing.length} counter(s), reset to sequence=${maxUsed}`
  );
  repaired++;
}

console.log(repaired === 0 ? "\nNothing to repair." : `\nRepaired ${repaired} counter(s).`);
await db.$disconnect();
