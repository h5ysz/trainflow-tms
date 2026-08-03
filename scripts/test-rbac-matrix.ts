// RBAC matrix verification — for each role × each request status, capture
// which action buttons are visible. This produces the RBAC matrix table
// the user asked for in the QA report.
//
// Strategy: for each role, log in, then for each request status, manually
// set a test request to that status via DB, then load the page and extract
// the visible action buttons.
import { chromium } from "playwright";
import { PrismaClient } from "@prisma/client";
import * as fs from "fs";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const OUT_DIR = "/home/z/my-project/download/screenshots";

const REQUEST_ID = "d9117dcb-16dd-45f5-9bfe-b2c7d56a262d"; // The test request
const STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "REQUIRES_MODIFICATION",
  "APPROVED",
  "REJECTED",
  "SCHEDULED",
  "IN_PROGRESS",
  "COMPLETED",
  "CANCELLED",
];

const ROLES_ARG = process.argv[2]; // Optional: filter to a single role
const ROLES = [
  { email: "contractor@gcclab.com", password: "Demo@1234", role: "CONTRACTOR" },
  { email: "coordinator@gcclab.com", password: "Demo@1234", role: "COORDINATOR" },
  { email: "admin@gcclab.com", password: "ChangeMeInProduction!2024", role: "SUPER_ADMIN" },
  { email: "auditor@gcclab.com", password: "Demo@1234", role: "AUDITOR" },
].filter((r) => !ROLES_ARG || r.role === ROLES_ARG);

async function login(page, email, password) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.fill('#email', email);
  await page.fill('#password', password);
  const buttons = page.locator('button');
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    const text = ((await buttons.nth(i).textContent()) || '').trim();
    if (/^sign in$/i.test(text)) { await buttons.nth(i).click(); break; }
  }
  await page.waitForTimeout(3000);
}

async function logout(page) {
  // Navigate to home and clear localStorage to force re-login
  await page.evaluate(() => {
    try { localStorage.clear(); } catch {}
  });
  await page.context().clearCookies();
}

async function setRequestStatus(status) {
  // Update via Prisma directly (bypass the API)
  const updates: Record<string, unknown> = { status };
  if (status === "SUBMITTED") updates.submittedAt = new Date();
  if (status === "UNDER_REVIEW") updates.reviewedAt = new Date();
  if (status === "APPROVED") { updates.approvedAt = new Date(); }
  if (status === "REJECTED") updates.rejectedAt = new Date();
  if (status === "CANCELLED") updates.cancelledAt = new Date();
  if (status === "SCHEDULED") updates.scheduledAt = new Date();
  if (status === "IN_PROGRESS") updates.startedAt = new Date();
  if (status === "COMPLETED") updates.completedAt = new Date();
  // Reset all timestamps when going back to DRAFT
  if (status === "DRAFT") {
    updates.submittedAt = null;
    updates.reviewedAt = null;
    updates.approvedAt = null;
    updates.scheduledAt = null;
    updates.startedAt = null;
    updates.completedAt = null;
    updates.cancelledAt = null;
    updates.rejectedAt = null;
    updates.rejectionReason = null;
  }
  await db.trainingRequest.update({ where: { id: REQUEST_ID }, data: updates });
}

