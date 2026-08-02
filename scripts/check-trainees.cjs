const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const trainees = await prisma.trainee.findMany({ take: 3, select: { id: true, fullName: true, companyId: true, documents: true, idAttachmentUrl: true } });
  console.log(JSON.stringify(trainees, null, 2));
  await prisma.$disconnect();
})();
