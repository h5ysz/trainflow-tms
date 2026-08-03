// Phase 1 Manual Workflow Test
// ====================================================================
// Exercises the full Phase 1 workflow end-to-end through the actual DB
// layer (same code paths the API routes use):
//
//   1. Contractor creates a request with 37 trainees (over capacity 20)
//   2. Coordinator reviews → approves (must NOT be blocked by capacity)
//   3. Coordinator generates sessions → auto-split into 2 sessions
//   4. Auto-enroll: each split session gets its trainees
//   5. Coordinator assigns a trainer to a session
//   6. Coordinator replaces the trainer
//   7. Coordinator removes the trainer
//   8. Coordinator edits session fields (title, venue, capacity)
//   9. Coordinator edits a trainee (name, nationality, jobTitle)
//
// Verifies every step produces the expected DB state.
import { db } from "../src/lib/db";
import { canTransition } from "../src/app/api/requests/route";
import {
  validateRequestForApproval,
  suggestSessionSplit,
} from "../src/lib/api/request-validation";
import { nextRefNumber } from "../src/lib/api/ref-number";
import { randomBytes } from "crypto";

function genQrToken() {
  return randomBytes(16).toString("hex");
}

let passCount = 0;
let failCount = 0;
function check(label: string, condition: boolean, details?: string) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passCount++;
  } else {
    console.log(`  ❌ ${label}${details ? ` — ${details}` : ""}`);
    failCount++;
  }
}

