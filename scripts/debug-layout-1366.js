const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  // Test at 1366x768 (common laptop)
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
  
  await page.goto('http://localhost:3000/');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', 'contractor@gcclab.com');
  await page.fill('input[type="password"]', 'Demo@1234');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(3000);
  
  const navItem = await page.$('text=Training Requests');
  if (navItem) await navItem.click();
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: '/tmp/debug-1366.png' });
  
  const info = await page.evaluate(() => {
    const sidebar = document.querySelector('[class*="w-64"]')?.getBoundingClientRect();
    const main = document.querySelector('main')?.getBoundingClientRect();
    const mainChild = document.querySelector('main > div')?.getBoundingClientRect();
    const content = document.querySelector('main > div > div')?.getBoundingClientRect();
    const tableCard = document.querySelector('main .rounded-lg.border')?.getBoundingClientRect();
    const computed = document.querySelector('main > div') ? window.getComputedStyle(document.querySelector('main > div')) : null;
    
    return {
      viewport: { w: window.innerWidth, h: window.innerHeight },
      dir: document.documentElement.dir,
      sidebar: sidebar ? { left: sidebar.left, right: sidebar.right, width: sidebar.width } : null,
      main: main ? { left: main.left, right: main.right, width: main.width } : null,
      mainChild: mainChild ? { left: mainChild.left, right: mainChild.right, width: mainChild.width, class: document.querySelector('main > div')?.className } : null,
      content: content ? { left: content.left, right: content.right, width: content.width } : null,
      tableCard: tableCard ? { left: tableCard.left, right: tableCard.right, width: tableCard.width } : null,
      paddingLeft: computed?.paddingLeft,
      paddingRight: computed?.paddingRight,
      marginLeft: computed?.marginLeft,
      marginRight: computed?.marginRight,
    };
  });
  
  console.log(JSON.stringify(info, null, 2));
  
  // Also test at 1536x864 (common laptop)
  await page.setViewportSize({ width: 1536, height: 864 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/debug-1536.png' });
  
  const info2 = await page.evaluate(() => {
    const sidebar = document.querySelector('[class*="w-64"]')?.getBoundingClientRect();
    const content = document.querySelector('main > div > div')?.getBoundingClientRect();
    return {
      viewport: { w: window.innerWidth },
      sidebar: sidebar ? { right: sidebar.right } : null,
      content: content ? { left: content.left } : null,
      gap: content && sidebar ? content.left - sidebar.right : null,
    };
  });
  console.log('\n1536px:', JSON.stringify(info2, null, 2));
  
  await browser.close();
})();
