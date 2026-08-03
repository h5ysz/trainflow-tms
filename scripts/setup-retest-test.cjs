const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const p = new PrismaClient();

(async () => {
  const session = await p.trainingSession.findFirst({ where: { deletedAt: null } });
  if (!session) { console.log('No session'); process.exit(1); }

  // Create trainee
  const trainee = await p.trainee.create({
    data: {
      id: crypto.randomUUID(),
      refNumber: 'TRA-RT-' + Date.now(),
      fullName: 'Retest Trainee',
      nationalId: 'RT' + Date.now(),
      companyId: 'd2f954e6-aa44-4c48-b800-b05c28eb111c',
      updatedAt: new Date(),
    }
  });

  // Create enrollment
  const enrollment = await p.sessionEnrollment.create({
    data: {
      id: crypto.randomUUID(),
      sessionId: session.id,
      traineeId: trainee.id,
      companyId: trainee.companyId,
      enrolledBy: '070fa259-0f8a-47c0-ba4d-53786748243e',
      enrollmentStatus: 'ENROLLED',
      finalTestStatus: 'FAILED',
      createdBy: '070fa259-0f8a-47c0-ba4d-53786748243e',
      updatedBy: '070fa259-0f8a-47c0-ba4d-53786748243e',
      updatedAt: new Date(),
    }
  });

  // Create failed exam attempt
  const attempt = await p.examAttempt.create({
    data: {
      id: crypto.randomUUID(),
      refNumber: 'EXAM-RT-' + Date.now(),
      sessionId: session.id,
      testType: 'FINAL_TEST',
      traineeName: trainee.fullName,
      traineeIdNational: trainee.nationalId,
      questionSet: '[]',
      status: 'GRADED',
      scorePercent: 45,
      passed: false,
      passScore: 70,
      maxAttempts: 1,
      attemptNumber: 1,
      submittedAt: new Date(),
      updatedAt: new Date(),
    }
  });

  console.log(JSON.stringify({
    sessionId: session.id,
    traineeId: trainee.id,
    enrollmentId: enrollment.id,
    attemptId: attempt.id,
  }));

  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
