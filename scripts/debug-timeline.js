const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1848, height: 1042 } });
  
  await page.goto('http://localhost:3000/');
  await page.waitForSelector('input[type="email"]', { timeout: 10000 });
  await page.fill('input[type="email"]', 'contractor@gcclab.com');
  await page.fill('input[type="password"]', 'Demo@1234');
  
  // Capture DOM state at multiple points
  const snapshots = [];
  
  // Start listening for DOM changes BEFORE clicking sign in
  await page.evaluate(() => {
    window.__layoutSnapshots = [];
    
    const captureSnapshot = (label) => {
      const main = document.querySelector('main');
      if (!main) return;
      const mainChild = main.firstElementChild;
      if (!mainChild) return;
      const content = mainChild.firstElementChild;
      
      window.__layoutSnapshots.push({
        label,
        time: Date.now(),
        mainChildClass: mainChild.className,
        mainChildLeft: mainChild.getBoundingClientRect().left,
        contentLeft: content ? content.getBoundingClientRect().left : null,
        contentWidth: content ? content.getBoundingClientRect().width : null,
        // Check ALL ancestor classes
        bodyClass: document.body.className,
        htmlDir: document.documentElement.dir,
        // Check for any dialog/overlay that might be open
        hasOpenDialog: !!document.querySelector('[data-state="open"]'),
        openDialogs: Array.from(document.querySelectorAll('[data-state="open"]')).map(el => ({
          tag: el.tagName,
          class: el.className?.substring(0, 60),
          role: el.getAttribute('role'),
        })),
      });
    };
    
    // Capture every 100ms for 10 seconds
    let count = 0;
    const interval = setInterval(() => {
      captureSnapshot(`tick_${count}`);
      count++;
      if (count > 100) clearInterval(interval);
    }, 100);
    
    // Also capture on DOM mutations
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
          captureSnapshot(`mutation_class_${mutation.target.tagName}_${mutation.target.className?.substring(0, 30)}`);
        }
        if (mutation.type === 'childList') {
          captureSnapshot(`mutation_childList`);
        }
      }
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'dir'],
    });
    
    window.__mutationObserver = observer;
  });
  
  // Click sign in
  await page.click('button:has-text("Sign in")');
  
  // Wait for navigation
  await page.waitForTimeout(5000);
  
  // Click Training Requests
  const navItem = await page.$('text=Training Requests');
  if (navItem) await navItem.click();
  
  // Wait for data to load
  await page.waitForTimeout(5000);
  
  // Get all snapshots
  const result = await page.evaluate(() => {
    window.__mutationObserver?.disconnect();
    return window.__layoutSnapshots || [];
  });
  
  // Find snapshots where the layout CHANGED
  console.log(`\n=== Total snapshots: ${result.length} ===`);
  
  let prevLeft = null;
  let prevClass = null;
  const changes = [];
  
  for (const snap of result) {
    if (snap.contentLeft !== null) {
      if (prevLeft !== null && snap.contentLeft !== prevLeft) {
        changes.push({
          label: snap.label,
          time: snap.time,
          contentLeft: snap.contentLeft,
          prevLeft: prevLeft,
          mainChildClass: snap.mainChildClass,
          hasOpenDialog: snap.hasOpenDialog,
          openDialogs: snap.openDialogs,
        });
      }
      prevLeft = snap.contentLeft;
    }
    
    if (snap.mainChildClass !== prevClass) {
      if (prevClass !== null) {
        changes.push({
          label: snap.label,
          type: 'class_change',
          newClass: snap.mainChildClass,
          oldClass: prevClass,
          hasOpenDialog: snap.hasOpenDialog,
          openDialogs: snap.openDialogs,
        });
      }
      prevClass = snap.mainChildClass;
    }
  }
  
  console.log(`\n=== LAYOUT CHANGES DETECTED: ${changes.length} ===`);
  changes.forEach((c, i) => {
    console.log(`\n--- Change ${i + 1} ---`);
    console.log(JSON.stringify(c, null, 2));
  });
  
  // Also print first and last snapshot
  const firstWithContent = result.find(s => s.contentLeft !== null);
  const lastWithContent = [...result].reverse().find(s => s.contentLeft !== null);
  
  console.log('\n=== FIRST snapshot with content ===');
  console.log(JSON.stringify(firstWithContent, null, 2));
  console.log('\n=== LAST snapshot with content ===');
  console.log(JSON.stringify(lastWithContent, null, 2));
  
  await page.screenshot({ path: '/tmp/debug-timeline-final.png' });
  
  await browser.close();
})();
