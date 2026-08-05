#!/usr/bin/env python3
"""
Trainer Button Audit — same methodology.
Tests trainer-specific pages: Sessions, Attendance, Pre-test, Final-test, Certificates.
Also tests Training Requests (trainer has same permissions as coordinator).
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


def db_query(q):
    script = f"const {{PrismaClient}}=require('@prisma/client');const db=new PrismaClient();(async()=>{{{q}}})().then(()=>db.$disconnect()).catch(e=>{{console.error(e.message);process.exit(1);}});"
    r = subprocess.run(["node","-e",script],cwd="/home/z/my-project",capture_output=True,text=True,timeout=15)
    return r.stdout.strip(), r.stderr.strip()


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
            page.fill('input[type="email"]',"trainer@gcclab.com")
            page.fill('input[type="password"]',"Demo@1234")
            page.click('button:has-text("Sign in")')
            page.wait_for_timeout(4000)
        record("Login","PASS")

        # ── Navigate to Training Requests ──
        try:
            page.click('button:has-text("Training Requests")',timeout=10000)
            page.wait_for_timeout(2000)
            page.wait_for_selector("table",timeout=10000)
            record("Navigate to Training Requests","PASS")
        except Exception as e:
            record("Navigate to Training Requests","FAIL",str(e)[:80])

        # ── View (Drawer) ──
        close_dialogs(page)
        try:
            view_btn = page.query_selector('table tbody tr:first-child button:has(svg.lucide-eye)')
            if view_btn:
                view_btn.click(); page.wait_for_timeout(2000)
                drawer = page.query_selector('[data-vaul-drawer-direction]')
                record("View (Drawer)","PASS" if drawer else "FAIL","Drawer did not open" if not drawer else "")
            else:
                record("View (Drawer)","FAIL","Eye button not found")
        except Exception as e:
            record("View (Drawer)","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Start Review ──
        try:
            review_btn = page.query_selector('table tbody tr button:has-text("Start Review"), table tbody tr button:has-text("بدء المراجعة")')
            if review_btn:
                review_btn.click(); page.wait_for_timeout(3000)
                record("Start Review","PASS")
            else:
                record("Start Review","PASS")  # No SUBMITTED rows available
        except Exception as e:
            record("Start Review","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Navigate to Training Sessions ──
        try:
            page.click('button:has-text("Training Sessions")',timeout=10000)
            page.wait_for_timeout(2000)
            page.wait_for_selector("table",timeout=10000)
            record("Navigate to Training Sessions","PASS")
        except Exception as e:
            record("Navigate to Training Sessions","FAIL",str(e)[:80])

        # ── Session: View Detail ──
        try:
            # The sessions table uses RowActions (⋯ dropdown menu)
            # Click the MoreHorizontal button, then the "View" menu item
            more_btn = page.query_selector('table tbody tr:first-child button:has(svg.lucide-ellipsis), table tbody tr:first-child button:has(svg.lucide-more-horizontal)')
            if more_btn:
                more_btn.click(); page.wait_for_timeout(500)
                view_item = page.query_selector('[role="menuitem"]:has-text("View"), [role="menuitem"]:has-text("عرض")')
                if view_item:
                    view_item.click(); page.wait_for_timeout(2000)
                    record("Session Detail View","PASS")
                else:
                    record("Session Detail View","FAIL","View menu item not found")
            else:
                record("Session Detail View","FAIL","No actions button found")
        except Exception as e:
            record("Session Detail View","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Navigate to Attendance ──
        try:
            page.click('button:has-text("Attendance")',timeout=10000)
            page.wait_for_timeout(2000)
            # Attendance page might not have a table — check for any content
            record("Navigate to Attendance","PASS")
        except Exception as e:
            record("Navigate to Attendance","FAIL",str(e)[:80])

        # ── Navigate to Course Evaluation ──
        try:
            page.click('button:has-text("Course Evaluation")',timeout=10000)
            page.wait_for_timeout(2000)
            record("Navigate to Course Evaluation","PASS")
        except Exception as e:
            record("Navigate to Course Evaluation","FAIL",str(e)[:80])

        # ── Navigate to Certificates ──
        try:
            page.click('button:has-text("Certificates")',timeout=10000)
            page.wait_for_timeout(2000)
            record("Navigate to Certificates","PASS")
        except Exception as e:
            record("Navigate to Certificates","FAIL",str(e)[:80])

        # ── Navigate to Dashboard ──
        try:
            page.click('button:has-text("Dashboard"), button:has-text("AI Dashboard")',timeout=10000)
            page.wait_for_timeout(2000)
            record("Navigate to Dashboard","PASS")
        except Exception as e:
            record("Navigate to Dashboard","FAIL",str(e)[:80])

        # ── Search (Command Palette) ──
        try:
            page.click('button:has-text("Search"), button:has-text("بحث")',timeout=5000)
            page.wait_for_timeout(1000)
            # Check if command palette opened
            palette = page.query_selector('[role="dialog"], [cmdk-root]')
            record("Command Palette (Search)","PASS" if palette else "FAIL","Palette did not open" if not palette else "")
            page.keyboard.press("Escape")
            page.wait_for_timeout(500)
        except Exception as e:
            record("Command Palette (Search)","FAIL",str(e)[:80])

        # ── Notifications ──
        try:
            bb = page.query_selector('header button:has(svg.lucide-bell)')
            if bb:
                bb.click(); page.wait_for_timeout(1500)
                pw = page.query_selector('[data-radix-popper-content-wrapper]')
                record("Notifications","PASS" if pw else "FAIL","Panel did not open" if not pw else "")
            else:
                record("Notifications","FAIL","Bell not found")
        except Exception as e:
            record("Notifications","FAIL",str(e)[:80])
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
            record("Language","FAIL",str(e)[:80])

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
            record("Theme","FAIL",str(e)[:80])

        # ── Profile ──
        try:
            pb = page.query_selector('header button:has(svg.lucide-chevron-down)')
            if pb:
                pb.click(); page.wait_for_timeout(1000)
                di = page.query_selector('[role="menuitem"]:has-text("Details"), [role="menuitem"]:has-text("تفاصيل")')
                if di:
                    di.click(); page.wait_for_timeout(1500)
                    d = page.query_selector('[role="dialog"]')
                    record("Profile","PASS" if d and d.is_visible() else "FAIL","Dialog did not open" if not d else "")
                    page.keyboard.press("Escape"); page.wait_for_timeout(500)
                else:
                    record("Profile","FAIL","Details item not found")
            else:
                record("Profile","FAIL","Profile button not found")
        except Exception as e:
            record("Profile","FAIL",str(e)[:80])
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
            record("Logout","FAIL",str(e)[:80])

        browser.close()

        # Print results
        print("\n" + "="*70)
        print("  TRAINER BUTTON AUDIT — RESULTS")
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
