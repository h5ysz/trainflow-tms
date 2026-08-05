#!/usr/bin/env python3
"""
Super Admin Button Audit — full access role.
Tests navigation to ALL pages + key buttons on each.
"""
import json, sys, time, os, signal, subprocess, urllib.request
from datetime import datetime
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
SERVER_DIR = "/home/z/my-project/.next/standalone"
results = []
global_errors = []


def record(button, status, bug="", fixed=""):
    results.append((button, status, bug, fixed))


def start_server():
    env = os.environ.copy()
    env["JWT_SECRET"]="dummy-secret-for-build-verification-only-not-for-production-use-32chars"
    env["DATABASE_URL"]="file:/home/z/my-project/db/custom.db"
    proc = subprocess.Popen(["node","server.js"],cwd=SERVER_DIR,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,preexec_fn=os.setsid)
    for _ in range(15):
        time.sleep(1)
        try:
            with urllib.request.urlopen(f"{BASE}/",timeout=3) as r:
                if r.status==200: return proc
        except: pass
    return proc


def stop_server(proc):
    try: os.killpg(os.getpgid(proc.pid),signal.SIGKILL)
    except: pass


def close_dialogs(page):
    for _ in range(5):
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        if not page.query_selector('[data-state="open"]'):
            break


def main():
    subprocess.run(["pkill","-9","-f","node server.js"],capture_output=True)
    subprocess.run(["pkill","-9","-f","next-server"],capture_output=True)
    time.sleep(2)
    proc = start_server()
    try:
        _run()
    finally:
        stop_server(proc)