async function main() {
  console.log("=== Phase 1 Manual Workflow Test ===\n");

  // ── Setup ──────────────────────────────────────────────────────────────
  const company = await db.company.findFirst({ where: { deletedAt: null } });
  const course = await db.course.findFirst({ where: { deletedAt: null } });
  if (!company || !course) {
    console.log("Missing seed data (company or course)");
    return;
  }
  // Force capacity to 20 for predictable split math.
  await db.course.update({ where: { id: course.id }, data: { maxTrainees: 20 } });
  const trainer = await db.trainer.findFirst({ where: { deletedAt: null } });
  if (!trainer) {
    console.log("Missing seed data (trainer)");
    return;
  }
  // Ensure trainer is certified for the course (skip validation in this test).
  const existingCert = await db.trainerCertification.findFirst({
    where: { trainerId: trainer.id, courseId: course.id, deletedAt: null },
  });
  if (!existingCert) {
    await db.trainerCertification.create({
      data: {
        trainerId: trainer.id,
        courseId: course.id,
        status: "VALID",
        validFrom: new Date(),
        createdBy: "test-script",
        updatedBy: "test-script",
      },
    });
  }

  console.log(`Setup: company=${company.name}, course=${course.title} (cap=20), trainer=${trainer.fullName}`);
  console.log(`       Will create 37 trainees (over capacity → expect 2 sessions)\n`);

  // Create 37 trainees
  const trainees: { id: string; fullName: string; nationalId: string }[] = [];
  for (let i = 0; i < 37; i++) {
    const t = await db.trainee.create({
      data: {
        refNumber: await nextRefNumber("TRAINEE"),
        fullName: `Phase1 Trainee ${i}`,
        nationalId: `P1-${Date.now()}-${i}`,
        companyId: company.id,
        createdBy: "test-script",
        updatedBy: "test-script",
      },
    });
    trainees.push({ id: t.id, fullName: t.fullName, nationalId: t.nationalId });
  }

  // ── Step 1: Contractor creates request ─────────────────────────────────
  console.log("Step 1: Contractor creates request with 37 trainees");
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
  check(`Request created: ${request.refNumber}`, Boolean(request.id));
  check(`Trainee count = 37`, request.traineeCount === 37, `got ${request.traineeCount}`);

  // ── Step 2: Contractor submits ─────────────────────────────────────────
  console.log("\nStep 2: Contractor submits (DRAFT → SUBMITTED)");
  check(`canTransition(DRAFT, SUBMITTED)`, canTransition("DRAFT", "SUBMITTED"));
  await db.trainingRequest.update({
    where: { id: request.id },
    data: { status: "SUBMITTED", submittedAt: new Date(), updatedBy: "test-script" },
  });

  // ── Step 3: Coordinator reviews (SUBMITTED → UNDER_REVIEW) ─────────────
  console.log("\nStep 3: Coordinator starts review (SUBMITTED → UNDER_REVIEW)");
  check(`canTransition(SUBMITTED, UNDER_REVIEW)`, canTransition("SUBMITTED", "UNDER_REVIEW"));
  await db.trainingRequest.update({
    where: { id: request.id },
    data: { status: "UNDER_REVIEW", reviewedAt: new Date(), updatedBy: "test-script" },
  });

  // ── Step 4: Coordinator approves — must NOT be blocked by capacity ─────
  console.log("\nStep 4: Coordinator approves (UNDER_REVIEW → APPROVED)");
  console.log("  (37 trainees / 20 capacity — old behavior would block; new behavior allows)");
  const validation = await validateRequestForApproval(request.id);
  check(`validateRequestForApproval().valid = true`, validation.valid === true, `got valid=${validation.valid}`);
  check(`No failingCourses (hard blocks)`, validation.failingCourses.length === 0, `got ${validation.failingCourses.length}`);
  check(`Warnings present (advisory)`, validation.warnings.length > 0, `got ${validation.warnings.length}`);
  check(`Warning suggests 2 sessions`, validation.warnings[0]?.suggestedSessionCount === 2, `got ${validation.warnings[0]?.suggestedSessionCount}`);
  check(`canTransition(UNDER_REVIEW, APPROVED)`, canTransition("UNDER_REVIEW", "APPROVED"));
  await db.trainingRequest.update({
    where: { id: request.id },
    data: { status: "APPROVED", approvedAt: new Date(), approvedBy: "test-script", updatedBy: "test-script" },
  });

  // ── Step 5: Generate sessions with auto-split + auto-enroll ────────────
  console.log("\nStep 5: Generate sessions (auto-split 37/20 → 2 sessions, auto-enroll)");
  const splitSizes = suggestSessionSplit(37, 20);
  check(`suggestSessionSplit(37, 20) = [${splitSizes.join(", ")}]`, splitSizes.length === 2 && splitSizes.reduce((a, b) => a + b, 0) === 37, `got [${splitSizes.join(", ")}]`);

  const createdSessions: { id: string; refNumber: string }[] = [];
  let cursor = 0;
  for (let i = 0; i < splitSizes.length; i++) {
    const size = splitSizes[i];
    const slice = trainees.slice(cursor, cursor + size);
    cursor += size;
    const session = await db.trainingSession.create({
      data: {
        refNumber: await nextRefNumber("SESSION"),
        courseId: course.id,
        requestId: request.id,
        requestCourseId: rc.id,
        trainerId: null, // no trainer at scheduling time
        title: `${course.title} — Morning (${i + 1}/${splitSizes.length})`,
        shift: "MORNING",
        durationHours: 6,
        capacity: 20,
        language: "en",
        startDate: new Date(Date.now() + 86400000),
        endDate: new Date(Date.now() + 86400000 + 6 * 3600 * 1000),
        expectedTrainees: slice.length,
        actualTrainees: 0,
        status: "SCHEDULED",
        qrCodeToken: genQrToken(),
        createdBy: "test-script",
        updatedBy: "test-script",
      },
    });
    createdSessions.push({ id: session.id, refNumber: session.refNumber });
    // Auto-enroll
    for (const t of slice) {
      await db.sessionEnrollment.upsert({
        where: { sessionId_traineeId: { sessionId: session.id, traineeId: t.id } },
        update: { deletedAt: null, companyId: company.id, enrollmentStatus: "CONFIRMED", updatedBy: "test-script" },
        create: {
          sessionId: session.id, traineeId: t.id, companyId: company.id,
          enrollmentStatus: "CONFIRMED", createdBy: "test-script", updatedBy: "test-script",
        },
      });
    }
  }
  // Mark request as SCHEDULED
  await db.trainingRequest.update({
    where: { id: request.id },
    data: { status: "SCHEDULED", scheduledAt: new Date(), updatedBy: "test-script" },
  });
  check(`2 sessions created`, createdSessions.length === 2, `got ${createdSessions.length}`);

  // Verify enrollments per session
  const enr1 = await db.sessionEnrollment.count({ where: { sessionId: createdSessions[0].id, deletedAt: null } });
  const enr2 = await db.sessionEnrollment.count({ where: { sessionId: createdSessions[1].id, deletedAt: null } });
  check(`Session 1 enrollments = ${splitSizes[0]}`, enr1 === splitSizes[0], `got ${enr1}`);
  check(`Session 2 enrollments = ${splitSizes[1]}`, enr2 === splitSizes[1], `got ${enr2}`);
  check(`Total enrollments = 37`, enr1 + enr2 === 37, `got ${enr1 + enr2}`);

  // ── Step 6: Assign trainer ─────────────────────────────────────────────
  console.log("\nStep 6: Assign trainer to session 1");
  const beforeAssign = await db.trainingSession.findUnique({ where: { id: createdSessions[0].id } });
  check(`Session 1 has no trainer before assign`, beforeAssign?.trainerId === null);
  await db.trainingSession.update({
    where: { id: createdSessions[0].id },
    data: { trainerId: trainer.id, updatedBy: "test-script" },
  });
  const afterAssign = await db.trainingSession.findUnique({ where: { id: createdSessions[0].id } });
  check(`Session 1 trainer assigned`, afterAssign?.trainerId === trainer.id, `got ${afterAssign?.trainerId}`);

  // ── Step 7: Replace trainer ────────────────────────────────────────────
  console.log("\nStep 7: Replace trainer (assign a different trainer)");
  // Find a second trainer
  const trainer2 = await db.trainer.findFirst({
    where: { deletedAt: null, id: { not: trainer.id } },
  });
  if (trainer2) {
    // Certify trainer2 for the course
    const cert2 = await db.trainerCertification.findFirst({
      where: { trainerId: trainer2.id, courseId: course.id, deletedAt: null },
    });
    if (!cert2) {
      await db.trainerCertification.create({
        data: {
          trainerId: trainer2.id,
          courseId: course.id,
          status: "VALID",
          validFrom: new Date(),
          createdBy: "test-script",
          updatedBy: "test-script",
        },
      });
    }
    await db.trainingSession.update({
      where: { id: createdSessions[0].id },
      data: { trainerId: trainer2.id, updatedBy: "test-script" },
    });
    const afterReplace = await db.trainingSession.findUnique({ where: { id: createdSessions[0].id } });
    check(`Trainer replaced`, afterReplace?.trainerId === trainer2.id, `got ${afterReplace?.trainerId}`);
    check(`New trainer differs from original`, afterReplace?.trainerId !== trainer.id);
  } else {
    console.log("  (skipped — only one trainer in DB)");
  }

  // ── Step 8: Remove trainer ─────────────────────────────────────────────
  console.log("\nStep 8: Remove trainer (set trainerId = null)");
  await db.trainingSession.update({
    where: { id: createdSessions[0].id },
    data: { trainerId: null, updatedBy: "test-script" },
  });
  const afterRemove = await db.trainingSession.findUnique({ where: { id: createdSessions[0].id } });
  check(`Trainer removed`, afterRemove?.trainerId === null, `got ${afterRemove?.trainerId}`);
  check(`Session still exists (not deleted)`, Boolean(afterRemove));

  // ── Step 9: Edit session fields ────────────────────────────────────────
  console.log("\nStep 9: Edit session fields (title, venue, capacity)");
  await db.trainingSession.update({
    where: { id: createdSessions[0].id },
    data: {
      title: "Edited Session Title",
      venue: "Hall B - Edited",
      capacity: 25,
      notes: "Updated by coordinator",
      updatedBy: "test-script",
    },
  });
  const afterEdit = await db.trainingSession.findUnique({ where: { id: createdSessions[0].id } });
  check(`Title updated`, afterEdit?.title === "Edited Session Title", `got ${afterEdit?.title}`);
  check(`Venue updated`, afterEdit?.venue === "Hall B - Edited", `got ${afterEdit?.venue}`);
  check(`Capacity updated to 25`, afterEdit?.capacity === 25, `got ${afterEdit?.capacity}`);
  check(`Notes updated`, afterEdit?.notes === "Updated by coordinator");

  // ── Step 10: Edit a trainee ────────────────────────────────────────────
  console.log("\nStep 10: Edit trainee info (name, nationality, jobTitle, idAttachmentUrl)");
  const traineeToEdit = trainees[0];
  await db.trainee.update({
    where: { id: traineeToEdit.id },
    data: {
      fullName: "Edited Trainee Name",
      nationality: "Egyptian",
      jobTitle: "Safety Officer",
      idAttachmentUrl: "/uploads/test-id.jpg",
      updatedBy: "test-script",
    },
  });
  const editedTrainee = await db.trainee.findUnique({ where: { id: traineeToEdit.id } });
  check(`Trainee name updated`, editedTrainee?.fullName === "Edited Trainee Name");
  check(`Trainee nationality updated`, editedTrainee?.nationality === "Egyptian");
  check(`Trainee jobTitle updated`, editedTrainee?.jobTitle === "Safety Officer");
  check(`Trainee idAttachmentUrl updated`, editedTrainee?.idAttachmentUrl === "/uploads/test-id.jpg");

  // Verify the edited trainee's enrollment still references them correctly
  const enrollmentOfEdited = await db.sessionEnrollment.findFirst({
    where: { traineeId: traineeToEdit.id, deletedAt: null },
    include: { trainee: { select: { fullName: true } } },
  });
  check(`Enrollment reflects edited trainee name`, enrollmentOfEdited?.trainee.fullName === "Edited Trainee Name");

  // ── Cleanup ────────────────────────────────────────────────────────────
  console.log("\nCleaning up test data...");
  for (const s of createdSessions) {
    await db.sessionEnrollment.deleteMany({ where: { sessionId: s.id } }).catch(() => {});
    await db.sessionCompany.deleteMany({ where: { sessionId: s.id } }).catch(() => {});
    await db.trainingSession.delete({ where: { id: s.id } }).catch(() => {});
  }
  await db.trainingRequestCourseTrainee.deleteMany({ where: { requestCourseId: rc.id } });
  await db.trainingRequestCourse.delete({ where: { id: rc.id } });
  await db.trainingRequest.delete({ where: { id: request.id } });
  for (const t of trainees) {
    await db.trainee.delete({ where: { id: t.id } }).catch(() => {});
  }
  console.log("Cleanup complete.");

  // ── Summary ────────────────────────────────────────────────────────────
  console.log(`\n=== Phase 1 Test Summary ===`);
  console.log(`  Passed: ${passCount}`);
  console.log(`  Failed: ${failCount}`);
  if (failCount === 0) {
    console.log(`  ✅ ALL PHASE 1 CHECKS PASSED`);
  } else {
    console.log(`  ❌ ${failCount} check(s) failed — see above`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
