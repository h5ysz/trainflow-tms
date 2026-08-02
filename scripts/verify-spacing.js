const { chromium } = require('playwright');

async function screenshot(browser, width, height, label) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto('http://localhost:3000/');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', 'contractor@gcclab.com');
  await page.fill('input[type="password"]', 'Demo@1234');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(3000);
  const navItem = await page.$('text=Training Requests');
  if (navItem) await navItem.click();
  await page.waitForTimeout(2000);
  
  const info = await page.evaluate(() => {
    const sidebar = document.querySelector('[class*="w-64"]')?.getBoundingClientRect();
    const nav = document.querySelector('nav')?.getBoundingClientRect();
    const content = document.querySelector('main > div > div')?.getBoundingClientRect();
    const tableCard = document.querySelector('.rounded-lg.border.bg-card')?.getBoundingClientRect();
    
    // Get the last visible nav item's right edge
    const navItems = document.querySelectorAll('nav li button');
    let lastItemRight = 0;
    navItems.forEach(item => {
      const rect = item.getBoundingClientRect();
      if (rect.right > lastItemRight) lastItemRight = rect.right;
    });
    
    return {
      sidebarRight: Math.round(sidebar?.right || 0),
      navRight: Math.round(nav?.right || 0),
      lastItemRight: Math.round(lastItemRight),
      contentLeft: Math.round(content?.left || 0),
      tableLeft: Math.round(tableCard?.left || 0),
      gapFromSidebarBorder: Math.round((content?.left || 0) - (sidebar?.right || 0)),
      gapFromLastItem: Math.round((content?.left || 0) - lastItemRight),
    };
  });
  
  await page.screenshot({ path: `/tmp/verify-${label}.png` });
  console.log(`\n=== ${label} (${width}x${height}) ===`);
  console.log(JSON.stringify(info, null, 2));
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  await screenshot(browser, 1920, 1080, '1920');
  await screenshot(browser, 2560, 1440, '2560');
  await browser.close();
})();