async function getVisibleButtons(page, status) {
  // Reload the page to pick up the new status
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);

  // Navigate to Training Requests page
  const navTexts = await page.locator("a, button").allTextContents();
  const reqMatch = navTexts.findIndex((t) => /Training Requests/.test(t || ""));
  if (reqMatch >= 0) {
    await page.locator("a, button").nth(reqMatch).click();
    await page.waitForTimeout(3000);
  }

  // Find the row containing our test request (TR-1785631067839)
  const row = page.locator('tr').filter({ hasText: "TR-1785631067839" }).first();
  if (await row.count() === 0) {
    return { found: false, buttons: [], status };
  }

  // Get all buttons in the row
  const buttons = row.locator('button');
  const btnCount = await buttons.count();
  const buttonInfo: { text: string; title: string; disabled: boolean }[] = [];
  for (let i = 0; i < btnCount; i++) {
    const text = ((await buttons.nth(i).textContent()) || '').trim();
    const title = await buttons.nth(i).getAttribute('title');
    const disabled = await buttons.nth(i).isDisabled();
    buttonInfo.push({ text, title: title || '', disabled });
  }
  return { found: true, buttons: buttonInfo, status };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const results: Array<{ role: string; status: string; found: boolean; buttons: string[] }> = [];

  for (const { email, password, role } of ROLES) {
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`ROLE: ${role}  (${email})`);
    console.log(`════════════════════════════════════════════════════════════`);

    try {
      await login(page, email, password);
      console.log(`  ✓ logged in`);
    } catch (e) {
      console.log(`  ⚠️ login failed: ${e.message}`);
      continue;
    }

    for (const status of STATUSES) {
      console.log(`\n  → Setting request to ${status}…`);
      try {
        await setRequestStatus(status);
      } catch (e) {
        console.log(`    ⚠️ DB update failed: ${e.message}`);
        continue;
      }

      const result = await getVisibleButtons(page, status);
      if (!result.found) {
        console.log(`    ⚠️ Request row not found on page`);
        results.push({ role, status, found: false, buttons: [] });
        continue;
      }

      // Normalize button list — extract text labels (ignore icon-only buttons' empty text)
      const labels = result.buttons.map((b: { text: string; title: string; disabled: boolean }) => {
        if (b.text && b.text.length > 0 && b.text.length < 30) return b.text;
        if (b.title) return `[${b.title}]`;
        return '';
      }).filter((s: string) => s.length > 0);

      console.log(`    buttons: ${labels.length === 0 ? '(none)' : labels.join(', ')}`);
      results.push({ role, status, found: true, buttons: labels });
    }

    await logout(page);
  }

  await browser.close();

  // ── Print RBAC matrix ──
  console.log("\n\n═══════════════════════════════════════════════════════════════════");
  console.log("RBAC MATRIX — Action buttons visible per role × status");
  console.log("═══════════════════════════════════════════════════════════════════\n");

  // Print header
  const statusHeader = "Status".padEnd(22);
  const roleHeaders = ROLES.map((r) => r.role.padEnd(28)).join(" | ");
  console.log(`${statusHeader} | ${roleHeaders}`);
  console.log(`${"-".repeat(22)} | ${ROLES.map(() => "-".repeat(28)).join(" | ")}`);

  for (const status of STATUSES) {
    const row = status.padEnd(22);
    const cells = ROLES.map((r) => {
      const result = results.find((x) => x.role === r.role && x.status === status);
      if (!result || !result.found) return "(not found)".padEnd(28);
      const btns = result.buttons.join(", ");
      return btns.slice(0, 28).padEnd(28);
    });
    console.log(`${row} | ${cells.join(" | ")}`);
  }

  // Save as JSON (merge with existing if present, to allow role-by-role runs)
  const outPath = "/home/z/my-project/download/rbac-matrix-test-results.json";
  let existing: Array<{ role: string; status: string; found: boolean; buttons: string[] }> = [];
  try {
    if (fs.existsSync(outPath) && !ROLES_ARG) {
      // Overwrite on full run
      existing = [];
    } else if (fs.existsSync(outPath)) {
      existing = JSON.parse(fs.readFileSync(outPath, "utf8"));
      // Remove entries for the role(s) we just tested (to avoid duplicates)
      const testedRoles = new Set(ROLES.map((r) => r.role));
      existing = existing.filter((e) => !testedRoles.has(e.role));
    }
  } catch {}
  const merged = [...existing, ...results];
  fs.writeFileSync(outPath, JSON.stringify(merged, null, 2));
  console.log(`\n✅ Saved: ${outPath} (${merged.length} entries)`);

  await db.$disconnect();
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
