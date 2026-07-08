// /api/report-templates — list available report templates
import { listTemplates } from "@/lib/reports/template-registry";
import { getCurrentUser, ok, fail } from "@/lib/auth/api";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return fail("Unauthorized", 401);
  return ok(listTemplates());
}
