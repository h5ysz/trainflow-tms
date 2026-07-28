/**
 * Reset admin password — utility script.
 * Usage: npx tsx scripts/reset-admin-password.ts <new-password>
 * If no argument given, resets to the default "ChangeMeInProduction!2024".
 */
import { PrismaClient } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/jwt";

const db = new PrismaClient();

async function main() {
  const email = "admin@gcclab.com";
  const newPassword = process.argv[2] || "ChangeMeInProduction!2024";

  console.log(`Resetting password for ${email}...`);

  const user = await db.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`✗ User not found: ${email}`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(newPassword);

  await db.user.update({
    where: { id: user.id },
    data: {
      passwordHash,
      forcePasswordChange: false,
      failedLoginAttempts: 0,
      lockedUntil: null,
      accountStatus: "ACTIVE",
      isActive: true,
      updatedBy: user.id,
    },
  });

  // Audit log entry
  await db.auditLog.create({
    data: {
      userId: user.id,
      action: "UPDATE",
      entity: "USER",
      entityId: user.id,
      description: `Admin password reset via utility script`,
      descriptionAr: `تمت إعادة تعيين كلمة مرور المدير عبر السكريبت`,
      ipAddress: "localhost",
      userAgent: "reset-admin-password.ts",
      metadata: JSON.stringify({ source: "script", timestamp: new Date().toISOString() }),
    },
  });

  console.log(`\n✓ Password reset successfully for ${email}`);
  console.log(`  New password: ${newPassword}`);
  console.log(`  Account status: ACTIVE`);
  console.log(`  Failed attempts: 0 (cleared)`);
  console.log(`  Locked until: null (cleared)`);
  console.log(`  Force change on next login: false`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
