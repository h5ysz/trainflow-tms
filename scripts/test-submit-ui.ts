import { chromium } from "playwright";
const BASE = "http://localhost:3000";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Capture ALL API responses
  const apiCalls: { url: string; method: string; status: number; body: string }[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/")) {
      console.log(`  → REQUEST: ${req.method()} ${req.url()}`);
    }
  });
  page.on("response", async (res) => {
    if (res.url().includes("/api/")) {
      let body = "";
      try { body = await res.text(); } catch {}
      apiCalls.push({ url: res.url(), method: res.request().method(), status: res.status(), body: body.slice(0, 500) });
      console.log(`  ← RESPONSE: [${res.status()}] ${res.request().method()} ${res.url()}`);
      if (res.status() >= 400) {
        console.log(`     BODY: ${body.slice(0, 300)}`);
      }
    }
  });

  // Capture console errors
  page.on("console", (msg) => {
    if (msg.type() === "error") console.log(`  ⚠️ CONSOLE ERROR: ${msg.text()}`);
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

  console.log("\n→ Navigating to Training Requests…");
  const navTexts = await page.locator("a, button").allTextContents();
  const reqMatch = navTexts.findIndex((t) => /Training Requests/.test(t || ""));
  await page.locator("a, button").nth(reqMatch).click();
  await page.waitForTimeout(3000);

  console.log("\n→ Clicking Submit button on DRAFT request…");
  const allBtns = page.locator('button');
  const btnCount = await allBtns.count();
  for (let i = 0; i < btnCount; i++) {
    const text = ((await allBtns.nth(i).textContent()) || '').trim();
    if (/^Submit$/.test(text)) {
      await allBtns.nth(i).click();
      console.log(`  ✓ Clicked Submit at index ${i}`);
      break;
    }
  }
  await page.waitForTimeout(5000);

  // Check for toast messages
  const toasts = await page.locator('[data-sonner-toast]').allTextContents();
  console.log(`\n→ Toast messages visible: ${toasts.length}`);
  for (const toast of toasts) {
    console.log(`   • ${toast}`);
  }

  // Also check for any text containing "error" or "Error"
  const bodyText = await page.locator('body').textContent();
  const errorMatches = bodyText?.match(/(Internal server error[^<]{0,100})/gi);
  if (errorMatches) {
    console.log(`\n→ 'Internal server error' found in body: ${errorMatches.length} time(s)`);
  } else {
    console.log(`\n→ No 'Internal server error' text found in body`);
  }

  await page.screenshot({ path: "/home/z/my-project/download/screenshots/submit-test-after-click.png" });

  await browser.close();
}
main().catch(e => { console.error("❌", e); process.exit(1); });
