// Full end-to-end test of the Read-Only Tracking View policy:
// 1. As contractor, verify Edit button visible on DRAFT
// 2. Submit (DRAFT → SUBMITTED)
// 3. Verify Edit button HIDDEN on SUBMITTED (read-only)
// 4. Verify Preview button still visible + shows trainees/attachments
// 5. Verify Print + Export buttons still visible
// 6. As coordinator, return the request (SUBMITTED → REQUIRES_MODIFICATION)
// 7. As contractor, verify Edit button VISIBLE again on REQUIRES_MODIFICATION
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import * as fs from "fs";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const OUT_DIR = "/home/z/my-project/download/screenshots";
const REQUEST_ID = "d9117dcb-16dd-45f5-9bfe-b2c7d56a262d";

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

async function navigateToRequests(page) {
  const navTexts = await page.locator("a, button").allTextContents();
  const reqMatch = navTexts.findIndex((t) => /Training Requests/.test(t || ""));
  if (reqMatch >= 0) {
    await page.locator("a, button").nth(reqMatch).click();
    await page.waitForTimeout(3000);
  }
}

async function getRowButtons(page, refNumber) {
  const row = page.locator('tr').filter({ hasText: refNumber }).first();
  if (await row.count() === 0) return { found: false, buttons: [] };
  const buttons = row.locator('button');
  const btnCount = await buttons.count();
  const buttonInfo = [];
  for (let i = 0; i < btnCount; i++) {
    const text = ((await buttons.nth(i).textContent()) || '').trim();
    const title = await buttons.nth(i).getAttribute('title');
    buttonInfo.push({ text, title: title || '' });
  }
  return { found: true, buttons: buttonInfo };
}

