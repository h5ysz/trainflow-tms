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
  
  // Navigate to training requests
  // The app uses a router, not URL changes — click the sidebar item
  const navItem = await page.$('text=Training Requests');
  if (navItem) await navItem.click();
  await page.waitForTimeout(2000);
  
  // Take a screenshot
  await page.screenshot({ path: '/tmp/layout-inspection.png', fullPage: false });
  
  // Inspect the DOM structure
  const layoutInfo = await page.evaluate(() => {
    const sidebar = document.querySelector('aside, [class*="sidebar"]')?.getBoundingClientRect();
    const main = document.querySelector('main')?.getBoundingClientRect();
    const mainChild = document.querySelector('main > div')?.getBoundingClientRect();
    const pageContent = document.querySelector('main > div > div')?.getBoundingClientRect();
    
    // Find all direct children of main and their positions
    const mainChildren = Array.from(document.querySelector('main')?.children || []).map(el => ({
      tag: el.tagName,
      class: el.className?.substring(0, 80),
      rect: el.getBoundingClientRect(),
    }));
    
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      sidebar: sidebar ? { left: sidebar.left, width: sidebar.width, right: sidebar.right } : null,
      main: main ? { left: main.left, width: main.width, right: main.right } : null,
      mainChild: mainChild ? { left: mainChild.left, width: mainChild.width, right: mainChild.right, class: document.querySelector('main > div')?.className } : null,
      pageContent: pageContent ? { left: pageContent.left, width: pageContent.width, class: document.querySelector('main > div > div')?.className?.substring(0, 80) } : null,
      mainChildren,
    };
  });
  
  console.log(JSON.stringify(layoutInfo, null, 2));
  
  await browser.close();
})();
