// GCCLAB TMS — Auto-generated Course.code helper, shared by every bulk-import
// route that may encounter a course title with no matching Course record yet.
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

type DbClient = typeof db | Prisma.TransactionClient;

// When called from inside a db.$transaction, pass the tx handle as `client` —
// SQLite only allows one writer at a time, so querying via the global `db`
// connection while an interactive transaction holds the write lock deadlocks
// until the transaction (and query) timeouts fire.
export async function generateCourseCode(title: string, client: DbClient = db): Promise<string> {
  const base = title.replace(/[^a-zA-Z0-9]+/g, "-").toUpperCase().slice(0, 12).replace(/^-+|-+$/g, "") || "CRS";
  for (let i = 0; i < 5; i++) {
    const candidate = `${base}-${randomBytes(2).toString("hex").toUpperCase()}`;
    const exists = await client.course.findFirst({ where: { code: candidate } });
    if (!exists) return candidate;
  }
  return `AUTO-${randomBytes(4).toString("hex").toUpperCase()}`;
}
