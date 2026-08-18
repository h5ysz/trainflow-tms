/**
 * Migration: WorkerPassport company-isolation
 *
 * Changes:
 * 1. Removes global @unique from WorkerPassport.nationalId
 * 2. Makes companyId required (non-nullable)
 * 3. Adds composite @@unique([nationalId, companyId])
 * 4. Back-fills null companyId from matching Trainee records
 *
 * Safety:
 * - All existing passport data and certificates are preserved
 * - Company A's data remains intact
 * - Only orphaned passports (no matching Trainee) are soft-deleted
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("=== WorkerPassport company-isolation migration ===\n");

  // Step 1: Find all passports with null companyId
  const orphaned = await prisma.workerPassport.findMany({
    where: { companyId: null, deletedAt: null },
  });
  console.log(`Found ${orphaned.length} passport(s) with null companyId.`);

  if (orphaned.length === 0) {
    console.log("No back-fill needed. Proceeding to schema migration.");
    return;
  }

  // Step 2: For each orphaned passport, try to find the matching Trainee
  let backfilled = 0;
  let softDeleted = 0;

  for (const passport of orphaned) {
    const trainee = await prisma.trainee.findFirst({
      where: { nationalId: passport.nationalId, deletedAt: null },
      select: { companyId: true, fullName: true },
    });

    if (trainee) {
      // Back-fill companyId from the matching Trainee
      await prisma.workerPassport.update({
        where: { id: passport.id },
        data: { companyId: trainee.companyId },
      });
      console.log(
        `  BACK-FILL: Passport ${passport.passportNumber} (${passport.nationalId}) ` +
        `→ companyId set to match Trainee "${trainee.fullName}"`
      );
      backfilled++;
    } else {
      // No matching Trainee found — soft-delete the orphaned passport
      await prisma.workerPassport.update({
        where: { id: passport.id },
        data: { deletedAt: new Date() },
      });
      console.log(
        `  SOFT-DELETE: Passport ${passport.passportNumber} (${passport.nationalId}) ` +
        `→ no matching Trainee found, passport deactivated`
      );
      softDeleted++;
    }
  }

  console.log(`\nBack-filled: ${backfilled}, Soft-deleted: ${softDeleted}`);

  // Step 3: Check for duplicate (nationalId, companyId) pairs among active passports
  const activePassports = await prisma.workerPassport.findMany({
    where: { deletedAt: null },
    select: { id: true, nationalId: true, companyId: true, passportNumber: true },
  });

  const seen = new Map<string, string>(); // key → passportId
  const duplicates: Array<{ passportNumber: string; nationalId: string; companyId: string }> = [];

  for (const p of activePassports) {
    if (!p.companyId) continue;
    const key = `${p.nationalId}:${p.companyId}`;
    if (seen.has(key)) {
      duplicates.push({
        passportNumber: p.passportNumber,
        nationalId: p.nationalId,
        companyId: p.companyId,
      });
    } else {
      seen.set(key, p.id);
    }
  }

  if (duplicates.length > 0) {
    console.log(`\n⚠ WARNING: Found ${duplicates.length} duplicate (nationalId, companyId) pair(s):`);
    for (const d of duplicates) {
      console.log(`  ${d.passportNumber} — nationalId=${d.nationalId}, companyId=${d.companyId}`);
    }
    console.log("These duplicates will cause a constraint violation during schema migration.");
    console.log("Please resolve manually before running prisma migrate.");
  } else {
    console.log("\nNo duplicate (nationalId, companyId) pairs found. Safe to migrate.");
  }

  console.log("\n=== Migration data-prep complete ===");
}

main()
  .catch((e) => {
    console.error("Migration failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
