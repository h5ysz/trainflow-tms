const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

(async () => {
  const user = await prisma.user.findUnique({
    where: { email: 'contractor@gcclab.com' },
    select: { passwordHash: true }
  });
  
  const [algo, iterations, saltB64, hashB64] = user.passwordHash.split('$');
  const salt = Buffer.from(saltB64, 'base64');
  const realHash = Buffer.from(hashB64, 'base64');
  const iter = parseInt(iterations, 10);
  
  // Search the codebase for what password was used
  const candidates = [
    'Demo@1234', 'demo1234', 'Demo1234', 'demo@1234',
    'Password123', 'password', '12345678', 'Test@1234',
    'Coordinator@123', 'Trainer@123', 'Contractor@123',
    'demo', 'test', 'admin', 'DemoPassword1', 'demo123',
    'Coordinator123', 'Trainer123', 'Contractor123',
    'Gcclab@123', 'gcclab123', 'GCCLAB@123',
    'Demo!1234', 'Demo#1234', 'demo12345', 'DemoPass1',
    'Demo@1234!', 'Test1234', 'test@1234', 'P@ssw0rd',
    'Safety@123', 'Training@123', 'Tms@1234'
  ];
  
  console.log("Testing candidates against contractor hash...");
  for (const pwd of candidates) {
    const computed = crypto.pbkdf2Sync(pwd, salt, iter, realHash.length, 'sha256');
    if (computed.equals(realHash)) {
      console.log(`  ✓✓✓ MATCH FOUND: "${pwd}"`);
      await prisma.$disconnect();
      return;
    }
  }
  console.log("  No match found in candidates");
  
  // Look at the seed scripts
  console.log("\n=== Search seed files ===");
  const fs = require('fs');
  const seedFiles = fs.readdirSync('/home/z/my-project/scripts').filter(f => f.includes('seed'));
  for (const f of seedFiles) {
    console.log(`\n--- ${f} ---`);
    const content = fs.readFileSync(`/home/z/my-project/scripts/${f}`, 'utf8');
    // Look for password strings and User creation
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      if (/password|pwd|hash|user/i.test(line) && !/^\s*(\/\/|\*|import)/.test(line)) {
        console.log(`  L${i+1}: ${line.trim().substring(0, 120)}`);
      }
    });
  }
  await prisma.$disconnect();
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
