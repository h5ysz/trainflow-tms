// Full end-to-end test of the submit flow:
// 1. Reset request to DRAFT
// 2. Submit as contractor (DRAFT → SUBMITTED)
// 3. Verify status changed to SUBMITTED
// 4. Verify coordinator notification was created
// 5. Verify no "Internal server error"
// 6. Verify success toast in UI
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import * as fs from "fs";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const REQUEST_ID = "d9117dcb-16dd-45f5-9bfe-b2c7d56a262d";

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("FULL SUBMIT FLOW TEST — DRAFT → SUBMITTED");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // ── Step 0: Reset request to DRAFT ──
  console.log("→ Step 0: Resetting request to DRAFT…");
  await db.trainingRequest.update({
    where: { id: REQUEST_ID },
    data: {
      status: "DRAFT", submittedAt: null, reviewedAt: null, approvedAt: null,
      scheduledAt: null, startedAt: null, completedAt: null, cancelledAt: null,
      rejectedAt: null, rejectionReason: null,
    },
  });
  console.log("  ✓ Reset to DRAFT\n");

  // ── Step 1: Count coordinator notifications BEFORE submit ──
  const coordinator = await db.user.findFirst({
    where: { role: "COORDINATOR", isActive: true, deletedAt: null },
    select: { id: true, email: true },
  });
  console.log(`→ Step 1: Coordinator found: ${coordinator?.email}`);
  const notifsBefore = await db.notification.count({
    where: { userId: coordinator!.id },
  });
  console.log(`  Notifications before submit: ${notifsBefore}\n`);

  // ── Step 2: Login as contractor + navigate to requests ──
  console.log("→ Step 2: Logging in as contractor…");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Track API responses
  let submitApiStatus: number | null = null;
  let submitApiBody: string = "";
  page.on("response", async (res) => {
    if (res.url().includes("/transition") || res.url().includes("/requests")) {
      const status = res.status();
      if (res.request().method() === "POST" && res.url().includes("/transition")) {
        submitApiStatus = status;
        submitApiBody = await res.text().catch(() => "");
      }
      console.log(`  [${status}] ${res.request().method()} ${res.url()}`);
    }
  });

  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await page.fill('#email', "contractor@gcclab.com");
  await page.fill('#password', "Demo@1234");
  const buttons = page.locator('button');
  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    const text = ((await buttons.nth(i).textContent()) || '').trim();
    if (/^sign in$/i.test(text)) { await buttons.nth(i).click(); break; }
  }
  await page.waitForTimeout(3000);
  console.log("  ✓ Logged in\n");

  // Navigate to Training Requests
  console.log("→ Step 3: Navigating to Training Requests…");
  const navTexts = await page.locator("a, button").allTextContents();
  const reqMatch = navTexts.findIndex((t) => /Training Requests/.test(t || ""));
  await page.locator("a, button").nth(reqMatch).click();
  await page.waitForTimeout(3000);

  // ── Step 4: Click Submit button ──
  console.log("\n→ Step 4: Clicking Submit button on DRAFT request…");
  const allBtns = page.locator('button');
  const btnCount = await allBtns.count();
  for (let i = 0; i < btnCount; i++) {
    const text = ((await allBtns.nth(i).textContent()) || '').trim();
    if (/^Submit$/.test(text)) {
      await allBtns.nth(i).click();
      console.log("  ✓ Clicked Submit");
      break;
    }
  }
  await page.waitForTimeout(4000);

  // ── Step 5: Check for toast messages ──
  console.log("\n→ Step 5: Checking toast messages…");
  const toasts = await page.locator('[data-sonner-toast]').allTextContents();
  console.log(`  Toasts visible: ${toasts.length}`);
  for (const t of toasts) console.log(`    • ${t}`);

  // Check body for "Internal server error"
  const bodyText = await page.locator('body').textContent();
  const hasInternalError = bodyText?.toLowerCase().includes("internal server error");
  console.log(`  'Internal server error' in body: ${hasInternalError ? "❌ YES" : "✅ NO"}`);

  await page.screenshot({ path: "/home/z/my-project/download/screenshots/full-test-after-submit.png" });

  await browser.close();

  // ── Step 6: Verify status changed in DB ──
  console.log("\n→ Step 6: Verifying status changed in DB…");
  const reqAfter = await db.trainingRequest.findUnique({
    where: { id: REQUEST_ID },
    select: { status: true, submittedAt: true, updatedAt: true },
  });
  console.log(`  Status:     ${reqAfter?.status} (expected: SUBMITTED)`);
  console.log(`  SubmittedAt: ${reqAfter?.submittedAt}`);
  console.log(`  UpdatedAt:   ${reqAfter?.updatedAt}`);
  const statusOk = reqAfter?.status === "SUBMITTED";
  console.log(`  Result: ${statusOk ? "✅ PASS" : "❌ FAIL"}\n`);

  // ── Step 7: Verify coordinator notification was created ──
  console.log("→ Step 7: Verifying coordinator notification was created…");
  const notifsAfter = await db.notification.count({
    where: { userId: coordinator!.id },
  });
  console.log(`  Notifications after submit: ${notifsAfter} (before: ${notifsBefore})`);
  const newNotifs = notifsAfter - notifsBefore;
  console.log(`  New notifications: ${newNotifs}`);

  if (newNotifs > 0) {
    const latestNotif = await db.notification.findFirst({
      where: { userId: coordinator!.id },
      orderBy: { createdAt: "desc" },
      select: { title: true, titleAr: true, message: true, messageAr: true, type: true },
    });
    console.log(`  Latest notification:`);
    console.log(`    Title:    ${latestNotif?.title}`);
    console.log(`    TitleAr:  ${latestNotif?.titleAr}`);
    console.log(`    Message:  ${latestNotif?.message}`);
    console.log(`    MsgAr:    ${latestNotif?.messageAr}`);
    console.log(`    Type:     ${latestNotif?.type}`);
  }
  const notifOk = newNotifs > 0;
  console.log(`  Result: ${notifOk ? "✅ PASS" : "❌ FAIL"}\n`);

  // ── Step 8: Verify API response ──
  console.log("→ Step 8: Verifying API response…");
  console.log(`  API status: ${submitApiStatus} (expected: 200)`);
  const apiOk = submitApiStatus === 200;
  console.log(`  Result: ${apiOk ? "✅ PASS" : "❌ FAIL"}\n`);

  // ── Summary ──
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Status changed (DRAFT → SUBMITTED):  ${statusOk ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  API returned HTTP 200:               ${apiOk ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  No 'Internal server error':          ${!hasInternalError ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`  Coordinator notified:                ${notifOk ? "✅ PASS" : "❌ FAIL"}`);
  const allPass = statusOk && apiOk && !hasInternalError && notifOk;
  console.log(`\n  Overall: ${allPass ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}\n`);

  await db.$disconnect();
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
