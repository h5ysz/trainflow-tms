#!/usr/bin/env python3
"""
Check horizontal overflow — pre-set the session cookie via API,
then open the page with the cookie already in place.
"""

import json
import sys
import time
import urllib.request
import urllib.parse
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"

def login_and_get_cookie():
    """Login via HTTP API and return the session cookie value."""
    data = json.dumps({"email": "coordinator@gcclab.com", "password": "Demo@1234"}).encode()
    req = urllib.request.Request(
        f"{BASE}/api/auth/login",
        data=data,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        body = json.loads(resp.read())
        # Extract cookie from Set-Cookie header
        cookie_header = resp.headers.get("Set-Cookie", "")
        # Parse tf_session=... from the header
        for part in cookie_header.split(";"):
            part = part.strip()
            if part.startswith("tf_session="):
                return part[len("tf_session="):]
    return None

def check_viewport(page, viewport_name):
    """Run overflow checks on the current page."""
    result = page.evaluate("""
        () => {
            const docEl = document.documentElement;
            const scrollContainer = document.querySelector('.overflow-x-auto.tf-scroll');
            const table = document.querySelector('table');

            const cols = [];
            let colsTotal = 0;
            if (table) {
                table.querySelectorAll('thead th').forEach((th, i) => {
                    const w = Math.round(th.getBoundingClientRect().width);
                    const cs = window.getComputedStyle(th);
                    cols.push({
                        i,
                        text: (th.textContent || '').substring(0, 18).trim(),
                        w,
                        whiteSpace: cs.whiteSpace,
                    });
                    colsTotal += w;
                });
            }

            const rowHeights = [];
            if (table) {
                table.querySelectorAll('tbody tr').forEach((tr, i) => {
                    if (i < 3) rowHeights.push(Math.round(tr.getBoundingClientRect().height));
                });
            }

            const firstRow = document.querySelector('table tbody tr');
            let companyCell = null, courseCell = null, traineeHeader = null;
            if (firstRow) {
                const cells = firstRow.querySelectorAll('td');
                if (cells[2]) {
                    companyCell = {
                        className: cells[2].className,
                        whiteSpace: window.getComputedStyle(cells[2]).whiteSpace,
                    };
                }
                if (cells[3]) {
                    courseCell = {
                        className: cells[3].className,
                        whiteSpace: window.getComputedStyle(cells[3]).whiteSpace,
                    };
                }
            }
            // Check trainee count header
            const ths = document.querySelectorAll('table thead th');
            if (ths[4]) {
                traineeHeader = {
                    text: ths[4].textContent.trim(),
                    whiteSpace: window.getComputedStyle(ths[4]).whiteSpace,
                };
            }

            return {
                page: {
                    scrollWidth: docEl.scrollWidth,
                    clientWidth: docEl.clientWidth,
                    match: docEl.scrollWidth === docEl.clientWidth,
                },
                table: {
                    scrollWidth: scrollContainer ? scrollContainer.scrollWidth : null,
                    clientWidth: scrollContainer ? scrollContainer.clientWidth : null,
                    overflow: scrollContainer ? scrollContainer.scrollWidth - scrollContainer.clientWidth : null,
                    scrollbarGone: scrollContainer ? scrollContainer.scrollWidth <= scrollContainer.clientWidth : null,
                },
                columns: cols,
                columnsTotal: colsTotal,
                rowHeights: rowHeights,
                companyCell: companyCell,
                courseCell: courseCell,
                traineeHeader: traineeHeader,
            };
        }
    """)
    print(f"\n{'='*60}")
    print(f"  VIEWPORT: {viewport_name}")
    print(f"{'='*60}")
    print(f"  Page: scrollWidth={result['page']['scrollWidth']}, clientWidth={result['page']['clientWidth']}, match={result['page']['match']}")
    print(f"  Table: scrollWidth={result['table']['scrollWidth']}, clientWidth={result['table']['clientWidth']}, overflow={result['table']['overflow']}")
    print(f"  Table scrollbar gone: {result['table']['scrollbarGone']}")
    print(f"  Columns total: {result['columnsTotal']}px")
    print(f"  Row heights (first 3): {result['rowHeights']}")
    if result.get('companyCell'):
        print(f"  Company cell: whiteSpace={result['companyCell']['whiteSpace']}")
    if result.get('courseCell'):
        print(f"  Course cell: whiteSpace={result['courseCell']['whiteSpace']}")
    if result.get('traineeHeader'):
        print(f"  Trainee header: text='{result['traineeHeader']['text']}', whiteSpace={result['traineeHeader']['whiteSpace']}")
    print(f"  Column widths:")
    for c in result['columns']:
        print(f"    [{c['i']}] {c['text']:20s} w={c['w']:4d}px  ws={c['whiteSpace']}")

    page_ok = result['page']['match']
    table_ok = result['table']['scrollbarGone']
    print(f"\n  PAGE overflow: {'✅ PASS' if page_ok else '❌ FAIL'}")
    print(f"  TABLE scrollbar: {'✅ GONE' if table_ok else '❌ STILL PRESENT'}")
    return page_ok and table_ok


def main():
    # Step 1: Login via API to get the cookie
    print("→ Logging in as coordinator via API...")
    cookie = login_and_get_cookie()
    if not cookie:
        print("❌ Login failed")
        sys.exit(1)
    print(f"  Got session cookie ({len(cookie)} chars)")

    # Step 2: Launch Playwright with the cookie pre-set
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            ignore_https_errors=True,
        )
        # Set the cookie before navigating
        context.add_cookies([{
            "name": "tf_session",
            "value": cookie,
            "domain": "localhost",
            "path": "/",
            "httpOnly": False,
            "secure": False,
            "sameSite": "Lax",
        }])
        page = context.new_page()

        # Navigate to the app — should auto-login with the cookie
        print("→ Opening http://localhost:3000/ with pre-set cookie...")
        page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)

        # Check if we need to navigate to Training Requests
        print(f"→ Current URL: {page.url}")

        # Wait for the app to load
        try:
            page.wait_for_selector('button:has-text("Training Requests")', timeout=15000)
            print("→ Found 'Training Requests' button — clicking...")
            page.click('button:has-text("Training Requests")')
            page.wait_for_timeout(3000)
        except Exception as e:
            print(f"  Could not find Training Requests button: {e}")
            # Take a screenshot to see what's on screen
            page.screenshot(path="/home/z/my-project/download/debug-state.png")
            print("  Screenshot saved: /home/z/my-project/download/debug-state.png")
            browser.close()
            sys.exit(1)

        # Wait for the table to render
        try:
            page.wait_for_selector('table tbody tr', timeout=15000)
            print("→ Table loaded with data rows")
        except:
            print("  Table has no rows yet — waiting more...")
            page.wait_for_timeout(3000)

        # Test at 1280px
        page.set_viewport_size({"width": 1280, "height": 800})
        page.wait_for_timeout(1500)
        result_1280 = check_viewport(page, "1280px")
        page.screenshot(path="/home/z/my-project/download/overflow-check-1280.png", full_page=False)

        # Test at 1440px
        page.set_viewport_size({"width": 1440, "height": 900})
        page.wait_for_timeout(1500)
        result_1440 = check_viewport(page, "1440px")
        page.screenshot(path="/home/z/my-project/download/overflow-check-1440.png", full_page=False)

        browser.close()

        print(f"\n{'='*60}")
        print(f"  FINAL RESULT")
        print(f"{'='*60}")
        print(f"  1280px: {'✅ ALL CHECKS PASS' if result_1280 else '❌ FAIL'}")
        print(f"  1440px: {'✅ ALL CHECKS PASS' if result_1440 else '❌ FAIL'}")
        if result_1280 and result_1440:
            print("\n  ✅ Horizontal scrollbar eliminated at both viewports.")
            print("  ✅ document.documentElement.scrollWidth === clientWidth: TRUE")
            sys.exit(0)
        else:
            print("\n  ❌ Overflow still present — needs further fix.")
            sys.exit(1)


if __name__ == "__main__":
    main()
