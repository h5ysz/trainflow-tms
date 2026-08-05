// Find horizontal overflow element — log in as contractor, fetch requests page,
// then use a headless approach to identify which element causes scrollWidth > clientWidth.
//
// Strategy: since we can't keep a long-running browser session (dev server keeps dying),
// we'll fetch the rendered HTML + CSS, then statically analyze the layout for known
// overflow patterns. We'll also check the live DOM via a one-shot Playwright-like
// evaluation using the agent-browser's eval command if the server stays up long enough.

const http = require('http');

const BASE = 'http://localhost:3000';

function fetch(path, opts = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${BASE}${path}`, opts, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
  });
}

function post(path, data, cookie) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(data);
    const req = http.request(
      `${BASE}${path}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: b }));
      }
    );
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    req.write(body);
    req.end();
  });
}

(async () => {
  // 1. Log in as contractor
  console.log('→ Logging in as contractor...');
  const loginRes = await post('/api/auth/login', {
    email: 'contractor@gcclab.com',
    password: 'Demo@1234',
  });
  console.log(`  Login status: ${loginRes.status}`);
  const setCookie = loginRes.headers['set-cookie'] || [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  console.log(`  Cookie: ${cookie.substring(0, 60)}...`);

  if (loginRes.status !== 200) {
    console.error('Login failed:', loginRes.body);
    process.exit(1);
  }

  // 2. Fetch the main page (it's a client-rendered SPA, so HTML is just the shell)
  console.log('\n→ Fetching main page HTML...');
  const pageRes = await fetch('/', { headers: { Cookie: cookie } });
  console.log(`  Page status: ${pageRes.status}, size: ${pageRes.body.length}`);

  // 3. Fetch the requests API to see what data is rendered
  console.log('\n→ Fetching /api/requests...');
  const reqRes = await fetch('/api/requests?page=1&pageSize=10', { headers: { Cookie: cookie } });
  console.log(`  Requests status: ${reqRes.status}`);
  if (reqRes.status === 200) {
    const data = JSON.parse(reqRes.body);
    console.log(`  Got ${data.rows?.length || 0} requests`);
    if (data.rows?.[0]) {
      console.log(`  First request: refNumber=${data.rows[0].refNumber}, courseTitle=${data.rows[0].courseTitle}`);
    }
  }

  // 4. Fetch the me endpoint to confirm auth
  console.log('\n→ Fetching /api/auth/me...');
  const meRes = await fetch('/api/auth/me', { headers: { Cookie: cookie } });
  console.log(`  Me status: ${meRes.status}`);
  if (meRes.status === 200) {
    const me = JSON.parse(meRes.body);
    console.log(`  User: ${me.email} (${me.role}), companyId: ${me.companyId || 'none'}`);
  }

  console.log('\n✓ Done. The page is a client-rendered SPA — HTML alone won\'t reveal the overflow.');
  console.log('  Need to use a real browser (agent-browser) to evaluate document.documentElement.scrollWidth');
})().catch((e) => {
  console.error('Error:', e.message);
  process.exit(1);
});
