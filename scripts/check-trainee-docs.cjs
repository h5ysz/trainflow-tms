const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const t = await prisma.trainee.findUnique({ where: { id: '849f66d0-eb5a-4117-8fa5-b8ee5e1dc474' }, select: { documents: true } });
  console.log(t.documents);
  await prisma.$disconnect();
})();
