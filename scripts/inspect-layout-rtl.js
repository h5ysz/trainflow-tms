const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  // Login
  await page.goto('http://localhost:3000/');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', 'contractor@gcclab.com');
  await page.fill('input[type="password"]', 'Demo@1234');
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('http://localhost:3000/', { timeout: 10000 });
  await page.waitForTimeout(2000);
  
  // Switch to Arabic
  const langBtn = await page.$('button:has-text("ع")');
  if (langBtn) await langBtn.click();
  await page.waitForTimeout(1000);
  
  // Navigate to training requests
  const navItem = await page.$('text=طلبات التدريب');
  if (navItem) await navItem.click();
  await page.waitForTimeout(2000);
  
  // Take a screenshot
  await page.screenshot({ path: '/tmp/layout-rtl.png', fullPage: false });
  
  // Inspect the DOM
  const layoutInfo = await page.evaluate(() => {
    const html = document.documentElement;
    const sidebar = document.querySelector('aside, [class*="sidebar"]')?.getBoundingClientRect();
    const main = document.querySelector('main')?.getBoundingClientRect();
    const mainChild = document.querySelector('main > div')?.getBoundingClientRect();
    const pageContent = document.querySelector('main > div > div')?.getBoundingClientRect();
    
    return {
      dir: html.dir,
      viewport: { w: window.innerWidth },
      sidebar: sidebar ? { left: sidebar.left, width: sidebar.width, right: sidebar.right } : null,
      main: main ? { left: main.left, width: main.width } : null,
      mainChild: mainChild ? { left: mainChild.left, width: mainChild.width } : null,
      pageContent: pageContent ? { left: pageContent.left, width: pageContent.width } : null,
    };
  });
  
  console.log(JSON.stringify(layoutInfo, null, 2));
  await browser.close();
})();