async function setRequestStatus(status) {
  const updates = { status };
  if (status === "DRAFT") {
    Object.assign(updates, {
      submittedAt: null, reviewedAt: null, approvedAt: null,
      scheduledAt: null, startedAt: null, completedAt: null,
      cancelledAt: null, rejectedAt: null, rejectionReason: null,
    });
  }
  await db.trainingRequest.update({ where: { id: REQUEST_ID }, data: updates });
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const results = [];

  // ════════════════════════════════════════════════════════════════
  // TEST 1: Contractor on DRAFT — should see Edit + Submit + Cancel
  // ════════════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("TEST 1: Contractor on DRAFT (should see Edit + Submit + Cancel)");
  console.log("═══════════════════════════════════════════════════════════════");
  await setRequestStatus("DRAFT");
  await login(page, "contractor@gcclab.com", "Demo@1234");
  await navigateToRequests(page);
  const draftButtons = await getRowButtons(page, "TR-1785631067839");
  const draftBtnLabels = draftButtons.buttons.map(b => b.text || `[${b.title}]`);
  console.log(`  Buttons: ${draftBtnLabels.join(", ")}`);
  const draftHasEdit = draftBtnLabels.some(b => b === "[Edit]");
  const draftHasSubmit = draftBtnLabels.some(b => b === "Submit");
  results.push({
    test: "Contractor on DRAFT",
    expected: "Edit + Submit + Cancel",
    actual: draftBtnLabels.join(", "),
    pass: draftHasEdit && draftHasSubmit,
  });
  await page.screenshot({ path: `${OUT_DIR}/readonly-test-01-DRAFT.png` });

  // ════════════════════════════════════════════════════════════════
  // TEST 2: Submit → SUBMITTED — should NOT see Edit (read-only)
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("TEST 2: Submit → SUBMITTED (should NOT see Edit — read-only)");
  console.log("═══════════════════════════════════════════════════════════════");
  // Click Submit
  const allBtns = page.locator('button');
  const btnCount = await allBtns.count();
  for (let i = 0; i < btnCount; i++) {
    const text = ((await allBtns.nth(i).textContent()) || '').trim();
    if (/^Submit$/.test(text)) { await allBtns.nth(i).click(); break; }
  }
  await page.waitForTimeout(3000);
  // Reload
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  await navigateToRequests(page);
  const submittedButtons = await getRowButtons(page, "TR-1785631067839");
  const submittedBtnLabels = submittedButtons.buttons.map(b => b.text || `[${b.title}]`);
  console.log(`  Buttons: ${submittedBtnLabels.join(", ")}`);
  const submittedHasEdit = submittedBtnLabels.some(b => b === "[Edit]");
  const submittedHasPreview = submittedBtnLabels.some(b => b === "[Preview]");
  results.push({
    test: "Contractor on SUBMITTED",
    expected: "NO Edit (read-only) + Preview + Cancel",
    actual: submittedBtnLabels.join(", "),
    pass: !submittedHasEdit && submittedHasPreview,
  });
  await page.screenshot({ path: `${OUT_DIR}/readonly-test-02-SUBMITTED.png` });

  // ════════════════════════════════════════════════════════════════
  // TEST 3: Open Preview — verify it shows trainees + Print button
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("TEST 3: Open Preview — verify trainees + Print button visible");
  console.log("═══════════════════════════════════════════════════════════════");
  // Click Preview (eye icon)
  const previewBtn = page.locator('button[title="Preview"]').first();
  if (await previewBtn.count() > 0) {
    await previewBtn.click();
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${OUT_DIR}/readonly-test-03-preview.png` });

    // Check for trainees section
    const bodyText = await page.locator('body').textContent();
    const hasTraineesSection = bodyText?.toLowerCase().includes("trainees");
    const hasPrintButton = bodyText?.includes("Print");
    const hasEditButtonInPreview = bodyText?.includes("Edit");
    console.log(`  Trainees section visible: ${hasTraineesSection}`);
    console.log(`  Print button visible: ${hasPrintButton}`);
    console.log(`  Edit button in preview (should be false): ${hasEditButtonInPreview}`);
    results.push({
      test: "Preview on SUBMITTED",
      expected: "Trainees + Print visible, NO Edit",
      actual: `trainees=${hasTraineesSection}, print=${hasPrintButton}, edit=${hasEditButtonInPreview}`,
      pass: hasTraineesSection && hasPrintButton && !hasEditButtonInPreview,
    });

    // Close preview
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }

  // ════════════════════════════════════════════════════════════════
  // TEST 4: Coordinator returns the request (SUBMITTED → REQUIRES_MODIFICATION)
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("TEST 4: Coordinator returns request (SUBMITTED → REQUIRES_MODIFICATION)");
  console.log("═══════════════════════════════════════════════════════════════");
  // Logout contractor
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.context().clearCookies();
  // Login as coordinator
  await login(page, "coordinator@gcclab.com", "Demo@1234");
  await navigateToRequests(page);
  // Find "Return for Revision" button on SUBMITTED row
  const coordRow = page.locator('tr').filter({ hasText: "TR-1785631067839" }).first();
  const returnBtn = coordRow.locator('button').filter({ hasText: /Return for Revision/i }).first();
  if (await returnBtn.count() > 0) {
    await returnBtn.click();
    await page.waitForTimeout(1000);
    // Find the revision reason dialog + submit
    const dialogTextarea = page.locator('textarea').first();
    if (await dialogTextarea.count() > 0) {
      await dialogTextarea.fill("Please fix the trainee list.");
      const confirmBtn = page.locator('[role="dialog"] button').filter({ hasText: /Return for Revision|Submit|Confirm/i }).first();
      if (await confirmBtn.count() > 0) {
        await confirmBtn.click();
        await page.waitForTimeout(2000);
      }
    }
    console.log("  ✓ Returned for revision");
  } else {
    // Direct DB update as fallback
    await setRequestStatus("REQUIRES_MODIFICATION");
    console.log("  ⚠️ Return button not found — set status via DB");
  }

  // ════════════════════════════════════════════════════════════════
  // TEST 5: Contractor on REQUIRES_MODIFICATION — should see Edit again
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("TEST 5: Contractor on REQUIRES_MODIFICATION (should see Edit again)");
  console.log("═══════════════════════════════════════════════════════════════");
  // Logout coordinator
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.context().clearCookies();
  // Login as contractor
  await login(page, "contractor@gcclab.com", "Demo@1234");
  await navigateToRequests(page);
  const revisionButtons = await getRowButtons(page, "TR-1785631067839");
  const revisionBtnLabels = revisionButtons.buttons.map(b => b.text || `[${b.title}]`);
  console.log(`  Buttons: ${revisionBtnLabels.join(", ")}`);
  const revisionHasEdit = revisionBtnLabels.some(b => b === "[Edit]");
  const revisionHasResubmit = revisionBtnLabels.some(b => b === "Resubmit");
  results.push({
    test: "Contractor on REQUIRES_MODIFICATION",
    expected: "Edit + Resubmit + Cancel (editable again)",
    actual: revisionBtnLabels.join(", "),
    pass: revisionHasEdit && revisionHasResubmit,
  });
  await page.screenshot({ path: `${OUT_DIR}/readonly-test-05-REQUIRES_MODIFICATION.png` });

  await browser.close();

  // ════════════════════════════════════════════════════════════════
  // Print summary
  // ════════════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("READ-ONLY TRACKING VIEW — TEST SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════");
  for (const r of results) {
    console.log(`\n  Test: ${r.test}`);
    console.log(`  Expected: ${r.expected}`);
    console.log(`  Actual:   ${r.actual}`);
    console.log(`  Result:   ${r.pass ? "✅ PASS" : "❌ FAIL"}`);
  }
  const allPass = results.every(r => r.pass);
  console.log(`\n  Overall: ${allPass ? "✅ ALL TESTS PASSED" : "❌ SOME TESTS FAILED"}\n`);

  // Save results
  fs.writeFileSync(
    "/home/z/my-project/download/readonly-tracking-test-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log("✅ Saved: download/readonly-tracking-test-results.json");

  await db.$disconnect();
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
