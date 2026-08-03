const { chromium } = require('playwright');

async function inspect(browser, locale) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  await page.goto('http://localhost:3000/');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', 'admin@gcclab.com');
  await page.fill('input[type="password"]', 'ChangeMeInProduction!2024');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(3000);
  
  // Switch language if needed
  if (locale === 'ar') {
    const langBtn = await page.$('button:has-text("ع")');
    if (langBtn) { await langBtn.click(); await page.waitForTimeout(1000); }
  }
  
  // Navigate to training requests
  const navText = locale === 'ar' ? 'طلبات التدريب' : 'Training Requests';
  const navItem = await page.$(`text=${navText}`);
  if (navItem) await navItem.click();
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: `/tmp/compare-${locale}.png` });
  
  const info = await page.evaluate(() => {
    const html = document.documentElement;
    const sidebar = document.querySelector('[class*="w-64"]')?.getBoundingClientRect();
    const main = document.querySelector('main')?.getBoundingClientRect();
    const mainChild = document.querySelector('main > div')?.getBoundingClientRect();
    const content = document.querySelector('main > div > div')?.getBoundingClientRect();
    const tableWrap = document.querySelector('main .rounded-lg.border')?.getBoundingClientRect();
    
    // Check for any element with margin-left or margin-inline-start
    const mainDiv = document.querySelector('main > div');
    const computed = mainDiv ? window.getComputedStyle(mainDiv) : null;
    
    return {
      dir: html.dir,
      sidebar: sidebar ? { left: sidebar.left, right: sidebar.right, width: sidebar.width } : null,
      main: main ? { left: main.left, right: main.right, width: main.width } : null,
      mainChild: mainChild ? { left: mainChild.left, right: mainChild.right, width: mainChild.width, class: document.querySelector('main > div')?.className } : null,
      content: content ? { left: content.left, right: content.right, width: content.width, class: document.querySelector('main > div > div')?.className?.substring(0,60) } : null,
      tableWrap: tableWrap ? { left: tableWrap.left, right: tableWrap.right, width: tableWrap.width } : null,
      computedMarginLeft: computed?.marginLeft,
      computedMarginRight: computed?.marginRight,
      computedPaddingLeft: computed?.paddingLeft,
      computedPaddingRight: computed?.paddingRight,
    };
  });
  
  console.log(`\n=== ${locale.toUpperCase()} ===`);
  console.log(JSON.stringify(info, null, 2));
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  await inspect(browser, 'en');
  await inspect(browser, 'ar');
  await browser.close();
})();
