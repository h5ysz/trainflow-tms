// Comprehensive test: create a NEW request via the UI dialog with status=SUBMITTED
// This tests the handleSubmit → POST /api/requests flow
import { chromium } from "playwright";
const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Capture ALL API responses
  page.on("response", async (res) => {
    if (res.url().includes("/api/")) {
      let body = "";
      try { body = await res.text(); } catch {}
      const status = res.status();
      console.log(`  [${status}] ${res.request().method()} ${res.url()}`);
      if (status >= 400) {
        console.log(`     BODY: ${body.slice(0, 500)}`);
      }
    }
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`  ⚠️ CONSOLE: ${msg.text().slice(0, 200)}`);
  });
  page.on("pageerror", (err) => console.log(`  ⚠️ PAGE ERROR: ${err.message}`));

  console.log("→ Logging in as contractor…");
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

  // Navigate to Training Requests
  console.log("\n→ Navigating to Training Requests…");
  const navTexts = await page.locator("a, button").allTextContents();
  const reqMatch = navTexts.findIndex((t) => /Training Requests/.test(t || ""));
  await page.locator("a, button").nth(reqMatch).click();
  await page.waitForTimeout(3000);

  // Click "New Request" button
  console.log("\n→ Clicking 'New Request' button…");
  const allBtns = page.locator('button');
  const btnCount = await allBtns.count();
  for (let i = 0; i < btnCount; i++) {
    const text = ((await allBtns.nth(i).textContent()) || '').trim();
    if (/^New Request$/.test(text)) {
      await allBtns.nth(i).click();
      console.log("  ✓ Clicked New Request");
      break;
    }
  }
  await page.waitForTimeout(2000);

  // Take screenshot of the dialog
  await page.screenshot({ path: "/home/z/my-project/download/screenshots/new-request-dialog.png" });

  // Find the Course select and pick the first course
  console.log("\n→ Selecting course…");
  const courseSelect = page.locator('select').first();
  if (await courseSelect.count() > 0) {
    const options = await courseSelect.locator('option').all();
    if (options.length > 1) {
      const firstCourseVal = await options[1].getAttribute('value');
      await courseSelect.selectOption(firstCourseVal);
      console.log(`  ✓ Selected course: ${firstCourseVal}`);
    }
  }

  // Find the Status select and pick "SUBMITTED"
  console.log("→ Selecting status = SUBMITTED…");
  const statusSelect = page.locator('select').filter({ hasText: /Draft|Submit/ });
  const statusCount = await statusSelect.count();
  for (let i = 0; i < statusCount; i++) {
    const sel = statusSelect.nth(i);
    const opts = await sel.locator('option').allTextContents();
    if (opts.some((o) => /submit/i.test(o))) {
      await sel.selectOption("SUBMITTED");
      console.log("  ✓ Selected SUBMITTED");
      break;
    }
  }

  // Add a trainee row
  console.log("→ Adding a trainee…");
  const addRowBtn = page.locator('button').filter({ hasText: /Add Row/i }).first();
  if (await addRowBtn.count() > 0) {
    await addRowBtn.click();
    await page.waitForTimeout(500);
    // Fill the trainee name + national ID
    const nameInput = page.locator('input[placeholder*="name" i]').first();
    const idInput = page.locator('input[placeholder*="national" i], input[placeholder*="ID" i]').first();
    if (await nameInput.count() > 0) {
      await nameInput.fill("Test Trainee Submit");
    }
    if (await idInput.count() > 0) {
      await idInput.fill("9999999999");
    }
    console.log("  ✓ Added trainee");
  }

  // Find the Save/Submit button in the dialog footer
  console.log("\n→ Looking for Save/Submit button in dialog…");
  const dialogButtons = page.locator('[role="dialog"] button');
  const dialogBtnCount = await dialogButtons.count();
  let saveBtn = null;
  for (let i = 0; i < dialogBtnCount; i++) {
    const text = ((await dialogButtons.nth(i).textContent()) || '').trim();
    console.log(`  button[${i}]: "${text}"`);
    if (/^(Save|Submit|Create|Update)$/i.test(text)) {
      saveBtn = dialogButtons.nth(i);
    }
  }

  if (saveBtn) {
    console.log("\n→ Clicking Save/Submit…");
    await saveBtn.click();
    await page.waitForTimeout(5000);

    // Check for toast
    const toasts = await page.locator('[data-sonner-toast]').allTextContents();
    console.log(`\n→ Toasts: ${toasts.length}`);
    for (const t of toasts) console.log(`   • ${t}`);

    // Check for error text
    const bodyText = await page.locator('body').textContent();
    if (bodyText?.toLowerCase().includes("internal server error")) {
      console.log("\n→ ❌ 'Internal server error' FOUND in body");
    } else {
      console.log("\n→ ✅ No 'Internal server error' found");
    }

    await page.screenshot({ path: "/home/z/my-project/download/screenshots/new-request-after-save.png" });
  } else {
    console.log("  ⚠️ No Save/Submit button found in dialog");
  }

  await browser.close();
}
main().catch(e => { console.error("❌", e); process.exit(1); });
