const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  await page.goto('http://localhost:3000/');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', 'contractor@gcclab.com');
  await page.fill('input[type="password"]', 'Demo@1234');
  await page.click('button:has-text("Sign in")');
  await page.waitForURL('http://localhost:3000/', { timeout: 10000 });
  await page.waitForTimeout(3000);
  
  // Take screenshot of landing page
  await page.screenshot({ path: '/tmp/contractor-landing.png' });
  
  // Check what route is active
  const routeInfo = await page.evaluate(() => {
    const main = document.querySelector('main');
    const mainChild = main?.firstElementChild;
    const pageContent = mainChild?.firstElementChild;
    
    // Get all visible text in the main area
    const mainText = main?.textContent?.substring(0, 200);
    
    return {
      mainHTML: mainChild?.outerHTML?.substring(0, 500),
      mainText,
      pageContentClass: pageContent?.className,
      pageContentRect: pageContent?.getBoundingClientRect(),
    };
  });
  
  console.log(JSON.stringify(routeInfo, null, 2));
  await browser.close();
})();
