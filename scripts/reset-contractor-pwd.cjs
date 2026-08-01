const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

// Use the same hashing function as the seed scripts
function hashPassword(password) {
  const PBKDF2_ITERATIONS = 600000;
  const salt = crypto.randomBytes(16);
  const derived = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

(async () => {
  // Reset password for all 5 demo users (everyone except SUPER_ADMIN)
  const targetEmails = [
    'contractor@gcclab.com',
    'coordinator@gcclab.com',
    'trainer@gcclab.com',
    'auditor@gcclab.com',
    'company.admin@gcclab.com'
  ];
  const newPassword = 'Demo@1234';
  const newHash = hashPassword(newPassword);
  
  console.log(`Resetting password to "${newPassword}" for:`);
  for (const email of targetEmails) {
    const updated = await prisma.user.update({
      where: { email },
      data: { passwordHash: newHash, forcePasswordChange: false, accountStatus: 'ACTIVE' },
      select: { email: true, role: true }
    });
    console.log(`  ✓ ${updated.email} (${updated.role})`);
  }
  await prisma.$disconnect();
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
