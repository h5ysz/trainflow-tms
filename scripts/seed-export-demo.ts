// Seed sample certificates, invoices, attendance, results, evaluations and
// attachments metadata so the Excel export screenshots have meaningful content.
//
// Usage:  node --experimental-strip-types --env-file=.env scripts/seed-export-demo.ts
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";

const db = new PrismaClient();

async function main() {
  const company = await db.company.findFirst({
    where: { name: "Test Contractor Co." },
    select: { id: true, name: true },
  });
  if (!company) throw new Error("Test Contractor Co. not found — run seed first.");
  console.log(`Company: ${company.name}`);

  // Get the latest training request + its course + trainee count
  const req = await db.trainingRequest.findFirst({
    where: { companyId: company.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      requestCourses: {
        where: { deletedAt: null },
        include: {
          course: { select: { id: true, title: true } },
          trainees: {
            where: { deletedAt: null },
            include: { trainee: true },
            take: 5,
          },
        },
      },
    },
  });
  if (!req) throw new Error("No training request found.");
  console.log(`Latest request: ${req.refNumber} (status: ${req.status})`);

  // Find or create a session for this request
  let session = await db.trainingSession.findFirst({
    where: { requestId: req.id, deletedAt: null },
    select: { id: true, refNumber: true },
  });
  if (!session) {
    const sessionRef = `SESS-${Date.now().toString().slice(-6)}`;
    session = await db.trainingSession.create({
      data: {
        id: randomUUID(),
        refNumber: sessionRef,
        requestId: req.id,
        courseId: req.requestCourses[0]?.courseId ?? req.courseId ?? "",
        trainerId: null,
        title: `Demo session for ${req.refNumber}`,
        location: "Demo training hall",
        startDate: new Date(),
        endDate: new Date(Date.now() + 8 * 60 * 60 * 1000),
        status: "IN_PROGRESS",
        language: "en",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      select: { id: true, refNumber: true },
    });
    console.log(`Created session: ${session.refNumber}`);
  } else {
    console.log(`Existing session: ${session.refNumber}`);
  }

  const course = req.requestCourses[0]?.course;
  const trainees = req.requestCourses.flatMap((rc) => rc.trainees.map((t) => t.trainee));
  if (trainees.length === 0) {
    console.log("No trainees linked — skipping attendance/results/certificates seeding.");
  } else {
    console.log(`Found ${trainees.length} trainees. Seeding demo data…`);

    // Attendance — create one record per trainee
    for (const t of trainees.slice(0, 5)) {
      const existing = await db.attendance.findFirst({
        where: { sessionId: session.id, traineeEmail: t.email ?? t.nationalId },
        select: { id: true },
      });
      if (existing) continue;
      const status = ["PRESENT", "PRESENT", "PRESENT", "ABSENT", "LATE"][Math.floor(Math.random() * 5)];
      const checkIn = status === "ABSENT" ? null : new Date();
      const checkOut = status === "ABSENT" || status === "LATE" ? null : new Date(Date.now() + 6 * 60 * 60 * 1000);
      await db.attendance.create({
        data: {
          id: randomUUID(),
          sessionId: session.id,
          traineeName: t.fullName,
          traineeIdNational: t.nationalId,
          traineeEmail: t.email,
          traineePhone: t.mobile,
          company: company.name,
          companyId: company.id,
          status,
          checkInAt: checkIn,
          checkOutAt: checkOut,
          checkInMethod: "QR",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    console.log("  ✓ Attendance records seeded");

    // TestResult — create one final-test result per trainee
    for (const t of trainees.slice(0, 5)) {
      const existing = await db.testResult.findFirst({
        where: { sessionId: session.id, traineeName: t.fullName },
        select: { id: true },
      });
      if (existing) continue;
      const score = 60 + Math.floor(Math.random() * 40); // 60-99
      await db.testResult.create({
        data: {
          id: randomUUID(),
          refNumber: `EXAM-${Date.now().toString().slice(-6)}-${t.nationalId.slice(-4)}`,
          sessionId: session.id,
          testType: "FINAL_TEST",
          traineeName: t.fullName,
          traineeEmail: t.email,
          traineeIdNational: t.nationalId,
          companyId: company.id,
          scorePercent: score,
          passed: score >= 70,
          attemptedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    console.log("  ✓ Test results seeded");

    // CourseEvaluation — for trainees who passed
    const passedResults = await db.testResult.findMany({
      where: { sessionId: session.id, passed: true },
      select: { traineeName: true, traineeEmail: true, traineeIdNational: true },
    });
    for (const r of passedResults.slice(0, 3)) {
      const existing = await db.courseEvaluation.findFirst({
        where: { sessionId: session.id, traineeName: r.traineeName },
        select: { id: true },
      });
      if (existing) continue;
      await db.courseEvaluation.create({
        data: {
          id: randomUUID(),
          sessionId: session.id,
          traineeName: r.traineeName,
          traineeEmail: r.traineeEmail,
          traineeIdNational: r.traineeIdNational,
          companyId: company.id,
          trainerRating: 4 + Math.floor(Math.random() * 2),
          contentRating: 4 + Math.floor(Math.random() * 2),
          venueRating: 4 + Math.floor(Math.random() * 2),
          materialsRating: 4 + Math.floor(Math.random() * 2),
          overallRating: 4 + Math.floor(Math.random() * 2),
          comments: "Good training session overall.",
          suggestions: "More practical exercises would be helpful.",
          wouldRecommend: true,
          submittedAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    console.log("  ✓ Course evaluations seeded");

    // Certificate — one per passed trainee
    for (const r of passedResults) {
      const existing = await db.certificate.findFirst({
        where: { sessionId: session.id, traineeName: r.traineeName },
        select: { id: true },
      });
      if (existing) continue;
      const certRef = `CERT-${new Date().getFullYear()}-${Math.floor(Math.random() * 900000 + 100000)}`;
      await db.certificate.create({
        data: {
          id: randomUUID(),
          refNumber: certRef,
          sessionId: session.id,
          courseId: course?.id ?? req.courseId ?? "",
          companyId: company.id,
          traineeName: r.traineeName,
          traineeIdNational: r.traineeIdNational,
          traineeEmail: r.traineeEmail,
          finalScore: 70 + Math.floor(Math.random() * 30),
          issuedAt: new Date(),
          validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          status: "VALID",
          releaseStatus: "RELEASED",
          releasedAt: new Date(),
          version: 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    console.log("  ✓ Certificates seeded");

    // Trainee.documents (JSON) — set on first trainee so Attachments sheet has data
    if (trainees[0]) {
      const t = trainees[0];
      if (!t.documents) {
        await db.trainee.update({
          where: { id: t.id },
          data: {
            documents: JSON.stringify([
              {
                url: `/uploads/trainees/${t.id}/iqama-front.pdf`,
                filename: "iqama-front.pdf",
                type: "Iqama",
                uploadedAt: new Date().toISOString(),
                uploadedById: null,
              },
              {
                url: `/uploads/trainees/${t.id}/medical-cert.pdf`,
                filename: "medical-cert.pdf",
                type: "Medical",
                uploadedAt: new Date().toISOString(),
                uploadedById: null,
              },
            ]),
          },
        });
        console.log("  ✓ Sample trainee documents JSON seeded");
      }
      if (!t.idAttachmentUrl) {
        await db.trainee.update({
          where: { id: t.id },
          data: { idAttachmentUrl: `/uploads/trainees/${t.id}/id-scan.jpg` },
        });
        console.log("  ✓ Sample trainee idAttachmentUrl seeded");
      }
    }
  }

  // Invoice — for the request
  const existingInv = await db.invoice.findFirst({
    where: { requestId: req.id, deletedAt: null },
    select: { id: true },
  });
  if (!existingInv) {
    const subtotal = 1500;
    const vatRate = 0.15;
    const vatAmount = subtotal * vatRate;
    const grandTotal = subtotal + vatAmount;
    await db.invoice.create({
      data: {
        id: randomUUID(),
        refNumber: `INV-${new Date().getFullYear()}-${Math.floor(Math.random() * 9000 + 1000)}`,
        requestId: req.id,
        companyId: company.id,
        lineItems: JSON.stringify([
          { description: `${course?.title ?? "Course"} — ${trainees.length} trainees`, qty: trainees.length, unitPrice: 300, amount: 1500 },
        ]),
        subtotal,
        discountAmount: 0,
        vatAmount,
        grandTotal,
        paidAmount: 1000,
        outstandingBalance: grandTotal - 1000,
        currency: "SAR",
        vatRate,
        status: "PARTIALLY_PAID",
        issueDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        snapshot: "{}",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    console.log("  ✓ Invoice seeded");
  }

  // Also add a document to the training request itself
  if (!req.documents) {
    await db.trainingRequest.update({
      where: { id: req.id },
      data: {
        documents: JSON.stringify([
          {
            url: `/uploads/requests/${req.id}/company-letter.pdf`,
            filename: "company-letter.pdf",
            type: "Company Letter",
            uploadedAt: new Date().toISOString(),
            uploadedById: null,
          },
        ]),
      },
    });
    console.log("  ✓ Sample request documents JSON seeded");
  }

  console.log("\n✅ Demo data seeded. Re-run test-excel-export.ts to see richer exports.");
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
