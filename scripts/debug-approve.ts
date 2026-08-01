// Debug: for every request in the DB, simulate what would happen if the
// coordinator tried to approve it. Prints the exact failure reason.
import { db } from "../src/lib/db";
import { canTransition } from "../src/app/api/requests/route";
import { validateRequestForApproval } from "../src/lib/api/request-validation";

async function main() {
  const requests = await db.trainingRequest.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      requestCourses: {
        where: { deletedAt: null },
        include: {
          course: { select: { title: true } },
          trainees: { where: { deletedAt: null }, select: { id: true } },
        },
      },
    },
  });

  for (const r of requests) {
    console.log("=".repeat(80));
    console.log(`Ref: ${r.refNumber}  CurrentStatus: ${r.status}`);
    console.log(`  TraineeCount (denormalized): ${r.traineeCount}`);
    console.log(`  RequestCourses junction rows: ${r.requestCourses.length}`);

    // Step 1: Is the transition UNDER_REVIEW → APPROVED even allowed?
    const transitionAllowed = canTransition(r.status as any, "APPROVED");
    console.log(`  canTransition(${r.status} → APPROVED) = ${transitionAllowed}`);

    if (!transitionAllowed) {
      console.log(`  → Approve would FAIL with INVALID_TRANSITION (current status is not UNDER_REVIEW)`);
      continue;
    }

    // Step 2: Run the approval validation
    const validation = await validateRequestForApproval(r.id);
    console.log(`  validateRequestForApproval:`);
    console.log(`    valid = ${validation.valid}`);
    console.log(`    totalTrainees = ${validation.totalTrainees}`);
    console.log(`    failingCourses.length = ${validation.failingCourses.length}`);
    for (const fc of validation.failingCourses) {
      console.log(`    FAIL: ${fc.courseTitle} — ${fc.traineeCount} trainees (reason: ${fc.reason})`);
    }
    if (r.requestCourses.length === 0) {
      console.log(`    ⚠️  Request has 0 RequestCourse rows — validation returns valid=false with empty failingCourses.`);
      console.log(`       Error message would be: "Cannot approve: 0 course(s) fail the trainee count rule"`);
    }
    if (validation.valid) {
      console.log(`  → Approve would SUCCEED`);
    } else {
      console.log(`  → Approve would FAIL with APPROVAL_VALIDATION_FAILED`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
