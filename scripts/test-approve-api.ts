// Simulate the exact API call the UI's Approve button makes, for the
// UNDER_REVIEW request with 0 courses (TR-2026-000001). Confirms the error
// message returned to the user is now meaningful.
import { db } from "../src/lib/db";
import { canTransition } from "../src/app/api/requests/route";
import { validateRequestForApproval, MIN_TRAINEES_PER_COURSE, MAX_TRAINEES_PER_COURSE } from "../src/lib/api/request-validation";

async function main() {
  const r = await db.trainingRequest.findFirst({ where: { refNumber: "TR-2026-000001" } });
  if (!r) { console.log("not found"); return; }

  console.log("=== Simulating PUT /api/requests/TR-2026-000001 with body { status: 'APPROVED' } ===");
  console.log(`currentStatus = ${r.status}`);
  console.log(`requestedTransition = ${r.status} → APPROVED`);
  console.log(`targetStatus = APPROVED`);

  // Step 1: canTransition check
  if (!canTransition(r.status as any, "APPROVED")) {
    console.log(`\nResponse: 400 INVALID_TRANSITION`);
    console.log(`Error: "Invalid status transition: ${r.status} → APPROVED"`);
    return;
  }

  // Step 2: validateRequestForApproval
  const validation = await validateRequestForApproval(r.id);
  if (!validation.valid) {
    console.log(`\nResponse: 422 APPROVAL_VALIDATION_FAILED`);
    console.log(`Error: "Cannot approve: ${validation.failingCourses.length} course(s) fail the trainee count rule (min ${MIN_TRAINEES_PER_COURSE}, max ${MAX_TRAINEES_PER_COURSE})"`);
    console.log(`Details: failingCourses =`);
    for (const fc of validation.failingCourses) {
      console.log(`  - ${fc.courseTitle}: ${fc.reason}`);
    }
    return;
  }

  console.log("\nResponse: 200 OK — request would be approved");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