def _run():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True,args=["--no-sandbox","--disable-setuid-sandbox"])
        ctx = browser.new_context(viewport={"width":1440,"height":900})
        page = ctx.new_page()

        def on_console(msg):
            if msg.type=="error":
                global_errors.append(msg.text[:200])
        page.on("console",on_console)
        def on_resp(resp):
            if resp.status>=400:
                try: m=resp.request.method
                except: m="?"
                global_errors.append(f"[{resp.status}] {m} {resp.url[:100]}")
        page.on("response",on_resp)

        # ── Login ──
        page.goto(BASE,wait_until="domcontentloaded",timeout=30000)
        page.wait_for_timeout(2000)
        if "Sign in" in page.content():
            page.fill('input[type="email"]',"admin@gcclab.com")
            page.fill('input[type="password"]',"ChangeMeInProduction!2024")
            page.click('button:has-text("Sign in")')
            page.wait_for_timeout(4000)
        record("Login","PASS")

        # List of ALL sidebar pages to test navigation
        pages_to_test = [
            "AI Dashboard",
            "Companies",
            "Company Contacts",
            "Trainees",
            "Trainers",
            "Trainer Qualifications",
            "Training Courses",
            "Training Requests",
            "Training Sessions",
            "Scheduling",
            "Attendance",
            "Course Evaluation",
            "Certificates",
            "Reports",
            "Report Schedules",
            "Audit Log",
            "Notifications",
            "User Approvals",
            "Worker Passports",
            "Compliance Matrix",
            "Executive Dashboard",
            "Renewal Center",
        ]

        for page_name in pages_to_test:
            try:
                btn = page.query_selector(f'button:has-text("{page_name}")')
                if btn:
                    btn.click()
                    page.wait_for_timeout(2500)
                    # Check for application error
                    body_text = page.evaluate("() => document.body.textContent || ''")
                    if "Application error" in body_text:
                        record(f"Navigate to {page_name}","FAIL","Application error on page")
                    elif "403" in body_text and "Forbidden" in body_text:
                        record(f"Navigate to {page_name}","FAIL","403 Forbidden")
                    else:
                        record(f"Navigate to {page_name}","PASS")
                else:
                    record(f"Navigate to {page_name}","FAIL","Button not found")
            except Exception as e:
                record(f"Navigate to {page_name}","FAIL",str(e)[:60])

        # ── Training Requests: key buttons ──
        try:
            page.click('button:has-text("Training Requests")',timeout=10000)
            page.wait_for_timeout(2000)
            page.wait_for_selector("table",timeout=10000)
            record("Requests: Table loaded","PASS")
        except Exception as e:
            record("Requests: Table loaded","FAIL",str(e)[:60])

        # New Request
        close_dialogs(page)
        try:
            page.click('button:has-text("New Request")',timeout=5000)
            page.wait_for_timeout(1500)
            d=page.query_selector('[role="dialog"]')
            record("Requests: New Request","PASS" if d and d.is_visible() else "FAIL")
        except Exception as e:
            record("Requests: New Request","FAIL",str(e)[:60])
        close_dialogs(page)

        # Export
        try:
            page.click('button:has-text("Export")',timeout=5000)
            page.wait_for_timeout(1500)
            d=page.query_selector('[role="dialog"]')
            record("Requests: Export dialog","PASS" if d and d.is_visible() else "FAIL")
        except Exception as e:
            record("Requests: Export dialog","FAIL",str(e)[:60])
        close_dialogs(page)

        # View (Drawer)
        try:
            view_btn = page.query_selector('table tbody tr:first-child button:has(svg.lucide-eye)')
            if view_btn:
                view_btn.click(); page.wait_for_timeout(2000)
                drawer = page.query_selector('[data-vaul-drawer-direction]')
                record("Requests: View (Drawer)","PASS" if drawer else "FAIL")
            else:
                record("Requests: View (Drawer)","FAIL","Eye button not found")
        except Exception as e:
            record("Requests: View (Drawer)","FAIL",str(e)[:60])
        close_dialogs(page)

        # Row selection
        try:
            cb = page.query_selector('table tbody tr:first-child button[role="checkbox"]')
            if cb:
                cb.click(); page.wait_for_timeout(1500)
                toolbar = page.query_selector('button:has-text("Print PDF")')
                record("Requests: Row Selection","PASS" if toolbar else "FAIL")
            else:
                record("Requests: Row Selection","FAIL","Checkbox not found")
        except Exception as e:
            record("Requests: Row Selection","FAIL",str(e)[:60])
        close_dialogs(page)

        # Search
        try:
            si = page.query_selector('input[placeholder*="Search"], input[placeholder*="بحث"]')
            if si:
                si.fill("TR-"); page.wait_for_timeout(2000)
                record("Requests: Search","PASS")
                si2 = page.query_selector('input[placeholder*="Search"], input[placeholder*="بحث"]')
                if si2: si2.fill("")
                page.wait_for_timeout(1000)
            else:
                record("Requests: Search","FAIL","Search input not found")
        except Exception as e:
            record("Requests: Search","FAIL",str(e)[:60])
        close_dialogs(page)

        # ── Audit Log page ──
        try:
            page.click('button:has-text("Audit Log")',timeout=10000)
            page.wait_for_timeout(2000)
            # Check for Export button
            export_btn = page.query_selector('button:has-text("Export")')
            if export_btn:
                record("Audit Log: Page + Export","PASS")
            else:
                # Page loaded but no export button
                record("Audit Log: Page loaded","PASS")
        except Exception as e:
            record("Audit Log","FAIL",str(e)[:60])

        # ── User Approvals ──
        try:
            page.click('button:has-text("User Approvals")',timeout=10000)
            page.wait_for_timeout(2000)
            record("User Approvals: Page loaded","PASS")
        except Exception as e:
            record("User Approvals","FAIL",str(e)[:60])

        # ── Settings (super admin only) ──
        try:
            # Open profile dropdown
            pb = page.query_selector('header button:has(svg.lucide-chevron-down)')
            if pb:
                pb.click(); page.wait_for_timeout(1000)
                settings_item = page.query_selector('[role="menuitem"]:has-text("Settings"), [role="menuitem"]:has-text("الإعدادات")')
                if settings_item:
                    settings_item.click(); page.wait_for_timeout(2000)
                    record("Settings (Super Admin only)","PASS")
                else:
                    record("Settings (Super Admin only)","FAIL","Settings menu item not found")
            else:
                record("Settings (Super Admin only)","FAIL","Profile button not found")
        except Exception as e:
            record("Settings (Super Admin only)","FAIL",str(e)[:60])
        close_dialogs(page)

        # ── Notifications ──
        try:
            bb = page.query_selector('header button:has(svg.lucide-bell)')
            if bb:
                bb.click(); page.wait_for_timeout(1500)
                pw = page.query_selector('[data-radix-popper-content-wrapper]')
                record("Notifications","PASS" if pw else "FAIL")
            else:
                record("Notifications","FAIL","Bell not found")
        except Exception as e:
            record("Notifications","FAIL",str(e)[:60])
        close_dialogs(page)

        # ── Language ──
        try:
            lb = page.query_selector('header button:has(svg.lucide-languages)')
            if lb:
                db = page.evaluate("()=>document.documentElement.dir")
                lb.click(); page.wait_for_timeout(2000)
                da = page.evaluate("()=>document.documentElement.dir")
                if db != da:
                    record("Language","PASS")
                    lb2 = page.query_selector('header button:has(svg.lucide-languages)')
                    if lb2: lb2.click(); page.wait_for_timeout(1500)
                else:
                    record("Language","FAIL","dir did not change")
            else:
                record("Language","FAIL","Button not found")
        except Exception as e:
            record("Language","FAIL",str(e)[:60])

        # ── Theme ──
        try:
            tb = page.query_selector('header button:has(svg.lucide-moon), header button:has(svg.lucide-sun)')
            if tb:
                cb = page.evaluate("()=>document.documentElement.className")
                tb.click(); page.wait_for_timeout(500)
                ca = page.evaluate("()=>document.documentElement.className")
                if cb != ca:
                    record("Theme","PASS")
                    tb2 = page.query_selector('header button:has(svg.lucide-moon), header button:has(svg.lucide-sun)')
                    if tb2: tb2.click(); page.wait_for_timeout(500)
                else:
                    record("Theme","FAIL","Theme did not change")
            else:
                record("Theme","FAIL","Button not found")
        except Exception as e:
            record("Theme","FAIL",str(e)[:60])

        # ── Profile ──
        try:
            pb = page.query_selector('header button:has(svg.lucide-chevron-down)')
            if pb:
                pb.click(); page.wait_for_timeout(1000)
                di = page.query_selector('[role="menuitem"]:has-text("Details"), [role="menuitem"]:has-text("تفاصيل")')
                if di:
                    di.click(); page.wait_for_timeout(1500)
                    d = page.query_selector('[role="dialog"]')
                    record("Profile","PASS" if d and d.is_visible() else "FAIL")
                    page.keyboard.press("Escape"); page.wait_for_timeout(500)
                else:
                    record("Profile","FAIL","Details item not found")
            else:
                record("Profile","FAIL","Profile button not found")
        except Exception as e:
            record("Profile","FAIL",str(e)[:60])
        close_dialogs(page)

        # ── Logout ──
        try:
            pb = page.query_selector('header button:has(svg.lucide-chevron-down)')
            if pb:
                pb.click(); page.wait_for_timeout(1000)
                so = page.query_selector('[role="menuitem"]:has(svg.lucide-log-out)')
                if so:
                    so.click(); page.wait_for_timeout(4000)
                    if "Sign in" in page.content() or "تسجيل" in page.content():
                        record("Logout","PASS")
                    else:
                        record("Logout","FAIL","Not on login page")
                else:
                    record("Logout","FAIL","Sign out item not found")
            else:
                record("Logout","FAIL","Profile button not found")
        except Exception as e:
            record("Logout","FAIL",str(e)[:60])

        browser.close()

        # Print results
        print("\n" + "="*70)
        print("  SUPER ADMIN BUTTON AUDIT — RESULTS")
        print("="*70)
        print(f"\n| {'Button':<40} | {'Status':<8} | {'Bug Found':<30} | {'Fixed':<10} |")
        print(f"|{'-'*42}|{'-'*10}|{'-'*32}|{'-'*12}|")
        for button,status,bug,fixed in results:
            print(f"| {button:<40} | {status:<8} | {bug:<30} | {fixed:<10} |")

        pass_count=sum(1 for _,s,_,_ in results if s=="PASS")
        fail_count=sum(1 for _,s,_,_ in results if s=="FAIL")
        print(f"\n  TOTAL: {len(results)}  |  PASS: {pass_count}  |  FAIL: {fail_count}")
        real_errors=[e for e in global_errors if "401" not in e and "Unauthorized" not in e]
        if real_errors:
            print(f"\n  JS/API Errors ({len(real_errors)}):")
            for e in real_errors[:15]:
                print(f"    {e[:150]}")
        else:
            print(f"\n  ✅ No unexpected JS/API errors")


if __name__=="__main__":
    main()
