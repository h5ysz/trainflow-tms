// End-to-end happy path: create a request with 15 trainees, transition
// DRAFT → SUBMITTED → UNDER_REVIEW → APPROVED, and verify each step.
import { db } from "../src/lib/db";
import { canTransition } from "../src/app/api/requests/route";
import { validateRequestForApproval } from "../src/lib/api/request-validation";
import { nextRefNumber } from "../src/lib/api/ref-number";

async function main() {
  // Find any company + course
  const company = await db.company.findFirst({ where: { deletedAt: null } });
  const course = await db.course.findFirst({ where: { deletedAt: null } });
  if (!company || !course) { console.log("Missing company/course seed data"); return; }
  console.log(`Using company=${company.name}, course=${course.title}`);

  // Create 15 trainees
  const trainees: { id: string; fullName: string; nationalId: string }[] = [];
  for (let i = 0; i < 15; i++) {
    const t = await db.trainee.create({
      data: {
        refNumber: await nextRefNumber("TRAINEE"),
        fullName: `Happy Path Trainee ${i}`,
        nationalId: `HAPPY-${Date.now()}-${i}`,
        companyId: company.id,
        createdBy: "test-script",
        updatedBy: "test-script",
      },
    });
    trainees.push({ id: t.id, fullName: t.fullName, nationalId: t.nationalId });
  }
  console.log(`Created ${trainees.length} trainees`);

  // Create the request
  const request = await db.trainingRequest.create({
    data: {
      refNumber: await nextRefNumber("TRAINING_REQUEST"),
      companyId: company.id,
      courseId: course.id,
      traineeCount: trainees.length,
      status: "DRAFT",
      priority: "NORMAL",
      createdBy: "test-script",
      updatedBy: "test-script",
    },
  });
  console.log(`Created request ${request.refNumber} (status=DRAFT)`);

  // Create the requestCourse + link trainees
  const rc = await db.trainingRequestCourse.create({
    data: {
      requestId: request.id,
      courseId: course.id,
      traineeCount: trainees.length,
      minTrainees: 10,
      maxTrainees: 20,
      createdBy: "test-script",
      updatedBy: "test-script",
    },
  });
  for (const t of trainees) {
    await db.trainingRequestCourseTrainee.create({
      data: { requestCourseId: rc.id, traineeId: t.id, createdBy: "test-script", updatedBy: "test-script" },
    });
  }
  console.log(`Created requestCourse ${rc.id} with ${trainees.length} trainee links`);

  // Simulate the transitions
  const transitions: [string, string][] = [
    ["DRAFT", "SUBMITTED"],
    ["SUBMITTED", "UNDER_REVIEW"],
    ["UNDER_REVIEW", "APPROVED"],
  ];

  for (const [from, to] of transitions) {
    console.log(`\n--- Transition ${from} → ${to} ---`);
    console.log(`canTransition(${from}, ${to}) = ${canTransition(from as any, to as any)}`);
    if (!canTransition(from as any, to as any)) {
      console.log("FAILED: transition not allowed");
      return;
    }
    if (to === "APPROVED") {
      const v = await validateRequestForApproval(request.id);
      console.log(`validateRequestForApproval: valid=${v.valid}, failingCourses=${v.failingCourses.length}`);
      if (!v.valid) {
        console.log("FAILED: approval validation failed");
        for (const fc of v.failingCourses) console.log(`  - ${fc.courseTitle}: ${fc.reason}`);
        return;
      }
    }
    // Apply the transition
    const now = new Date();
    const updates: Record<string, unknown> = { status: to, updatedBy: "test-script" };
    if (to === "SUBMITTED") updates.submittedAt = now;
    if (to === "UNDER_REVIEW") updates.reviewedAt = now;
    if (to === "APPROVED") { updates.approvedAt = now; updates.approvedBy = "test-script"; }
    await db.trainingRequest.update({ where: { id: request.id }, data: updates });
    const after = await db.trainingRequest.findUnique({ where: { id: request.id } });
    console.log(`After: status=${after?.status}, approvedAt=${after?.approvedAt?.toISOString() ?? "null"}`);
  }

  console.log("\n✅ Happy path succeeded — request is now APPROVED");

  // Cleanup
  await db.trainingRequestCourseTrainee.deleteMany({ where: { requestCourseId: rc.id } });
  await db.trainingRequestCourse.delete({ where: { id: rc.id } });
  await db.trainingRequest.delete({ where: { id: request.id } });
  for (const t of trainees) await db.trainee.delete({ where: { id: t.id } });
  console.log("Test data cleaned up");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
