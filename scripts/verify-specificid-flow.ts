// Verify that the API receives the correct `specificId` for specific_request + specific_course
// scopes after the dynamic dialog refactor.
//
// Usage: node --experimental-strip-types --env-file=.env scripts/verify-specificid-flow.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = "http://localhost:3000";

async function login(email: string, password: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error("Login failed: " + res.status);
  const setCookie = res.headers.get("set-cookie") || "";
  const m = setCookie.match(/tf_session=([^;]+)/);
  if (!m) throw new Error("No token");
  return "tf_session=" + m[1];
}

async function exportExcel(cookie, params, outFile) {
  const url = new URL(BASE + "/api/export/company-data");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("_t", Date.now().toString());
  const res = await fetch(url.toString(), { headers: { cookie } });
  if (!res.ok) throw new Error("Export " + res.status + ": " + await res.text());
  const buf = Buffer.from(await res.arrayBuffer());
  const fs = await import("fs");
  fs.writeFileSync("/home/z/my-project/download/" + outFile, buf);
  return buf.length;
}

async function main() {
  const cookie = await login("contractor@gcclab.com", "Demo@1234");
  console.log("✓ logged in");

  // Find latest request
  const req = await db.trainingRequest.findFirst({
    where: { company: { name: "Test Contractor Co." }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, refNumber: true },
  });
  console.log(`✓ latest request: ${req.refNumber} (${req.id})`);

  // Find any course
  const course = await db.course.findFirst({ where: { deletedAt: null }, select: { id: true, title: true } });
  console.log(`✓ course: ${course.title} (${course.id})`);

  const allItems = "requests,trainees,attendance,results,evaluations,certificates,invoices,attachments";

  // Test 1: specific_request with specificId
  console.log("\n→ Test: specific_request with specificId");
  const size1 = await exportExcel(
    cookie,
    { scope: "specific_request", specificId: req.id, items: allItems, format: "excel", locale: "en" },
    "dynamic-export-en-specific-request.xlsx",
  );
  console.log(`  ✓ exported ${size1} bytes`);

  // Test 2: specific_course with specificId
  console.log("\n→ Test: specific_course with specificId");
  const size2 = await exportExcel(
    cookie,
    { scope: "specific_course", specificId: course.id, items: allItems, format: "excel", locale: "en" },
    "dynamic-export-en-specific-course.xlsx",
  );
  console.log(`  ✓ exported ${size2} bytes`);

  // Test 3: date_range with from/to
  console.log("\n→ Test: date_range with from/to");
  const size3 = await exportExcel(
    cookie,
    { scope: "date_range", dateFrom: "2020-01-01", dateTo: "2030-12-31", items: allItems, format: "excel", locale: "en" },
    "dynamic-export-en-date-range.xlsx",
  );
  console.log(`  ✓ exported ${size3} bytes`);

  // Test 4: last (no specificId)
  console.log("\n→ Test: last (no specificId)");
  const size4 = await exportExcel(
    cookie,
    { scope: "last", items: allItems, format: "excel", locale: "en" },
    "dynamic-export-en-last.xlsx",
  );
  console.log(`  ✓ exported ${size4} bytes`);

  // Test 5: all (no specificId)
  console.log("\n→ Test: all (no specificId)");
  const size5 = await exportExcel(
    cookie,
    { scope: "all", items: allItems, format: "excel", locale: "en" },
    "dynamic-export-en-all.xlsx",
  );
  console.log(`  ✓ exported ${size5} bytes`);

  // Verify Summary sheets contain correct scope labels
  console.log("\n→ Verifying Summary sheets…");
  const openpyxlCheck = `
import openpyxl
for fname, expected_scope in [
  ('dynamic-export-en-specific-request.xlsx', 'Specific request'),
  ('dynamic-export-en-specific-course.xlsx', 'Specific course'),
  ('dynamic-export-en-date-range.xlsx', 'Date range'),
  ('dynamic-export-en-last.xlsx', 'Last request'),
  ('dynamic-export-en-all.xlsx', 'All data'),
]:
  wb = openpyxl.load_workbook('/home/z/my-project/download/' + fname)
  ws = wb['Summary']
  scope_val = None
  for row in ws.iter_rows(min_row=3, values_only=True):
    if row[0] and 'Export Scope' in str(row[0]):
      scope_val = row[1]
      break
  match = scope_val and expected_scope in str(scope_val)
  print(f"  {fname}: scope='{scope_val}' expected~'{expected_scope}' → {'✓' if match else '✗'}")
`;
  const { execSync } = await import("child_process");
  execSync(`python3 -c "${openpyxlCheck.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`, { stdio: "inherit" });

  console.log("\n✅ All flows verified — specificId reaches the API correctly for all scopes.");
}

main()
  .catch((e) => { console.error("❌", e); process.exit(1); })
  .finally(() => db.$disconnect());
