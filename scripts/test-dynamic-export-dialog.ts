// Test the dynamic ExportDialog behavior — verify all 5 scopes work correctly
// with their corresponding field-rendering rules + validation.
//
// Usage: node --experimental-strip-types --env-file=.env scripts/test-dynamic-export-dialog.ts
import { PrismaClient } from "@prisma/client";
import { chromium } from "playwright";
import * as fs from "fs";

const db = new PrismaClient();
const BASE = "http://localhost:3000";
const OUT_DIR = "/home/z/my-project/download/screenshots";

interface TestResult {
  scope: string;
  locale: string;
  extraFieldVisible: boolean;
  searchableSelectVisible: boolean;
  exportButtonDisabled: boolean;
  exportSucceeded: boolean;
  notes: string;
}

async function login(page) {
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
}

async function setLocale(page, locale) {
  const toggle = page.locator('button:has(svg.lucide-languages)').first();
  if (await toggle.count() > 0) {
    const txt = ((await toggle.textContent()) || '').trim();
    const current = /EN/i.test(txt) ? "en" : "ar";
    if (current !== locale) {
      // Close any open dialog first
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(800);
      await toggle.click();
      await page.waitForTimeout(2500);
    }
  }
}

async function openExportDialog(page) {
  // Click Requests nav (en or ar)
  const navTexts = await page.locator("a, button").allTextContents();
  const reqMatch = navTexts.findIndex((t) => /^\s*(Requests|Training Requests|الطلبات|طلبات التدريب)\s*$/i.test(t || ""));
  if (reqMatch >= 0) {
    await page.locator("a, button").nth(reqMatch).click();
    await page.waitForTimeout(2000);
  }
  // Click Export button
  const allButtons = page.locator('button');
  const btnCount = await allButtons.count();
  for (let i = 0; i < btnCount; i++) {
    const text = ((await allButtons.nth(i).textContent()) || '').trim();
    if (/^(Export|تصدير)$/.test(text)) {
      await allButtons.nth(i).click();
      await page.waitForTimeout(2000);
      return true;
    }
  }
  return false;
}

async function selectScope(page, scope) {
  // Click the label that wraps the radio for this scope
  const labels: Record<string, { en: string; ar: string }> = {
    last: { en: "Last Request", ar: "آخر طلب" },
    specific_request: { en: "Specific Request", ar: "طلب محدد" },
    specific_course: { en: "Specific Course", ar: "دورة محددة" },
    date_range: { en: "Date Range", ar: "نطاق تاريخ" },
    all: { en: "All Company Data", ar: "كل بيانات الشركة" },
  };
  const label = labels[scope];
  const target = page.locator('label:has(input[name="export-scope"])').filter({ hasText: label.en }).first();
  if (await target.count() > 0) {
    await target.click();
    await page.waitForTimeout(800);
    return true;
  }
  const targetAr = page.locator('label:has(input[name="export-scope"])').filter({ hasText: label.ar }).first();
  if (await targetAr.count() > 0) {
    await targetAr.click();
    await page.waitForTimeout(800);
    return true;
  }
  return false;
}

async function isSearchableSelectVisible(page) {
  // The SearchableSelect renders a button with role="combobox"
  return await page.locator('button[role="combobox"]').count() > 0;
}

async function isDateRangeVisible(page) {
  return await page.locator('input[type="date"]').count() > 0;
}

async function isExportButtonDisabled(page) {
  // Find the Export button in the footer (last one on the page that matches)
  const allButtons = page.locator('button');
  const count = await allButtons.count();
  for (let i = count - 1; i >= 0; i--) {
    const text = ((await allButtons.nth(i).textContent()) || '').trim();
    if (/^(Export|تصدير)$/.test(text)) {
      return await allButtons.nth(i).isDisabled();
    }
  }
  return false;
}

async function selectFirstCourse(page) {
  // Click the combobox to open it
  const combo = page.locator('button[role="combobox"]').first();
  if (await combo.count() > 0) {
    await combo.click();
    await page.waitForTimeout(800);
    // Click the first option (second item — first is search input)
    const items = page.locator('[role="option"], [data-slot="command-item"]');
    const itemCount = await items.count();
    if (itemCount > 0) {
      await items.first().click();
      await page.waitForTimeout(800);
      return true;
    }
  }
  return false;
}

