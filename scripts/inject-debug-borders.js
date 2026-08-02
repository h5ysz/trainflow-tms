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
  await page.waitForTimeout(3000);
  
  // Inject debug borders with labels
  await page.evaluate(() => {
    const colors = [
      { name: 'AppShell-root', color: 'red' },
      { name: 'Sidebar', color: 'blue' },
      { name: 'Main-flex-col', color: 'green' },
      { name: 'Main-element', color: 'orange' },
      { name: 'MainContent-wrapper', color: 'purple' },
      { name: 'PageContainer-space-y-5', color: 'cyan' },
      { name: 'PageHeader', color: 'pink' },
      { name: 'DataTable-wrapper', color: 'brown' },
      { name: 'DataTable-search', color: 'lime' },
      { name: 'DataTable-card', color: 'magenta' },
      { name: 'DataTable-table-overflow', color: 'teal' },
    ];
    
    function addDebug(el, color, label) {
      if (!el) return;
      el.style.outline = `3px solid ${color}`;
      el.style.outlineOffset = '-3px';
      el.style.position = 'relative';
      
      const badge = document.createElement('div');
      badge.style.cssText = `
        position: absolute; top: 0; left: 0; z-index: 99999;
        background: ${color}; color: white; font-size: 10px;
        padding: 1px 4px; font-family: monospace; pointer-events: none;
        white-space: nowrap;
      `;
      badge.textContent = `${label} | L=${Math.round(el.getBoundingClientRect().left)} W=${Math.round(el.getBoundingClientRect().width)}`;
      el.appendChild(badge);
    }
    
    // AppShell root
    addDebug(document.querySelector('.flex.h-screen'), 'red', 'AppShell-root');
    // Sidebar
    addDebug(document.querySelector('.w-64.shrink-0'), 'blue', 'Sidebar');
    // Main flex-col
    addDebug(document.querySelector('.flex.flex-1.flex-col'), 'green', 'Main-flex-col');
    // Main element
    addDebug(document.querySelector('main'), 'orange', 'Main');
    // MainContent wrapper
    addDebug(document.querySelector('main > div'), 'purple', 'MainContent');
    // PageContainer
    addDebug(document.querySelector('.space-y-5'), 'cyan', 'PageContainer');
    // PageHeader
    addDebug(document.querySelector('.flex.flex-col.gap-3'), 'pink', 'PageHeader');
    // DataTable wrapper
    addDebug(document.querySelector('.space-y-3'), 'brown', 'DataTable');
    // DataTable search
    addDebug(document.querySelector('.flex.items-center.gap-2'), 'lime', 'Search');
    // DataTable card
    addDebug(document.querySelector('.rounded-lg.border.bg-card'), 'magenta', 'TableCard');
    // Table overflow
    addDebug(document.querySelector('.overflow-x-auto'), 'teal', 'TableOverflow');
  });
  
  await page.screenshot({ path: '/tmp/debug-colored-borders.png', fullPage: false });
  console.log('Screenshot saved');
  
  await browser.close();
})();
