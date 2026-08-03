const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
(async () => {
  const users = await prisma.user.findMany({
    select: { email: true, passwordHash: true, role: true }
  });
  for (const u of users) {
    console.log(`${u.email} | role=${u.role} | hash=${u.passwordHash.substring(0, 25)}...`);
  }
  await prisma.$disconnect();
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
