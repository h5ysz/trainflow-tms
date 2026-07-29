// Creates a throwaway SQLite database for the integration suite.
//
// Deliberately not db/custom.db: that file is tracked in git, and a test run must never
// modify it.
import { execSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const TMP_DIR = join(process.cwd(), ".tmp");
const DB_FILE = join(TMP_DIR, "integration-test.db");

export async function setup() {
  mkdirSync(TMP_DIR, { recursive: true });
  rmSync(DB_FILE, { force: true });

  // Prisma resolves a relative sqlite path against the schema directory, so this is
  // absolute to remove all doubt.
  process.env.DATABASE_URL = `file:${DB_FILE.replace(/\\/g, "/")}`;

  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env },
  });
}

export async function teardown() {
  rmSync(DB_FILE, { force: true });
}
