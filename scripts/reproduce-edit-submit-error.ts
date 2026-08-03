// Reproduce the submit error from the EDIT dialog as a contractor.
// Hypothesis: contractor opens an existing DRAFT request for edit, changes status
// to SUBMITTED, clicks Save → frontend calls PUT /api/requests/[id] which
// requires `requests.edit` permission → 403 → frontend shows "Internal server error"
import { chromium } from "playwright";
import * as fs from "fs";

const BASE = "http://localhost:3000";
const OUT_DIR = "/home/z/my-project/download/screenshots";

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Capture API responses
  const apiResponses: { url: string; status: number; body: string }[] = [];
  page.on("response", async (res) => {
    const url = res.url();
    if (url.includes("/api/")) {
      let body = "";
      try { body = await res.text(); } catch {}
      apiResponses.push({ url, status: res.status(), body: body.slice(0, 1000) });
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

  // Find the Edit (pencil) button on the DRAFT request
  console.log("→ Looking for Edit (pencil) button on DRAFT request row…");
  const editButtons = page.locator('button[title="Edit"]');
  const editCount = await editButtons.count();
  console.log(`  → Found ${editCount} Edit buttons`);

  if (editCount > 0) {
    // Click the first Edit button (the DRAFT row)
    await editButtons.first().click();
    await page.waitForTimeout(2000);
    console.log("  ✓ Edit dialog opened");

    // Take screenshot of dialog
    await page.screenshot({ path: `${OUT_DIR}/debug-rbac-edit-dialog.png` });

    // Find the Status select dropdown
    const statusSelect = page.locator('select').filter({ hasText: /Draft|Submit/ }).first();
    if (await statusSelect.count() > 0) {
      console.log("  → Changing status to SUBMITTED in dropdown…");
      await statusSelect.selectOption("SUBMITTED");
      await page.waitForTimeout(500);
    }

    // Find the Save/Submit button in the dialog
    const saveButtons = page.locator('button');
    const saveCount = await saveButtons.count();
    let saveBtn = null;
    for (let i = 0; i < saveCount; i++) {
      const text = ((await saveButtons.nth(i).textContent()) || '').trim();
      // Look for save/submit/create button (not the cancel)
      if (/^(Save|Submit|Update|Create|حفظ|إرسال|تحديث)$/i.test(text)) {
        saveBtn = saveButtons.nth(i);
        console.log(`  → Found Save button: "${text}"`);
        break;
      }
    }

    if (saveBtn) {
      console.log("  → Clicking Save…");
      await saveBtn.click();
      await page.waitForTimeout(3000);
      await page.screenshot({ path: `${OUT_DIR}/debug-rbac-after-edit-save.png` });
      console.log("  ✓ screenshot saved (after edit save)");
    }
  }

  // Print API responses involving /requests/
  console.log("\n=== API responses (focus on /requests/) ===");
  for (const r of apiResponses) {
    if (r.url.includes("/requests/") || r.url.endsWith("/requests")) {
      console.log(`  [${r.status}] ${r.url}`);
      if (r.status >= 400) {
        console.log(`       body: ${r.body}`);
      }
    }
  }

  await browser.close();
}

main().catch((e) => { console.error("❌", e); process.exit(1); });
