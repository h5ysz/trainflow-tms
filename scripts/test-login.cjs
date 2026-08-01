const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

(async () => {
  const user = await prisma.user.findUnique({
    where: { email: 'contractor@gcclab.com' },
    select: { email: true, passwordHash: true, role: true }
  });
  
  const [algo, iterations, saltB64, hashB64] = user.passwordHash.split('$');
  const salt = Buffer.from(saltB64, 'base64');
  const realHash = Buffer.from(hashB64, 'base64');
  const iter = parseInt(iterations, 10);
  
  const pwd = 'Demo@1234';
  const computed = crypto.pbkdf2Sync(pwd, salt, iter, realHash.length, 'sha256');
  const match = computed.equals(realHash);
  console.log(`Login test: ${user.email} / ${pwd} => ${match ? '✓ SUCCESS' : '✗ FAILED'}`);
  await prisma.$disconnect();
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
