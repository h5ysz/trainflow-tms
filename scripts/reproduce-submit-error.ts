// Reproduce the submit error from the UI as a contractor — capture backend
// stack trace + verify which buttons are visible after submission.
import { chromium } from "playwright";
import * as fs from "fs";

const BASE = "http://localhost:3000";
const OUT_DIR = "/home/z/my-project/download/screenshots";

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Capture all console + network errors
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`CONSOLE: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`PAGEERROR: ${err.message}`));
  page.on("requestfailed", (req) =>
    errors.push(`REQUEST FAILED: ${req.url()} — ${req.failure()?.errorText}`),
  );

  // Track API responses
  const apiResponses: { url: string; status: number; body: string }[] = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/")) {
      let body = "";
      try {
        body = await res.text();
      } catch {}
      apiResponses.push({ url, status: res.status(), body: body.slice(0, 2000) });
    }
  });

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
  await page.waitForTimeout(4000);

  // Navigate to Training Requests
  console.log("→ Navigating to Training Requests…");
  const navTexts = await page.locator("a, button").allTextContents();
  const reqMatch = navTexts.findIndex((t) => /^\s*(Requests|Training Requests)\s*$/i.test(t || ""));
  if (reqMatch >= 0) {
    await page.locator("a, button").nth(reqMatch).click();
    await page.waitForTimeout(3000);
  }

  // Take screenshot to see initial state
  await page.screenshot({ path: `${OUT_DIR}/debug-rbac-01-requests-list.png` });
  console.log("  ✓ screenshot 01 saved (initial list)");

  // Find the Submit button on the DRAFT request row
  console.log("\n→ Looking for Submit button on DRAFT request…");
  const allButtons = page.locator('button');
  const btnCount = await allButtons.count();
  let submitButton = null;
  for (let i = 0; i < btnCount; i++) {
    const text = ((await allButtons.nth(i).textContent()) || '').trim();
    if (/^Submit$/i.test(text)) {
      submitButton = allButtons.nth(i);
      console.log(`  → Found Submit button at index ${i}`);
      break;
    }
  }

  if (!submitButton) {
    console.log("  ⚠️ No Submit button found — checking page state");
    await page.screenshot({ path: `${OUT_DIR}/debug-rbac-no-submit.png` });
  } else {
    // Click Submit
    console.log("  → Clicking Submit…");
    await submitButton.click();
    await page.waitForTimeout(3000);

    // Capture toast / error message
    await page.screenshot({ path: `${OUT_DIR}/debug-rbac-02-after-submit.png` });
    console.log("  ✓ screenshot 02 saved (after submit)");

    // Check for toast / error message
    const bodyText = await page.locator('body').textContent();
    const errorMatch = bodyText?.match(/(Internal server error[^<]*|Error[^<]*)/i);
    if (errorMatch) {
      console.log(`  → ERROR MESSAGE FOUND: "${errorMatch[0]}"`);
    }
    if (bodyText?.toLowerCase().includes("internal server error")) {
      console.log("  → Internal server error CONFIRMED in body text");
    }
  }

  // Print all API responses involving /requests/
  console.log("\n=== API responses involving /requests/ ===");
  for (const r of apiResponses) {
    if (r.url.includes("/requests/") || r.url.endsWith("/requests")) {
      console.log(`  ${r.status} ${r.url}`);
      console.log(`    body: ${r.body.slice(0, 500)}`);
    }
  }

  console.log("\n=== Page errors captured ===");
  for (const e of errors) {
    console.log(`  ${e}`);
  }

  await browser.close();
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
