const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  // Find ALL audit logs that mention "Root Cause"
  const audits = await prisma.auditLog.findMany({
    where: { 
      description: { contains: 'Root Cause' }
    },
    orderBy: { createdAt: 'asc' },
    select: { action: true, description: true, newValue: true, createdAt: true, entity: true, entityId: true, entityRef: true },
    take: 30,
  });
  console.log('Audit logs for Root Cause trainees:', audits.length);
  for (const a of audits) {
    console.log('---', a.createdAt, a.action, a.entity);
    console.log('Desc:', a.description);
    if (a.newValue) {
      const nv = typeof a.newValue === 'string' ? a.newValue : JSON.stringify(a.newValue);
      if (nv.length < 1500) console.log('New value:', nv);
      else console.log('New value (truncated):', nv.substring(0, 1500));
    }
  }

  // Also check user accounts who created these trainees
  const t = await prisma.trainee.findFirst({
    where: { nationalId: 'RC_ALPHA_001' },
    select: { fullName: true, createdBy: true, updatedBy: true, createdAt: true, updatedAt: true },
  });
  console.log('\nTrainee RC_ALPHA_001 creator info:', t);

  const creator = t?.createdBy ? await prisma.user.findUnique({ where: { id: t.createdBy }, select: { email: true, role: true } }) : null;
  console.log('Creator:', creator);

  await prisma.$disconnect();
})();
