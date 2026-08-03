import { db } from "../src/lib/db";
import { canTransition } from "../src/app/api/requests/route";
import { validateRequestForApproval, MIN_TRAINEES_PER_COURSE, MAX_TRAINEES_PER_COURSE } from "../src/lib/api/request-validation";

async function main() {
  const r = await db.trainingRequest.findFirst({ where: { refNumber: "TR-2026-000010" } });
  if (!r) { console.log("not found"); return; }

  console.log("=== Simulating PUT /api/requests/TR-2026-000010 with body { status: 'APPROVED' } ===");
  console.log(`currentStatus = ${r.status}`);
  console.log(`requestedTransition = ${r.status} → APPROVED`);
  console.log(`targetStatus = APPROVED`);

  if (!canTransition(r.status as any, "APPROVED")) {
    console.log(`\nResponse: 400 INVALID_TRANSITION`);
    return;
  }

  const validation = await validateRequestForApproval(r.id);
  if (!validation.valid) {
    console.log(`\nResponse: 422 APPROVAL_VALIDATION_FAILED`);
    console.log(`Error: "Cannot approve: ${validation.failingCourses.length} course(s) fail the trainee count rule (min ${MIN_TRAINEES_PER_COURSE}, max ${MAX_TRAINEES_PER_COURSE})"`);
    for (const fc of validation.failingCourses) {
      console.log(`  - ${fc.courseTitle} (${fc.traineeCount} trainees): ${fc.reason}`);
    }
    return;
  }

  console.log("\nResponse: 200 OK — request would be approved");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
