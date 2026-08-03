const { chromium } = require('playwright');

async function inspect(browser, switchToAr) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  await page.goto('http://localhost:3000/');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', 'admin@gcclab.com');
  await page.fill('input[type="password"]', 'ChangeMeInProduction!2024');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(3000);
  
  if (switchToAr) {
    // Click the "EN" button to switch to Arabic
    await page.click('button:has-text("EN")');
    await page.waitForTimeout(2000);
  }
  
  // Navigate to training requests
  const navText = switchToAr ? 'طلبات التدريب' : 'Training Requests';
  const navItem = await page.$(`text=${navText}`);
  if (navItem) await navItem.click();
  await page.waitForTimeout(2000);
  
  await page.screenshot({ path: `/tmp/compare-${switchToAr ? 'ar' : 'en'}.png` });
  
  const info = await page.evaluate(() => {
    const html = document.documentElement;
    
    // Get ALL elements in the main content area and check for large margins
    const main = document.querySelector('main');
    const allElements = main ? Array.from(main.querySelectorAll('*')).slice(0, 30).map(el => {
      const rect = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);
      return {
        tag: el.tagName,
        class: el.className?.toString().substring(0, 50),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        marginLeft: computed.marginLeft,
        marginRight: computed.marginRight,
        paddingLeft: computed.paddingLeft,
        paddingRight: computed.paddingRight,
      };
    }) : [];
    
    return {
      dir: html.dir,
      elements: allElements,
    };
  });
  
  console.log(`\n=== ${switchToAr ? 'ARABIC' : 'ENGLISH'} (dir=${info.dir}) ===`);
  // Print first 15 elements
  info.elements.slice(0, 15).forEach((e, i) => {
    console.log(`  [${i}] <${e.tag}> class="${e.class}" left=${e.left} w=${e.width} ml=${e.marginLeft} mr=${e.marginRight} pl=${e.paddingLeft} pr=${e.paddingRight}`);
  });
  
  await page.close();
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  await inspect(browser, false); // English
  await inspect(browser, true);  // Arabic
  await browser.close();
})();
