const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  // Find the request that contains the Root Cause trainees
  const reqs = await prisma.trainingRequest.findMany({
    where: { 
      requestCourses: { 
        some: { 
          trainees: { 
            some: { 
              trainee: { nationalId: { in: ['RC_ALPHA_001','RC_BETA_002','RC_GAMMA_003'] } }
            } 
          } 
        } 
      } 
    },
    select: { id: true, refNumber: true, status: true, createdAt: true, documents: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log('Requests containing Root Cause trainees:');
  for (const r of reqs) {
    console.log('---');
    console.log('Ref:', r.refNumber, '| Status:', r.status, '| Created:', r.createdAt);
    console.log('Request documents:', r.documents);
  }

  // Also check audit log to see what was submitted
  const audits = await prisma.auditLog.findMany({
    where: { 
      OR: [
        { description: { contains: 'RC_ALPHA_001' } },
        { description: { contains: 'RC_BETA_002' } },
        { description: { contains: 'RC_GAMMA_003' } },
        { description: { contains: 'Root Cause' } },
      ]
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { action: true, description: true, newValue: true, createdAt: true, userId: true },
  });
  console.log('\nRelated audit logs:');
  for (const a of audits) {
    console.log('---', a.createdAt, a.action);
    console.log('Desc:', a.description);
    console.log('New value:', a.newValue ? JSON.stringify(a.newValue).substring(0, 500) : 'null');
  }

  await prisma.$disconnect();
})();
