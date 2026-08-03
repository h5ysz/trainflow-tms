const { PrismaClient } = require('@prisma/client');
const crypto = require('crypto');
const prisma = new PrismaClient();

// MUST match src/lib/auth/jwt.ts exactly:
//   pbkdf2$<iter>$<salt_hex>$<derived_hex>
const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 16;
const KEY_LENGTH = 32;

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, 'sha256');
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

(async () => {
  const targetEmails = [
    'contractor@gcclab.com',
    'coordinator@gcclab.com',
    'trainer@gcclab.com',
    'auditor@gcclab.com',
    'company.admin@gcclab.com'
  ];
  const newPassword = 'Demo@1234';
  const newHash = hashPassword(newPassword);
  
  console.log(`Resetting password to "${newPassword}" (hex format):`);
  for (const email of targetEmails) {
    const updated = await prisma.user.update({
      where: { email },
      data: { passwordHash: newHash, forcePasswordChange: false, accountStatus: 'ACTIVE', failedLoginAttempts: 0, lockedUntil: null },
      select: { email: true, role: true }
    });
    console.log(`  ✓ ${updated.email} (${updated.role})`);
  }
  
  // Verify by re-running the verifyPassword logic
  console.log("\nVerification:");
  const user = await prisma.user.findUnique({
    where: { email: 'contractor@gcclab.com' },
    select: { passwordHash: true }
  });
  const parts = user.passwordHash.split('$');
  const iter = parseInt(parts[1], 10);
  const saltBuffer = Buffer.from(parts[2], 'hex');
  const expectedBuffer = Buffer.from(parts[3], 'hex');
  const derived = crypto.pbkdf2Sync('Demo@1234', saltBuffer, iter, 32, 'sha256');
  const match = derived.length === expectedBuffer.length && crypto.timingSafeEqual(derived, expectedBuffer);
  console.log(`  contractor@gcclab.com / Demo@1234 => ${match ? '✓ VALID' : '✗ INVALID'}`);
  
  await prisma.$disconnect();
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
