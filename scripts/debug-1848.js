const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1848, height: 1042 } });
  await page.goto('http://localhost:3000/');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', 'contractor@gcclab.com');
  await page.fill('input[type="password"]', 'Demo@1234');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(3000);
  const navItem = await page.$('text=Training Requests');
  if (navItem) await navItem.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: '/tmp/debug-1848.png' });
  
  const info = await page.evaluate(() => {
    const sidebar = document.querySelector('[class*="w-64"]')?.getBoundingClientRect();
    const content = document.querySelector('main > div > div')?.getBoundingClientRect();
    return {
      sidebarRight: sidebar?.right,
      contentLeft: content?.left,
      gap: content && sidebar ? content.left - sidebar.right : null,
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
