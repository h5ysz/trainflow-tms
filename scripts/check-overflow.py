#!/usr/bin/env python3
"""
Check horizontal overflow on Training Requests page at 1280px and 1440px.
Uses Playwright (Python) to avoid the agent-browser proxy issue.

Strategy:
1. Start with the already-running dev server (or we start one)
2. Launch Playwright browser
3. Login as coordinator
4. Navigate to Training Requests
5. Check: document.documentElement.scrollWidth === clientWidth
6. Check: table's overflow-x-auto container has scrollWidth === clientWidth
7. Report column widths
"""

import json
import sys
import time
import subprocess
import os
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
COORDINATOR = {"email": "coordinator@gcclab.com", "password": "Demo@1234"}

def check_viewport(page, viewport_name):
    """Run overflow checks on the current page."""
    result = page.evaluate("""
        () => {
            const docEl = document.documentElement;
            const body = document.body;
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

            // Check row heights (to see wrapping)
            const rowHeights = [];
            if (table) {
                table.querySelectorAll('tbody tr').forEach((tr, i) => {
                    if (i < 3) rowHeights.push(Math.round(tr.getBoundingClientRect().height));
                });
            }

            // Check company and course cell computed styles
            const firstRow = document.querySelector('table tbody tr');
            let companyCell = null, courseCell = null;
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
            };
        }
    """)
    print(f"\n{'='*60}")
    print(f"  VIEWPORT: {viewport_name}")
    print(f"{'='*60}")
    print(f"  Page: scrollWidth={result['page']['scrollWidth']}, clientWidth={result['page']['clientWidth']}, match={result['page']['match']}")
    print(f"  Table: scrollWidth={result['table']['scrollWidth']}, clientWidth={result['table']['clientWidth']}, overflow={result['table']['overflow']}, scrollbarGone={result['table']['scrollbarGone']}")
    print(f"  Columns total: {result['columnsTotal']}px")
    print(f"  Row heights (first 3): {result['rowHeights']}")
    if result.get('companyCell'):
        print(f"  Company cell whiteSpace: {result['companyCell']['whiteSpace']}")
    if result.get('courseCell'):
        print(f"  Course cell whiteSpace: {result['courseCell']['whiteSpace']}")
    print(f"  Columns:")
    for c in result['columns']:
        print(f"    [{c['i']}] {c['text']:20s} w={c['w']:4d}px  whiteSpace={c['whiteSpace']}")

    # Assertions
    page_ok = result['page']['match']
    table_ok = result['table']['scrollbarGone']
    print(f"\n  ✅ PAGE overflow check: {'PASS' if page_ok else 'FAIL'}")
    print(f"  {'✅' if table_ok else '❌'} TABLE internal scrollbar: {'GONE' if table_ok else 'STILL PRESENT'}")
    return page_ok and table_ok


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={"width": 1280, "height": 800},
            ignore_https_errors=True,
        )
        page = context.new_page()

        # Navigate to login page
        print("→ Opening http://localhost:3000/ ...")
        page.goto(BASE, wait_until="networkidle", timeout=30000)
        time.sleep(2)

        # Check if we're on the login page
        if "Sign in" in page.content():
            print("→ Login page detected. Logging in as coordinator...")
            page.fill('input[type="email"]', COORDINATOR["email"])
            page.fill('input[type="password"]', COORDINATOR["password"])
            page.click('button:has-text("Sign in")')
            page.wait_for_timeout(5000)

        # Check if we're now on the dashboard
        print(f"→ Current URL: {page.url}")

        # Navigate to Training Requests
        print("→ Clicking 'Training Requests'...")
        page.click('button:has-text("Training Requests")')
        page.wait_for_timeout(3000)

        # Wait for the table to load
        page.wait_for_selector('table tbody tr', timeout=15000)
        page.wait_for_timeout(1000)

        # Test at 1280px
        page.set_viewport_size({"width": 1280, "height": 800})
        page.wait_for_timeout(1000)
        result_1280 = check_viewport(page, "1280px")

        # Test at 1440px
        page.set_viewport_size({"width": 1440, "height": 900})
        page.wait_for_timeout(1000)
        result_1440 = check_viewport(page, "1440px")

        # Take screenshots for evidence
        page.set_viewport_size({"width": 1280, "height": 800})
        page.wait_for_timeout(1000)
        page.screenshot(path="/home/z/my-project/download/overflow-check-1280.png", full_page=False)
        print("\n→ Screenshot saved: /home/z/my-project/download/overflow-check-1280.png")

        page.set_viewport_size({"width": 1440, "height": 900})
        page.wait_for_timeout(1000)
        page.screenshot(path="/home/z/my-project/download/overflow-check-1440.png", full_page=False)
        print("→ Screenshot saved: /home/z/my-project/download/overflow-check-1440.png")

        browser.close()

        print(f"\n{'='*60}")
        print(f"  FINAL RESULT")
        print(f"{'='*60}")
        print(f"  1280px: {'✅ ALL CHECKS PASS' if result_1280 else '❌ FAIL'}")
        print(f"  1440px: {'✅ ALL CHECKS PASS' if result_1440 else '❌ FAIL'}")
        if result_1280 and result_1440:
            print("\n  ✅ Horizontal scrollbar eliminated at both viewports.")
            sys.exit(0)
        else:
            print("\n  ❌ Overflow still present — needs further fix.")
            sys.exit(1)


if __name__ == "__main__":
    main()
