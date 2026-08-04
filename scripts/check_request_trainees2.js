const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  // Check audit logs for TR-2026-000007
  const audits = await prisma.auditLog.findMany({
    where: { 
      OR: [
        { entityRef: 'TR-2026-000007' },
        { description: { contains: 'TR-2026-000007' } },
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { action: true, description: true, newValue: true, createdAt: true, userId: true },
  });
  console.log('Audit logs for TR-2026-000007:');
  for (const a of audits) {
    console.log('---', a.createdAt, a.action);
    console.log('Desc:', a.description);
    if (a.newValue) {
      const nv = typeof a.newValue === 'string' ? a.newValue : JSON.stringify(a.newValue);
      console.log('New value (first 2000 chars):', nv.substring(0, 2000));
    }
  }

  // Look at the TrainingRequestCourseTrainee records for this request
  const trc = await prisma.trainingRequestCourseTrainee.findMany({
    where: { 
      requestCourse: { request: { refNumber: 'TR-2026-000007' } },
      deletedAt: null,
    },
    select: { 
      trainee: { select: { fullName: true, nationalId: true, idAttachmentUrl: true, documents: true } }
    }
  });
  console.log('\nJunction records for TR-2026-000007:');
  for (const t of trc) {
    console.log('---');
    console.log('Name:', t.trainee.fullName, '| NID:', t.trainee.nationalId);
    console.log('idAttachmentUrl:', t.trainee.idAttachmentUrl);
    console.log('documents:', t.trainee.documents);
  }

  await prisma.$disconnect();
})();
