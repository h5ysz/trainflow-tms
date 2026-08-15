// GCCLAB TMS — barcode & exam prep are TRAINER-only; coordinator gets RESULTS only
// =====================================================================
// The session barcode (QR, module "qr-code") and pre-test / final-test management
// (test prep + the Exam Questions manager) belong to the Trainer / Training Admin,
// NOT the coordinator — the coordinator runs the session lifecycle (start/end) and
// must not see the "barcode" or the "preparation & tests" bar. This strips every
// `qr-code.*` / `pre-test.*` / `final-test.*` grant from the COORDINATOR role and
// grants the read-only `exam-attempts.view` instead: the coordinator sees attempt
// SCORES only. The exam-attempts API strips question content for them, and
// start/submit/reopen/edit stay 403.
//
// Mirrors the source-of-truth change in src/lib/auth/permissions.ts
// (OPERATIONAL_PERMISSIONS no longer contains qr-code/pre-test/final-test;
// COORDINATOR gains "exam-attempts": ["view"]) and scripts/seed-test-users.ts
// (COORDINATOR set now carries `exam-attempts.view` instead of
// `qr-code.*`/`pre-test.*`/`final-test.*`).
//
// Only the COORDINATOR Role row is touched: AUDITOR/VIEWER keep their read-only
// pre-test/final-test view, and TRAINER/SUPER_ADMIN keep full barcode/exam access.
// Idempotent — safe to re-run.
import { db } from "../src/lib/db";

async function main() {
  const role = await db.role.findUnique({ where: { code: "COORDINATOR" } });
  if (!role) {
    console.log("→ COORDINATOR role not found — skipping (will be created by seed)");
    return;
  }

  const perms = Array.isArray(role.permissions) ? (role.permissions as string[]) : [];
  const stripped = perms.filter(
    (p) => !p.startsWith("qr-code.") && !p.startsWith("pre-test.") && !p.startsWith("final-test."),
  );
  const updated = stripped.includes("exam-attempts.view") ? stripped : [...stripped, "exam-attempts.view"];

  // Set comparison, NOT length: stripping qr-code.* (1 grant) while adding
  // exam-attempts.view (1 grant) keeps the array length identical, so a length
  // check alone wrongly reports "no changes needed" and leaves qr-code.* in place.
  const unchanged = perms.length === updated.length && perms.every((p) => updated.includes(p));
  if (unchanged) {
    console.log("— COORDINATOR: no changes needed");
    return;
  }

  await db.role.update({ where: { id: role.id }, data: { permissions: updated } });
  console.log(`✓ COORDINATOR: removed qr-code.* / pre-test.* / final-test.*, added exam-attempts.view (${perms.length} → ${updated.length})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
