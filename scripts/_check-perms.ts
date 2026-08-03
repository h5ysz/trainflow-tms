import { db } from "../src/lib/db";
async function main() {
  const user = await db.user.findFirst({ where: { email: "coordinator@gcclab.com" } });
  if (!user) { console.log("not found"); return; }
  console.log("User:", user.email, "Role:", user.role);
  console.log("Permissions (from Role row):", user.permissions);
  // Check the Role row
  if (user.roleId) {
    const role = await db.role.findUnique({ where: { id: user.roleId } });
    console.log("Role row:", role?.name, "permissions:", role?.permissions);
  }
}
main().then(() => process.exit(0)).catch(console.error);
