const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const p = new PrismaClient();

(async () => {
  // Get the first session
  const session = await p.trainingSession.findFirst({ where: { deletedAt: null } });
  if (!session) { console.log('No session found'); process.exit(1); }
  console.log('Session:', session.id, session.refNumber);

  // Create a graded exam attempt
  const attempt = await p.examAttempt.create({
    data: {
      id: crypto.randomUUID(),
      refNumber: 'EXAM-QA-' + Date.now(),
      sessionId: session.id,
      testType: 'FINAL_TEST',
      traineeName: 'QA Result Trainee',
      traineeIdNational: 'QA0001111',
      questionSet: '[]',
      status: 'GRADED',
      scorePercent: 50,
      passed: false,
      passScore: 70,
      maxAttempts: 1,
      attemptNumber: 1,
      submittedAt: new Date(),
      updatedAt: new Date(),
    }
  });
  console.log('Attempt:', attempt.id, attempt.refNumber);
  await p.$disconnect();
})().catch(e => { console.error(e.message); process.exit(1); });