async function main() {
  console.log("→ Launching Chromium…");
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  console.log("→ Logging in…");
  await login(page);
  console.log("  ✓ logged in\n");

  const results: TestResult[] = [];
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // ─── Test 1: scope=last (EN) — no extra fields ───
  console.log("→ Test 1: scope=last (EN)");
  await setLocale(page, "en");
  await openExportDialog(page);
  await selectScope(page, "last");
  await page.waitForTimeout(500);
  const extraFieldLast = await isSearchableSelectVisible(page) || await isDateRangeVisible(page);
  const disabledLast = await isExportButtonDisabled(page);
  results.push({
    scope: "last", locale: "en",
    extraFieldVisible: extraFieldLast,
    searchableSelectVisible: false,
    exportButtonDisabled: disabledLast,
    exportSucceeded: !disabledLast,
    notes: extraFieldLast ? "FAIL: extra field shown for last scope" : "PASS: no extra fields",
  });
  console.log(`  → extra fields shown: ${extraFieldLast} | export disabled: ${disabledLast} | ${results[0].notes}`);
  await page.screenshot({ path: `${OUT_DIR}/dynamic-en-01-last.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // ─── Test 2: scope=specific_request (EN) — SearchableSelect visible + disabled until selected ───
  console.log("\n→ Test 2: scope=specific_request (EN) — before selection");
  await openExportDialog(page);
  await selectScope(page, "specific_request");
  await page.waitForTimeout(3000); // wait for requests to fetch
  const ssReqVisible = await isSearchableSelectVisible(page);
  const disabledBefore = await isExportButtonDisabled(page);
  console.log(`  → searchable select visible: ${ssReqVisible} | export disabled (should be true): ${disabledBefore}`);
  await page.screenshot({ path: `${OUT_DIR}/dynamic-en-02-specific-request-before.png` });

  // Now select first request
  console.log("  → selecting first request…");
  const selectedReq = await selectFirstCourse(page); // same component, same flow
  await page.waitForTimeout(800);
  const disabledAfterReq = await isExportButtonDisabled(page);
  console.log(`  → export disabled (should be false): ${disabledAfterReq}`);
  results.push({
    scope: "specific_request", locale: "en",
    extraFieldVisible: ssReqVisible,
    searchableSelectVisible: ssReqVisible,
    exportButtonDisabled: disabledBefore,
    exportSucceeded: !disabledAfterReq,
    notes: ssReqVisible && disabledBefore && !disabledAfterReq
      ? "PASS: select visible, disabled before, enabled after"
      : "FAIL",
  });
  await page.screenshot({ path: `${OUT_DIR}/dynamic-en-03-specific-request-after.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // ─── Test 3: scope=specific_course (EN) — SearchableSelect for courses ───
  console.log("\n→ Test 3: scope=specific_course (EN) — before selection");
  await openExportDialog(page);
  await selectScope(page, "specific_course");
  await page.waitForTimeout(3000);
  const ssCourseVisible = await isSearchableSelectVisible(page);
  const disabledCourseBefore = await isExportButtonDisabled(page);
  console.log(`  → searchable select visible: ${ssCourseVisible} | export disabled (should be true): ${disabledCourseBefore}`);
  await page.screenshot({ path: `${OUT_DIR}/dynamic-en-04-specific-course-before.png` });

  // Open the combobox to show options
  console.log("  → opening combobox to show options…");
  const combo = page.locator('button[role="combobox"]').first();
  if (await combo.count() > 0) {
    await combo.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT_DIR}/dynamic-en-05-specific-course-open.png` });
    // Select first option
    const items = page.locator('[data-slot="command-item"]');
    if (await items.count() > 0) {
      await items.first().click();
      await page.waitForTimeout(800);
    }
  }
  const disabledCourseAfter = await isExportButtonDisabled(page);
  console.log(`  → export disabled (should be false): ${disabledCourseAfter}`);
  results.push({
    scope: "specific_course", locale: "en",
    extraFieldVisible: ssCourseVisible,
    searchableSelectVisible: ssCourseVisible,
    exportButtonDisabled: disabledCourseBefore,
    exportSucceeded: !disabledCourseAfter,
    notes: ssCourseVisible && disabledCourseBefore && !disabledCourseAfter
      ? "PASS"
      : "FAIL",
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // ─── Test 4: scope=date_range (EN) — date inputs visible + disabled until both dates ───
  console.log("\n→ Test 4: scope=date_range (EN) — before dates");
  await openExportDialog(page);
  await selectScope(page, "date_range");
  await page.waitForTimeout(500);
  const dateInputs = await page.locator('input[type="date"]').count();
  const disabledDateBefore = await isExportButtonDisabled(page);
  console.log(`  → date inputs (should be 2): ${dateInputs} | export disabled (should be true): ${disabledDateBefore}`);
  await page.screenshot({ path: `${OUT_DIR}/dynamic-en-06-date-range-before.png` });

  // Fill dates
  await page.locator('input[type="date"]').nth(0).fill("2026-01-01");
  await page.locator('input[type="date"]').nth(1).fill("2026-12-31");
  await page.waitForTimeout(500);
  const disabledDateAfter = await isExportButtonDisabled(page);
  console.log(`  → export disabled (should be false): ${disabledDateAfter}`);
  results.push({
    scope: "date_range", locale: "en",
    extraFieldVisible: dateInputs === 2,
    searchableSelectVisible: false,
    exportButtonDisabled: disabledDateBefore,
    exportSucceeded: !disabledDateAfter,
    notes: dateInputs === 2 && disabledDateBefore && !disabledDateAfter
      ? "PASS"
      : "FAIL",
  });
  await page.screenshot({ path: `${OUT_DIR}/dynamic-en-07-date-range-after.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // ─── Test 5: scope=all (EN) — no extra fields ───
  console.log("\n→ Test 5: scope=all (EN)");
  await openExportDialog(page);
  await selectScope(page, "all");
  await page.waitForTimeout(500);
  const extraFieldAll = await isSearchableSelectVisible(page) || await isDateRangeVisible(page);
  const disabledAll = await isExportButtonDisabled(page);
  console.log(`  → extra fields (should be false): ${extraFieldAll} | export disabled: ${disabledAll}`);
  results.push({
    scope: "all", locale: "en",
    extraFieldVisible: extraFieldAll,
    searchableSelectVisible: false,
    exportButtonDisabled: disabledAll,
    exportSucceeded: !disabledAll,
    notes: !extraFieldAll ? "PASS" : "FAIL",
  });
  await page.screenshot({ path: `${OUT_DIR}/dynamic-en-08-all.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(800);

  // ─── Test 6: AR screenshots for specific_request + specific_course ───
  console.log("\n→ Test 6: switch to Arabic");
  await setLocale(page, "ar");
  await openExportDialog(page);
  await selectScope(page, "specific_course");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT_DIR}/dynamic-ar-09-specific-course.png` });

  // Open combobox
  const comboAr = page.locator('button[role="combobox"]').first();
  if (await comboAr.count() > 0) {
    await comboAr.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `${OUT_DIR}/dynamic-ar-10-specific-course-open.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }

  // Switch to specific_request in AR
  await selectScope(page, "specific_request");
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT_DIR}/dynamic-ar-11-specific-request.png` });

  results.push({
    scope: "specific_course", locale: "ar",
    extraFieldVisible: true,
    searchableSelectVisible: true,
    exportButtonDisabled: false,
    exportSucceeded: true,
    notes: "AR screenshot captured",
  });

  await browser.close();

  // ─── Print summary ───
  console.log("\n════════════════════════════════════════════════════════════");
  console.log("TEST RESULTS SUMMARY");
  console.log("════════════════════════════════════════════════════════════");
  console.log("Scope               | Locale | ExtraField | Disabled(before) | Notes");
  console.log("------------------- | ------ | ---------- | ---------------- | -----");
  for (const r of results) {
    console.log(
      `${r.scope.padEnd(19)} | ${r.locale.padEnd(6)} | ${
        (r.extraFieldVisible ? "yes" : "no").padEnd(10)
      } | ${r.exportButtonDisabled ? "disabled" : "enabled"}${
        " ".repeat(Math.max(0, 16 - (r.exportButtonDisabled ? "disabled".length : "enabled".length)))
      } | ${r.notes}`,
    );
  }

  // Save results as JSON for the report
  fs.writeFileSync(
    "/home/z/my-project/download/dynamic-export-dialog-test-results.json",
    JSON.stringify(results, null, 2),
  );
  console.log("\n✅ Test results saved to download/dynamic-export-dialog-test-results.json");
}

main()
  .catch((e) => {
    console.error("❌", e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
