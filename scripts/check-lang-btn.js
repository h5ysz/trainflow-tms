const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  await page.goto('http://localhost:3000/');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', 'admin@gcclab.com');
  await page.fill('input[type="password"]', 'ChangeMeInProduction!2024');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(3000);
  
  // Find all buttons in the topbar
  const buttons = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('header button')).map(b => ({
      text: b.textContent?.trim(),
      class: b.className?.substring(0, 60),
      ariaLabel: b.getAttribute('aria-label'),
    }));
  });
  console.log('Topbar buttons:', JSON.stringify(buttons, null, 2));
  
  // Check the html dir
  const dir = await page.evaluate(() => document.documentElement.dir);
  console.log('Current dir:', dir);
  
  await browser.close();
})();
