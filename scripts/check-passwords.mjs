import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
const users = await prisma.user.findMany({
  where: { email: { in: ['contractor@gcclab.com', 'admin@gcclab.com', 'coordinator@gcclab.com'] } },
  select: { email: true, password: true, role: true }
});
for (const u of users) {
  console.log(`${u.email} | role=${u.role} | password=${u.password}`);
}
await prisma.$disconnect();
