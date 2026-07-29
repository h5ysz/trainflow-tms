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
import type { Prisma } from "@prisma/client";

type DbClient = typeof db | Prisma.TransactionClient;

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
  // Sprint 6: enterprise certificate number format.
  // Old: CERT-YYYY-000001 (still readable by the system for legacy certs)
  // New: GCCLAB-ES-YYYY-000001 (the "ES" segment = "Enterprise Safety")
  CERTIFICATE: "GCCLAB-ES",
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
export async function nextRefNumber(entityType: RefEntityType, client: DbClient = db): Promise<string> {
  const year = YEARLY.has(entityType) ? new Date().getFullYear() : null;

  // Continuous sequences are keyed on year 0 rather than NULL. A NULL year can
  // never satisfy the @@unique([entityType, year]) lookup — SQL treats NULLs as
  // distinct — so the upsert would insert a fresh counter at sequence 1 on
  // every call and hand out a duplicate ref number.
  const yearKey = year ?? 0;

  // Atomic increment via upsert (safe under concurrent requests). When called
  // from inside a db.$transaction, `client` must be the tx handle — SQLite only
  // allows one writer at a time, so writing via the global `db` connection
  // while an interactive transaction holds the write lock deadlocks until the
  // transaction (and query) timeouts fire.
  const counter = await client.refNumberCounter.upsert({
    where: {
      entityType_year: { entityType, year: yearKey },
    },
    update: { sequence: { increment: 1 } },
    create: { entityType, year: yearKey, sequence: 1 },
  });

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
