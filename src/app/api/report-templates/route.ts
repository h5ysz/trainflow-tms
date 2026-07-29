// /api/report-templates — list available report templates
import { listTemplates } from "@/lib/reports/template-registry";
import { withModuleAction, ok } from "@/lib/auth/api";

export const GET = withModuleAction("reports", "view", async () => ok(listTemplates()));
