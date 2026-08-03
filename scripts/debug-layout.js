const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  
  // Login as contractor
  await page.goto('http://localhost:3000/');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', 'contractor@gcclab.com');
  await page.fill('input[type="password"]', 'Demo@1234');
  await page.click('button:has-text("Sign in")');
  await page.waitForTimeout(3000);
  
  // Make sure we're in English (LTR)
  const dir = await page.evaluate(() => document.documentElement.dir);
  console.log('dir:', dir);
  
  // We should be on Training Requests page already (from previous fix)
  // Click Training Requests if not
  const navItem = await page.$('text=Training Requests');
  if (navItem) await navItem.click();
  await page.waitForTimeout(2000);
  
  // Get EVERY element from sidebar to content, with full computed styles
  const debug = await page.evaluate(() => {
    const results = [];
    
    // Walk the DOM tree from the root flex container
    const root = document.querySelector('div.flex.h-screen');
    if (!root) return { error: 'No root flex container found' };
    
    function inspectElement(el, depth) {
      if (!el || depth > 6) return;
      const rect = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);
      const tag = el.tagName;
      const cls = el.className?.toString().substring(0, 80) || '';
      const id = el.id || '';
      
      // Only report elements wider than 10px and in the main content area (x > 250)
      // OR the sidebar itself
      if (rect.width > 10 && (rect.left < 260 || rect.left > 250)) {
        results.push({
          depth,
          tag,
          id,
          class: cls,
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          marginLeft: computed.marginLeft,
          marginRight: computed.marginRight,
          paddingLeft: computed.paddingLeft,
          paddingRight: computed.paddingRight,
          borderLeft: computed.borderLeftWidth,
          borderRight: computed.borderRightWidth,
          display: computed.display,
          flexDirection: computed.flexDirection,
          justifyContent: computed.justifyContent,
          alignItems: computed.alignItems,
        });
      }
      
      // Recurse into children
      for (const child of el.children) {
        inspectElement(child, depth + 1);
      }
    }
    
    inspectElement(root, 0);
    return results;
  });
  
  // Print all elements with their positions
  console.log('\n=== FULL DOM TREE WITH POSITIONS ===');
  debug.forEach((e, i) => {
    const indent = '  '.repeat(e.depth);
    console.log(`${indent}[${i}] <${e.tag}> ${e.id ? '#'+e.id : ''} class="${e.class}"`);
    console.log(`${indent}    pos: left=${e.left} top=${e.top} w=${e.width} h=${e.height}`);
    console.log(`${indent}    margin: L=${e.marginLeft} R=${e.marginRight} | padding: L=${e.paddingLeft} R=${e.paddingRight} | border: L=${e.borderLeft} R=${e.borderRight}`);
    console.log(`${indent}    display: ${e.display} flex: ${e.flexDirection} justify: ${e.justifyContent} align: ${e.alignItems}`);
  });
  
  // Now add RED BORDERS to all containers and take a screenshot
  await page.evaluate(() => {
    const main = document.querySelector('main');
    if (!main) return;
    
    function addRedBorder(el, depth) {
      if (!el || depth > 5) return;
      el.style.outline = `2px solid red`;
      el.style.outlineOffset = '-2px';
      
      // Add a label
      const label = document.createElement('div');
      label.style.cssText = 'position:absolute;font-size:9px;background:red;color:white;padding:1px 3px;z-index:9999;pointer-events:none;';
      label.textContent = `L${depth}:${el.tagName}.${el.className?.toString().substring(0,20)}`;
      el.style.position = el.style.position || 'relative';
      el.appendChild(label);
      
      for (const child of el.children) {
        addRedBorder(child, depth + 1);
      }
    }
    
    // Also border the sidebar
    const sidebar = document.querySelector('[class*="w-64"]');
    if (sidebar) {
      sidebar.style.outline = '2px solid blue';
      sidebar.style.outlineOffset = '-2px';
    }
    
    addRedBorder(main, 0);
  });
  
  await page.screenshot({ path: '/tmp/debug-red-borders.png', fullPage: false });
  console.log('\nScreenshot saved to /tmp/debug-red-borders.png');
  
  await browser.close();
})();
