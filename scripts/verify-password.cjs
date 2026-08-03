const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

// Read the seed script to see what password was set
const fs = require('fs');
const seedContent = fs.readFileSync('/home/z/my-project/scripts/seed-test-users.ts', 'utf8');
console.log("=== Seed script password references ===");
const pwdMatches = seedContent.match(/password[:\s]*['"][^'"]+['"]/g);
if (pwdMatches) pwdMatches.forEach(m => console.log(m));

(async () => {
  const user = await prisma.user.findUnique({
    where: { email: 'contractor@gcclab.com' },
    select: { email: true, passwordHash: true, role: true }
  });
  console.log("\n=== Full hash for contractor ===");
  console.log(user.passwordHash);
  
  // Try to verify common passwords
  const candidates = ['Demo@1234', 'contractor123', 'password123', 'ChangeMeInProduction!2024'];
  const [algo, iterations, saltB64, hashB64] = user.passwordHash.split('$');
  const salt = Buffer.from(saltB64, 'base64');
  const realHash = Buffer.from(hashB64, 'base64');
  const iter = parseInt(iterations, 10);
  console.log(`\n=== Verifying (algo=${algo}, iter=${iter}) ===`);
  for (const pwd of candidates) {
    const computed = crypto.pbkdf2Sync(pwd, salt, iter, realHash.length, 'sha256');
    const match = computed.equals(realHash);
    console.log(`  ${pwd.padEnd(30)} ${match ? '✓ MATCH' : '✗'}`);
  }
  await prisma.$disconnect();
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
