// Test the Excel export endpoint as the contractor user.
// Generates sample .xlsx files in /home/z/my-project/download/ for inspection
// and for screenshot generation.
//
// Usage:  node --experimental-strip-types --env-file=.env scripts/test-excel-export.ts
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();
const BASE = "http://localhost:3000";

async function login(email: string, password: string): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status} ${await res.text()}`);
  const setCookie = res.headers.get("set-cookie") || "";
  // Cookie name is tf_session (legacy alias gcclab-token also accepted)
  const tokenMatch = setCookie.match(/(?:^|;\s*)tf_session=([^;]+)/);
  if (!tokenMatch) throw new Error(`No token cookie in response for ${email}`);
  return `tf_session=${tokenMatch[1]}`;
}

async function exportExcel(
  cookie: string,
  params: Record<string, string>,
  outFile: string,
): Promise<{ size: number; status: number; filename: string }> {
  const url = new URL(`${BASE}/api/export/company-data`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString(), {
    headers: { cookie },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Export failed (${res.status}): ${text}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const fs = await import("fs");
  const path = `/home/z/my-project/download/${outFile}`;
  fs.writeFileSync(path, buf);
  const cd = res.headers.get("content-disposition") || "";
  const fnameMatch = cd.match(/filename="([^"]+)"/);
  return {
    size: buf.length,
    status: res.status,
    filename: fnameMatch ? fnameMatch[1] : outFile,
  };
}

async function main() {
  console.log("→ Logging in as contractor@gcclab.com …");
  const cookie = await login("contractor@gcclab.com", "Demo@1234");
  console.log("✓ Logged in.");

  // Find a course we can filter by (specific_course scope).
  // Course doesn't have a direct companyCourses relation, so just take the
  // first course — the contractor's requests will be filtered by it on the
  // server side, and if no requests match, the test still produces a valid
  // (mostly empty) workbook to verify the sheet structure.
  const course2 = await db.course.findFirst({
    where: { deletedAt: null },
    select: { id: true, title: true },
  });
  console.log(`✓ Using course for specific_course scope: ${course2?.title} (${course2?.id})`);

  // Find the most recent training request for the contractor's company
  const company = await db.company.findFirst({
    where: { name: "Test Contractor Co." },
    select: { id: true, name: true },
  });
  const lastReq = await db.trainingRequest.findFirst({
    where: { companyId: company?.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, refNumber: true },
  });
  console.log(`✓ Last request: ${lastReq?.refNumber}`);

  const allItems = [
    "requests", "trainees", "attendance", "results",
    "evaluations", "certificates", "invoices", "attachments",
  ].join(",");

  console.log("\n→ Export 1: EN, scope=all, all items");
  const r1 = await exportExcel(
    cookie,
    { scope: "all", items: allItems, format: "excel", locale: "en" },
    "export-en-all.xlsx",
  );
  console.log(`  ✓ ${r1.filename} — ${(r1.size / 1024).toFixed(1)} KB`);

  console.log("\n→ Export 2: AR, scope=all, all items");
  const r2 = await exportExcel(
    cookie,
    { scope: "all", items: allItems, format: "excel", locale: "ar" },
    "export-ar-all.xlsx",
  );
  console.log(`  ✓ ${r2.filename} — ${(r2.size / 1024).toFixed(1)} KB`);

  console.log("\n→ Export 3: EN, scope=specific_course, all items");
  const r3 = await exportExcel(
    cookie,
    {
      scope: "specific_course",
      specificId: course2!.id,
      items: allItems,
      format: "excel",
      locale: "en",
    },
    "export-en-specific-course.xlsx",
  );
  console.log(`  ✓ ${r3.filename} — ${(r3.size / 1024).toFixed(1)} KB`);

  console.log("\n→ Export 4: AR, scope=specific_course, all items");
  const r4 = await exportExcel(
    cookie,
    {
      scope: "specific_course",
      specificId: course2!.id,
      items: allItems,
      format: "excel",
      locale: "ar",
    },
    "export-ar-specific-course.xlsx",
  );
  console.log(`  ✓ ${r4.filename} — ${(r4.size / 1024).toFixed(1)} KB`);

  console.log("\n→ Export 5: EN, scope=last, requests + trainees only");
  const r5 = await exportExcel(
    cookie,
    { scope: "last", items: "requests,trainees", format: "excel", locale: "en" },
    "export-en-last-partial.xlsx",
  );
  console.log(`  ✓ ${r5.filename} — ${(r5.size / 1024).toFixed(1)} KB`);

  console.log("\n→ Export 6: AR, scope=specific_request, all items");
  const r6 = await exportExcel(
    cookie,
    {
      scope: "specific_request",
      specificId: lastReq!.id,
      items: allItems,
      format: "excel",
      locale: "ar",
    },
    "export-ar-specific-request.xlsx",
  );
  console.log(`  ✓ ${r6.filename} — ${(r6.size / 1024).toFixed(1)} KB`);

  console.log("\n✅ All 6 export scenarios completed.");
  console.log("   Files saved to: /home/z/my-project/download/");
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
