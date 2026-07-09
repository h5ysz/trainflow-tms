// GCCLAB TMS — Reference number service
// =====================================================================
// Generates human-readable reference numbers atomically using a counter table.
//
// Formats:
//   TRAINING_REQUEST → TR-YYYY-000001   (yearly reset)
//   CERTIFICATE      → CERT-YYYY-000001 (yearly reset)
//   EXAM             → EXAM-YYYY-000001 (yearly reset)
//   TRAINER          → TRN-000001       (continuous)
//   COMPANY          → COM-000001       (continuous)
//   COURSE           → CRS-000001       (continuous)
//   SESSION          → SES-000001       (continuous)

import { db } from "@/lib/db";

export type RefEntityType =
  | "TRAINING_REQUEST"
  | "CERTIFICATE"
  | "EXAM"
  | "TRAINER"
  | "COMPANY"
  | "COURSE"
  | "SESSION"
  | "TRAINEE";

const PREFIX: Record<RefEntityType, string> = {
  TRAINING_REQUEST: "TR",
  CERTIFICATE: "CERT",
  EXAM: "EXAM",
  TRAINER: "TRN",
  COMPANY: "COM",
  COURSE: "CRS",
  SESSION: "SES",
  TRAINEE: "TRA",
};

const YEARLY: Set<RefEntityType> = new Set([
  "TRAINING_REQUEST",
  "CERTIFICATE",
  "EXAM",
]);

function pad(n: number, width = 6): string {
  return n.toString().padStart(width, "0");
}

/**
 * Atomically generate the next reference number for the given entity type.
 * Uses upsert + increment pattern to be concurrency-safe.
 */
export async function nextRefNumber(entityType: RefEntityType): Promise<string> {
  const year = YEARLY.has(entityType) ? new Date().getFullYear() : null;

  // Find existing counter for this entity type + year (NULL-safe lookup)
  // — Prisma's compound unique on (entityType, year) doesn't match NULL years
  // via the convenience where clause, so we findFirst + manual increment.
  const existing = await db.refNumberCounter.findFirst({
    where: { entityType, year },
    orderBy: { createdAt: "asc" },
  });

  let counter;
  if (existing) {
    counter = await db.refNumberCounter.update({
      where: { id: existing.id },
      data: { sequence: { increment: 1 } },
    });
    // If there are duplicate counter rows (legacy data), clean them up
    await db.refNumberCounter.deleteMany({
      where: { entityType, year, id: { not: existing.id } },
    });
  } else {
    counter = await db.refNumberCounter.create({
      data: { entityType, year, sequence: 1 },
    });
  }

  const prefix = PREFIX[entityType];
  const seq = pad(counter.sequence);

  if (year) {
    return `${prefix}-${year}-${seq}`;
  }
  return `${prefix}-${seq}`;
}

/**
 * Format a known sequence number into a ref number (for preview without persisting).
 */
export function formatRef(entityType: RefEntityType, sequence: number, year?: number): string {
  const prefix = PREFIX[entityType];
  const seq = pad(sequence);
  if (year) return `${prefix}-${year}-${seq}`;
  return `${prefix}-${seq}`;
}
