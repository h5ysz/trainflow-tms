// Phase 2 backfill — copy any `Trainee.idAttachmentUrl` value into the
// `Trainee.documents` JSON array as a `{type:"id"}` entry, IF that URL is
// not already represented in documents[].
//
// This is a one-time migration script. After it runs, every trainee's
// attachments live in documents[] (the new single source of truth). The
// `idAttachmentUrl` column is left untouched (still has its old value),
// but is no longer read by any code path after Phase 3.
//
// Safety:
//   - Idempotent: running twice is a no-op (the URL is already in documents[]).
//   - Additive only: never removes or modifies existing documents[] entries.
//   - Does NOT clear idAttachmentUrl column (deferred to Phase 5).
//   - Does NOT modify the schema (no Prisma migration).
//
// Usage:
//   node scripts/backfill-id-attachment-into-documents.js
//
// Output: prints a summary of how many trainees were updated and a table of
// what was added per trainee.
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

function parseDocs(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function deriveFilenameFromUrl(url) {
  if (!url) return "id-attachment";
  const last = url.split("/").pop();
  if (!last) return "id-attachment";
  // If the last segment looks like a random hex hash (32 chars + ext), show
  // a friendlier label. Otherwise use the segment as-is.
  if (/^[a-f0-9]{32}\./.test(last)) {
    const ext = last.split(".").pop() ?? "file";
    return `id-attachment.${ext}`;
  }
  return last;
}

async function main() {
  const trainees = await prisma.trainee.findMany({
    where: {
      deletedAt: null,
      // Only rows that still have a value in the legacy column.
      idAttachmentUrl: { not: null },
    },
    select: {
      id: true,
      refNumber: true,
      fullName: true,
      nationalId: true,
      idAttachmentUrl: true,
      documents: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  console.log(`Found ${trainees.length} trainee row(s) with idAttachmentUrl != null.`);

  let updatedCount = 0;
  let skippedAlreadyPresent = 0;
  let skippedInvalidUrl = 0;
  const updates = [];

  for (const t of trainees) {
    const url = t.idAttachmentUrl;
    if (!url || typeof url !== "string" || url.trim() === "") {
      skippedInvalidUrl++;
      continue;
    }

    const docs = parseDocs(t.documents);
    const alreadyPresent = docs.some(
      (d) => d && typeof d.url === "string" && d.url === url,
    );
    if (alreadyPresent) {
      skippedAlreadyPresent++;
      continue;
    }

    // Add a synthetic {type:"id"} entry pointing to the same URL.
    const newDoc = {
      url,
      filename: deriveFilenameFromUrl(url),
      type: "id",
      uploadedAt: (t.createdAt ?? t.updatedAt ?? new Date()).toISOString(),
    };
    const merged = [...docs, newDoc];

    await prisma.trainee.update({
      where: { id: t.id },
      data: { documents: JSON.stringify(merged), updatedAt: new Date() },
    });

    updatedCount++;
    updates.push({
      ref: t.refNumber,
      name: t.fullName,
      nationalId: t.nationalId,
      url,
      addedAs: "type:id",
    });
  }

  console.log("\n=== Backfill Summary ===");
  console.log(`Total candidates : ${trainees.length}`);
  console.log(`Updated          : ${updatedCount}`);
  console.log(`Skipped (already): ${skippedAlreadyPresent}`);
  console.log(`Skipped (invalid): ${skippedInvalidUrl}`);

  if (updates.length > 0) {
    console.log("\n=== Per-Trainee Updates ===");
    for (const u of updates) {
      console.log(
        `  ${u.ref} | ${u.name} | NID=${u.nationalId} | +1 doc {type:"id", url:${u.url}}`,
      );
    }
  }

  // Verification pass — re-fetch and confirm every trainee with
  // idAttachmentUrl != null now has that URL in documents[].
  console.log("\n=== Verification ===");
  const recheck = await prisma.trainee.findMany({
    where: { deletedAt: null, idAttachmentUrl: { not: null } },
    select: { id: true, refNumber: true, fullName: true, idAttachmentUrl: true, documents: true },
  });
  let missingCount = 0;
  for (const t of recheck) {
    const docs = parseDocs(t.documents);
    const hasUrl = docs.some(
      (d) => d && typeof d.url === "string" && d.url === t.idAttachmentUrl,
    );
    if (!hasUrl) {
      missingCount++;
      console.log(`  ✗ ${t.refNumber} (${t.fullName}) — idAttachmentUrl NOT in documents[]`);
    }
  }
  if (missingCount === 0) {
    console.log(`  ✓ All ${recheck.length} trainee(s) with idAttachmentUrl now have the URL in documents[].`);
  } else {
    console.log(`  ✗ ${missingCount} trainee(s) still missing the URL in documents[].`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error("Backfill failed:", e);
    prisma.$disconnect();
    process.exit(1);
  });
