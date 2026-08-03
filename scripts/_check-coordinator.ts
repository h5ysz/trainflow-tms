import { db } from "../src/lib/db";
import { actionPermissions, moduleAccess } from "../src/lib/auth/permissions";
async function main() {
  const role = await db.role.findFirst({ where: { name: "Coordinator" } });
  console.log("Role permissions:", role?.permissions);
  console.log("Expected actionPermissions.COORDINATOR:", Object.keys(actionPermissions.COORDINATOR));
  console.log("Expected moduleAccess.COORDINATOR includes dashboard:", moduleAccess.COORDINATOR.includes("dashboard"));
  // Check if dashboard is in actionPermissions
  console.log("dashboard in actionPermissions.COORDINATOR:", "dashboard" in (actionPermissions.COORDINATOR || {}));
}
main().then(() => process.exit(0)).catch(console.error);
