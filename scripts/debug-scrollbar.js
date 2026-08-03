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
  await page.waitForTimeout(5000);
  
  // Check for scrollbars
  const scrollInfo = await page.evaluate(() => {
    const main = document.querySelector('main');
    const tableWrap = document.querySelector('.overflow-x-auto');
    const body = document.body;
    
    return {
      bodyScrollWidth: body.scrollWidth,
      bodyClientWidth: body.clientWidth,
      bodyOverflowX: window.getComputedStyle(body).overflowX,
      mainScrollWidth: main?.scrollWidth,
      mainClientWidth: main?.clientWidth,
      mainOverflowX: main ? window.getComputedStyle(main).overflowX : null,
      tableScrollWidth: tableWrap?.scrollWidth,
      tableClientWidth: tableWrap?.clientWidth,
      tableOverflow: tableWrap ? window.getComputedStyle(tableWrap).overflow : null,
      hasHorizontalScrollbar: main ? main.scrollWidth > main.clientWidth : false,
      scrollbarWidth: main ? main.scrollWidth - main.clientWidth : 0,
    };
  });
  
  console.log('=== SCROLLBAR INFO ===');
  console.log(JSON.stringify(scrollInfo, null, 2));
  
  // Check body padding-right (Radix scroll lock adds this)
  const bodyPadding = await page.evaluate(() => {
    return {
      paddingRight: window.getComputedStyle(document.body).paddingRight,
      marginLeft: window.getComputedStyle(document.body).marginLeft,
      overflow: document.body.style.overflow,
    };
  });
  console.log('\n=== BODY STYLES ===');
  console.log(JSON.stringify(bodyPadding, null, 2));
  
  await browser.close();
})();
