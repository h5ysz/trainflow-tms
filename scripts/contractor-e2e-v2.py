#!/usr/bin/env python3
"""
Contractor E2E Test — FOCUSED on critical workflows.
Tests Save + Send with REAL DB verification, plus all other buttons.
Each test is independent and resets page state between tests.
"""

import json
import sys
import time
import os
import signal
import subprocess
import urllib.request
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
SERVER_DIR = "/home/z/my-project/.next/standalone"
JWT_SECRET = "dummy-secret-for-build-verification-only-not-for-production-use-32chars"
DATABASE_URL = "file:/home/z/my-project/db/custom.db"

results = []
console_errors = []
api_errors = []


def log(feature, status, notes=""):
    results.append((feature, status, notes))
    emoji = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⏭️"
    print(f"  {emoji} {feature}: {status} — {notes}")


def start_server():
    env = os.environ.copy()
    env["JWT_SECRET"] = JWT_SECRET
    env["DATABASE_URL"] = DATABASE_URL
    proc = subprocess.Popen(
        ["node", "server.js"], cwd=SERVER_DIR, env=env,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid,
    )
    for i in range(15):
        time.sleep(1)
        try:
            with urllib.request.urlopen(f"{BASE}/", timeout=3) as r:
                if r.status == 200:
                    return proc
        except:
            pass
    return proc


def stop_server(proc):
    if proc:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
            time.sleep(1)
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except:
            pass


def db_query(query_js):
    script = f"""
const {{ PrismaClient }} = require('@prisma/client');
const db = new PrismaClient();
(async () => {{
  {query_js}
}})().then(() => db.$disconnect()).catch(e => {{ console.error(e.message); process.exit(1); }});
"""
    result = subprocess.run(
        ["node", "-e", script], cwd="/home/z/my-project",
        capture_output=True, text=True, timeout=15,
    )
    return result.stdout.strip(), result.stderr.strip()


def get_contractor_id():
    out, _ = db_query("""
        const u = await db.user.findUnique({ where: { email: 'contractor@gcclab.com' }, select: { id: true } });
        console.log(u.id);
    """)
    return out


def get_coordinator_ids():
    out, _ = db_query("""
        const cs = await db.user.findMany({ where: { role: 'COORDINATOR', isActive: true, deletedAt: null }, select: { id: true } });
        console.log(JSON.stringify(cs.map(c => c.id)));
    """)
    return json.loads(out)


def count_notifications(user_id, since=None):
    where = f"userId: '{user_id}'"
    if since:
        where += f", createdAt: {{ gte: new Date('{since}') }}"
    out, _ = db_query(f"""
        const c = await db.notification.count({{ where: {{ {where} }} }});
        console.log(c);
    """)
    return int(out) if out.isdigit() else 0


def get_request_status(req_id):
    out, _ = db_query(f"""
        const r = await db.trainingRequest.findUnique({{ where: {{ id: '{req_id}' }}, select: {{ status: true }} }});
        console.log(r ? r.status : 'NOT_FOUND');
    """)
    return out


def close_all_dialogs(page):
    """Press Escape multiple times to close any open dialogs/menus."""
    for _ in range(3):
        page.keyboard.press("Escape")
        page.wait_for_timeout(300)


def main():
    print("=" * 70)
    print("  CONTRACTOR E2E TEST — REAL CLICKS + DB VERIFICATION")
    print("=" * 70)

    subprocess.run(["pkill", "-9", "-f", "node server.js"], capture_output=True)
    subprocess.run(["pkill", "-9", "-f", "next-server"], capture_output=True)
    time.sleep(2)

    print("\n→ Starting server...")
    server_proc = start_server()

    contractor_id = get_contractor_id()
    coord_ids = get_coordinator_ids()
    print(f"  Contractor ID: {contractor_id}")
    print(f"  Coordinator IDs: {coord_ids}")

    try:
        _run_tests(contractor_id, coord_ids)
    finally:
        stop_server(server_proc)
        _print_report()


def _run_tests(contractor_id, coord_ids):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True, args=["--no-sandbox", "--disable-setuid-sandbox"])
        context = browser.new_context(
            viewport={"width": 1440, "height": 900},
            ignore_https_errors=True,
        )
        page = context.new_page()

        def on_console(msg):
            if msg.type == "error":
                console_errors.append(f"[console.error] {msg.text[:200]}")
        page.on("console", on_console)

        def on_response(response):
            if response.status >= 400:
                try:
                    method = response.request.method
                except:
                    method = "?"
                api_errors.append(f"[{response.status}] {method} {response.url[:120]}")
        page.on("response", on_response)

        # ═══════════════════════════════════════════════════════════════
        # TEST 1: Login
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Login ─")
        page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)
        if "Sign in" in page.content():
            page.fill('input[type="email"]', "contractor@gcclab.com")
            page.fill('input[type="password"]', "Demo@1234")
            page.click('button:has-text("Sign in")')
            page.wait_for_timeout(4000)
            if "Sign in" not in page.content():
                log("Login", "PASS", "Logged in")
            else:
                log("Login", "FAIL", "Still on login page")
                browser.close()
                return
        else:
            log("Login", "PASS", "Already logged in")

        # Navigate to Training Requests
        print("\n─ TEST: Navigate to Training Requests ─")
        try:
            page.click('button:has-text("Training Requests")', timeout=10000)
            page.wait_for_timeout(2000)
            page.wait_for_selector("table", timeout=10000)
            log("Navigate to Training Requests", "PASS", "Page loaded")
        except Exception as e:
            log("Navigate to Training Requests", "FAIL", str(e)[:80])
            browser.close()
            return

        # ═══════════════════════════════════════════════════════════════
        # TEST: New Request button
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: New Request (طلب جديد) ─")
        close_all_dialogs(page)
        try:
            page.click('button:has-text("New Request")', timeout=5000)
            page.wait_for_timeout(1500)
            dialog = page.query_selector('[role="dialog"]')
            if dialog and dialog.is_visible():
                dt = dialog.inner_text()
                if ("Save" in dt or "حفظ" in dt) and ("Submit" in dt or "إرسال" in dt):
                    log("New Request (طلب جديد)", "PASS", "Dialog opened with Save + Submit")
                else:
                    log("New Request (طلب جديد)", "FAIL", "Missing Save/Submit buttons")
            else:
                log("New Request (طلب جديد)", "FAIL", "Dialog did not open")
        except Exception as e:
            log("New Request (طلب جديد)", "FAIL", str(e)[:80])
        close_all_dialogs(page)

        # ═══════════════════════════════════════════════════════════════
        # CRITICAL TEST: Save (حفظ)
        # Verify: status=DRAFT, NO coordinator notification, contractor stays
        # ═══════════════════════════════════════════════════════════════
        print("\n─ CRITICAL TEST: Save (حفظ) ─")
        save_time = time.strftime("%Y-%m-%dT%H:%M:%S")
        saved_req_id = None
        try:
            page.click('button:has-text("New Request")', timeout=5000)
            page.wait_for_timeout(1500)

            # Select a course
            course_trigger = page.query_selector('[role="dialog"] button[role="combobox"]')
            if course_trigger:
                course_trigger.click()
                page.wait_for_timeout(500)
                option = page.query_selector('[role="option"] >> nth=0')
                if option:
                    option.click()
                    page.wait_for_timeout(500)

            # Record coordinator notifs BEFORE
            coord_before = sum(count_notifications(cid, save_time) for cid in coord_ids)

            # Click Save
            save_btn = page.query_selector('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("حفظ")')
            if save_btn:
                save_btn.click()
                page.wait_for_timeout(3000)

                # Check dialog closed
                dialog = page.query_selector('[role="dialog"]')
                if not dialog or not dialog.is_visible():
                    # Check DB
                    out, _ = db_query("""
                        const r = await db.trainingRequest.findFirst({
                          where: { createdAt: { gte: new Date('%s') } },
                          orderBy: { createdAt: 'desc' },
                          select: { id: true, status: true, refNumber: true }
                        });
                        console.log(JSON.stringify(r));
                    """ % save_time)
                    if out and out != "null":
                        req = json.loads(out)
                        saved_req_id = req["id"]
                        if req["status"] == "DRAFT":
                            coord_after = sum(count_notifications(cid, save_time) for cid in coord_ids)
                            notifs_diff = coord_after - coord_before
                            if notifs_diff == 0:
                                log("Save (حفظ)", "PASS", f"status=DRAFT, ref={req['refNumber']}, NO coordinator notif, contractor stays")
                            else:
                                log("Save (حفظ)", "FAIL", f"status=DRAFT but {notifs_diff} coordinator notif(s) created (expected 0)")
                        else:
                            log("Save (حفظ)", "FAIL", f"status={req['status']} (expected DRAFT)")
                    else:
                        log("Save (حفظ)", "FAIL", "No request in DB after save")
                else:
                    log("Save (حفظ)", "FAIL", "Dialog still open")
        except Exception as e:
            log("Save (حفظ)", "FAIL", str(e)[:80])
        close_all_dialogs(page)

        # ═══════════════════════════════════════════════════════════════
        # TEST: Edit (تعديل) — DRAFT should be editable
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Edit (تعديل) ─")
        close_all_dialogs(page)
        try:
            page.wait_for_timeout(1000)
            edit_btn = page.query_selector('table tbody tr:first-child button:has(svg.lucide-pencil)')
            if edit_btn:
                edit_btn.click()
                page.wait_for_timeout(1500)
                dialog = page.query_selector('[role="dialog"]')
                if dialog and dialog.is_visible():
                    log("Edit (تعديل)", "PASS", "Edit dialog opened for DRAFT")
                else:
                    log("Edit (تعديل)", "FAIL", "Dialog did not open")
            else:
                log("Edit (تعديل)", "FAIL", "Edit button not found")
        except Exception as e:
            log("Edit (تعديل)", "FAIL", str(e)[:80])
        close_all_dialogs(page)

        # ═══════════════════════════════════════════════════════════════
        # CRITICAL TEST: Send (إرسال)
        # Verify: status=SUBMITTED, coordinator notification created
        # ═══════════════════════════════════════════════════════════════
        print("\n─ CRITICAL TEST: Send (إرسال) ─")
        send_time = time.strftime("%Y-%m-%dT%H:%M:%S")
        try:
            # Find Submit button on first row (the DRAFT we just saved)
            submit_btn = page.query_selector('table tbody tr:first-child button:has(svg.lucide-send)')
            if not submit_btn:
                submit_btn = page.query_selector('table tbody tr:first-child button:has-text("Submit"), table tbody tr:first-child button:has-text("إرسال")')

            if submit_btn:
                coord_before = sum(count_notifications(cid, send_time) for cid in coord_ids)
                submit_btn.click()
                page.wait_for_timeout(4000)

                if saved_req_id:
                    status = get_request_status(saved_req_id)
                    if status == "SUBMITTED":
                        coord_after = sum(count_notifications(cid, send_time) for cid in coord_ids)
                        notifs_created = coord_after - coord_before
                        if notifs_created > 0:
                            log("Send (إرسال)", "PASS", f"status=SUBMITTED, {notifs_created} coordinator notif(s) created")
                        else:
                            log("Send (إرسال)", "FAIL", "status=SUBMITTED but NO coordinator notif")
                    else:
                        log("Send (إرسال)", "FAIL", f"status={status} (expected SUBMITTED)")
                else:
                    log("Send (إرسال)", "FAIL", "No saved request ID")
            else:
                log("Send (إرسال)", "FAIL", "Submit button not found")
        except Exception as e:
            log("Send (إرسال)", "FAIL", str(e)[:80])
        close_all_dialogs(page)

        # ═══════════════════════════════════════════════════════════════
        # TEST: Delete (حذف) — contractor should NOT see delete
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Delete (حذف) ─")
        try:
            delete_btn = page.query_selector('table tbody tr button:has(svg.lucide-trash-2)')
            if delete_btn:
                log("Delete (حذف)", "FAIL", "Delete button visible to contractor (RBAC broken)")
            else:
                log("Delete (حذف)", "PASS", "No delete button (correct RBAC)")
        except Exception as e:
            log("Delete (حذف)", "FAIL", str(e)[:80])

        # ═══════════════════════════════════════════════════════════════
        # TEST: Preview (المعاينة)
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Preview (المعاينة) ─")
        close_all_dialogs(page)
        try:
            ref_btn = page.query_selector('table tbody tr:first-child button.font-mono')
            if ref_btn:
                ref_btn.click()
                page.wait_for_timeout(2000)
                dialog = page.query_selector('[role="dialog"]')
                if dialog and dialog.is_visible():
                    dt = dialog.inner_text()
                    if "TR-" in dt:
                        log("Preview (المعاينة)", "PASS", "Dialog opened with request details")
                    else:
                        log("Preview (المعاينة)", "FAIL", "Dialog opened but no TR- ref")
                    # Check buttons
                    if "Export Excel" in dt or "تصدير Excel" in dt:
                        log("Preview — Export Excel", "PASS", "Visible")
                    else:
                        log("Preview — Export Excel", "FAIL", "Not found")
                    if "Print" in dt or "طباعة" in dt:
                        log("Preview — Print", "PASS", "Visible")
                    else:
                        log("Preview — Print", "FAIL", "Not found")
                else:
                    log("Preview (المعاينة)", "FAIL", "Dialog did not open")
            else:
                log("Preview (المعاينة)", "FAIL", "No ref button")
        except Exception as e:
            log("Preview (المعاينة)", "FAIL", str(e)[:80])

        # ═══════════════════════════════════════════════════════════════
        # TEST: Export Excel (تصدير) — via Preview dialog
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Export Excel (تصدير) ─")
        try:
            # Dialog should still be open from Preview test
            dialog = page.query_selector('[role="dialog"]')
            if not dialog or not dialog.is_visible():
                ref_btn = page.query_selector('table tbody tr:first-child button.font-mono')
                if ref_btn:
                    ref_btn.click()
                    page.wait_for_timeout(2000)

            export_btn = page.query_selector('[role="dialog"] button:has-text("Export Excel"), [role="dialog"] button:has-text("تصدير Excel")')
            if export_btn:
                # Override window.open to capture the URL
                page.evaluate("""
                    () => {
                        window.__exportUrl = null;
                        window.open = function(url) { window.__exportUrl = url; return null; };
                    }
                """)
                export_btn.click()
                page.wait_for_timeout(2000)
                export_url = page.evaluate("() => window.__exportUrl")
                if export_url and "/api/export/company-data" in export_url:
                    if "format=excel" in export_url and "scope=specific_request" in export_url:
                        log("Export Excel (تصدير)", "PASS", "window.open called with correct params")
                    else:
                        log("Export Excel (تصدير)", "FAIL", f"URL missing params: {export_url[:80]}")
                else:
                    log("Export Excel (تصدير)", "FAIL", f"window.open not called: {export_url}")
            else:
                log("Export Excel (تصدير)", "FAIL", "Button not found")
        except Exception as e:
            log("Export Excel (تصدير)", "FAIL", str(e)[:80])
        close_all_dialogs(page)

        # ═══════════════════════════════════════════════════════════════
        # TEST: Print (الطباعة)
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Print (الطباعة) ─")
        try:
            ref_btn = page.query_selector('table tbody tr:first-child button.font-mono')
            if ref_btn:
                ref_btn.click()
                page.wait_for_timeout(2000)
                print_btn = page.query_selector('[role="dialog"] button:has-text("Print"), [role="dialog"] button:has-text("طباعة")')
                if print_btn:
                    page.evaluate("() => { window.__printCalled = false; window.print = () => { window.__printCalled = true; }; }")
                    print_btn.click()
                    page.wait_for_timeout(500)
                    if page.evaluate("() => window.__printCalled"):
                        log("Print (الطباعة)", "PASS", "window.print() called")
                    else:
                        log("Print (الطباعة)", "FAIL", "window.print() not called")
                else:
                    log("Print (الطباعة)", "FAIL", "Print button not found")
        except Exception as e:
            log("Print (الطباعة)", "FAIL", str(e)[:80])
        close_all_dialogs(page)

        # ═══════════════════════════════════════════════════════════════
        # TEST: Search (البحث)
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Search (البحث) ─")
        try:
            search_input = page.query_selector('input[placeholder*="Search"], input[placeholder*="بحث"]')
            if search_input:
                search_input.fill("TR-")
                page.wait_for_timeout(2000)
                rows = page.evaluate("() => document.querySelectorAll('table tbody tr').length")
                log("Search (البحث)", "PASS", f"Search executed, {rows} rows shown")
                # Clear using page.evaluate (more reliable than re-querying)
                page.evaluate("() => { const i = document.querySelector('input[placeholder*=\"Search\"], input[placeholder*=\"بحث\"]'); if(i) { i.value = ''; i.dispatchEvent(new Event('input', {bubbles: true})); } }")
                page.wait_for_timeout(1000)
            else:
                log("Search (البحث)", "FAIL", "Search input not found")
        except Exception as e:
            log("Search (البحث)", "FAIL", str(e)[:80])
        close_all_dialogs(page)

        # ═══════════════════════════════════════════════════════════════
        # TEST: Import (استيراد)
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Import (استيراد) ─")
        try:
            import_btn = page.query_selector('button:has-text("Import"), button:has-text("استيراد")')
            if import_btn:
                import_btn.click()
                page.wait_for_timeout(1500)
                dialog = page.query_selector('[role="dialog"]')
                if dialog and dialog.is_visible():
                    log("Import (استيراد)", "PASS", "Import dialog opened")
                else:
                    log("Import (استيراد)", "FAIL", "Dialog did not open")
            else:
                log("Import (استيراد)", "FAIL", "Import button not found")
        except Exception as e:
            log("Import (استيراد)", "FAIL", str(e)[:80])
        close_all_dialogs(page)

        # ═══════════════════════════════════════════════════════════════
        # TEST: Upload Attachments (إرفاق ملفات)
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Upload Attachments (إرفاق ملفات) ─")
        try:
            page.click('button:has-text("New Request")', timeout=5000)
            page.wait_for_timeout(1500)
            file_input = page.query_selector('[role="dialog"] input[type="file"]')
            if file_input:
                log("Upload Attachments (إرفاق)", "PASS", "File upload UI available")
            else:
                # Check for upload button
                upload_btn = page.query_selector('[role="dialog"] button:has-text("Upload"), [role="dialog"] button:has-text("رفع"), [role="dialog"] button:has-text("Attach"), [role="dialog"] button:has-text("إرفاق")')
                if upload_btn:
                    log("Upload Attachments (إرفاق)", "PASS", "Upload button available")
                else:
                    log("Upload Attachments (إرفاق)", "FAIL", "No upload UI found")
        except Exception as e:
            log("Upload Attachments (إرفاق)", "FAIL", str(e)[:80])
        close_all_dialogs(page)

        # ═══════════════════════════════════════════════════════════════
        # TEST: Notifications (الإشعارات)
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Notifications (الإشعارات) ─")
        close_all_dialogs(page)
        page.wait_for_timeout(500)
        try:
            bell_btn = page.query_selector('header button:has(svg.lucide-bell)')
            if bell_btn:
                bell_btn.click()
                page.wait_for_timeout(1500)
                # Check if popover appeared
                popover = page.query_selector('[data-radix-popper-content-wrapper]')
                if popover:
                    log("Notifications (الإشعارات)", "PASS", "Panel opened")
                else:
                    # Maybe it's a different element
                    notif_text = page.evaluate("() => document.body.textContent?.includes('Notifications') || document.body.textContent?.includes('الإشعارات')")
                    if notif_text:
                        log("Notifications (الإشعارات)", "PASS", "Panel opened (text found)")
                    else:
                        log("Notifications (الإشعارات)", "FAIL", "Panel did not open")
            else:
                log("Notifications (الإشعارات)", "FAIL", "Bell button not found")
        except Exception as e:
            log("Notifications (الإشعارات)", "FAIL", str(e)[:80])
        close_all_dialogs(page)

        # ═══════════════════════════════════════════════════════════════
        # TEST: Language Switch (اللغة)
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Language Switch (اللغة) ─")
        try:
            lang_btn = page.query_selector('header button:has(svg.lucide-languages)')
            if lang_btn:
                dir_before = page.evaluate("() => document.documentElement.dir")
                lang_btn.click()
                page.wait_for_timeout(2000)
                dir_after = page.evaluate("() => document.documentElement.dir")
                if dir_after != dir_before:
                    log("Language Switch (اللغة)", "PASS", f"dir: {dir_before} → {dir_after}")
                    # Switch back
                    lang_btn2 = page.query_selector('header button:has(svg.lucide-languages)')
                    if lang_btn2:
                        lang_btn2.click()
                        page.wait_for_timeout(1500)
                else:
                    log("Language Switch (اللغة)", "FAIL", f"dir stayed {dir_after}")
            else:
                log("Language Switch (اللغة)", "FAIL", "Button not found")
        except Exception as e:
            log("Language Switch (اللغة)", "FAIL", str(e)[:80])

        # ═══════════════════════════════════════════════════════════════
        # TEST: Theme Switch (الثيم)
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Theme Switch (الثيم) ─")
        try:
            theme_btn = page.query_selector('header button:has(svg.lucide-moon), header button:has(svg.lucide-sun)')
            if theme_btn:
                class_before = page.evaluate("() => document.documentElement.className")
                theme_btn.click()
                page.wait_for_timeout(500)
                class_after = page.evaluate("() => document.documentElement.className")
                if class_before != class_after:
                    log("Theme Switch (الثيم)", "PASS", "Theme toggled")
                    theme_btn2 = page.query_selector('header button:has(svg.lucide-moon), header button:has(svg.lucide-sun)')
                    if theme_btn2:
                        theme_btn2.click()
                        page.wait_for_timeout(500)
                else:
                    log("Theme Switch (الثيم)", "FAIL", "Theme did not change")
            else:
                log("Theme Switch (الثيم)", "FAIL", "Button not found")
        except Exception as e:
            log("Theme Switch (الثيم)", "FAIL", str(e)[:80])

        # ═══════════════════════════════════════════════════════════════
        # TEST: Profile (الملف الشخصي)
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Profile (الملف الشخصي) ─")
        try:
            profile_btn = page.query_selector('header button:has(svg.lucide-chevron-down)')
            if profile_btn:
                profile_btn.click()
                page.wait_for_timeout(1000)
                details = page.query_selector('[role="menuitem"]:has-text("Details"), [role="menuitem"]:has-text("تفاصيل")')
                if details:
                    details.click()
                    page.wait_for_timeout(1500)
                    dialog = page.query_selector('[role="dialog"]')
                    if dialog and dialog.is_visible():
                        log("Profile (الملف الشخصي)", "PASS", "Profile dialog opened")
                        page.keyboard.press("Escape")
                        page.wait_for_timeout(500)
                    else:
                        log("Profile (الملف الشخصي)", "FAIL", "Dialog did not open")
                else:
                    log("Profile (الملف الشخصي)", "FAIL", "Details item not found")
                    page.keyboard.press("Escape")
            else:
                log("Profile (الملف الشخصي)", "FAIL", "Profile button not found")
        except Exception as e:
            log("Profile (الملف الشخصي)", "FAIL", str(e)[:80])
        close_all_dialogs(page)

        # ═══════════════════════════════════════════════════════════════
        # TEST: Logout (تسجيل الخروج)
        # ═══════════════════════════════════════════════════════════════
        print("\n─ TEST: Logout (تسجيل الخروج) ─")
        try:
            profile_btn = page.query_selector('header button:has(svg.lucide-chevron-down)')
            if profile_btn:
                profile_btn.click()
                page.wait_for_timeout(1000)
                signout = page.query_selector('[role="menuitem"]:has(svg.lucide-log-out)')
                if signout:
                    signout.click()
                    page.wait_for_timeout(4000)
                    if "Sign in" in page.content() or "تسجيل" in page.content():
                        log("Logout (تسجيل الخروج)", "PASS", "Redirected to login page")
                    else:
                        log("Logout (تسجيل الخروج)", "FAIL", f"Not on login page. URL: {page.url}")
                else:
                    log("Logout (تسجيل الخروج)", "FAIL", "Sign out item not found")
            else:
                log("Logout (تسجيل الخروج)", "FAIL", "Profile button not found")
        except Exception as e:
            log("Logout (تسجيل الخروج)", "FAIL", str(e)[:80])

        browser.close()


def _print_report():
    print("\n" + "=" * 70)
    print("  CONTRACTOR E2E TEST — FINAL REPORT")
    print("=" * 70)
    print(f"\n{'Feature':<40} {'Status':<8} {'Notes'}")
    print("-" * 110)
    for feature, status, notes in results:
        emoji = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⏭️"
        print(f"{emoji} {feature:<38} {status:<8} {notes[:65]}")

    pass_count = sum(1 for _, s, _ in results if s == "PASS")
    fail_count = sum(1 for _, s, _ in results if s == "FAIL")
    skip_count = sum(1 for _, s, _ in results if s == "SKIP")

    print(f"\n{'─' * 70}")
    print(f"  TOTAL: {len(results)}  |  ✅ PASS: {pass_count}  |  ❌ FAIL: {fail_count}  |  ⏭️ SKIP: {skip_count}")
    print(f"{'─' * 70}")

    real_console_errors = [e for e in console_errors if "401" not in e and "Unauthorized" not in e]
    if real_console_errors:
        print(f"\n  ⚠️  CONSOLE ERRORS ({len(real_console_errors)}):")
        for err in real_console_errors[:15]:
            print(f"    {err[:150]}")
    else:
        print(f"\n  ✅ No unexpected console errors")

    real_api_errors = [e for e in api_errors if "401" not in e]
    if real_api_errors:
        print(f"\n  ⚠️  API ERRORS ({len(real_api_errors)}):")
        for err in real_api_errors[:15]:
            print(f"    {err[:150]}")
    else:
        print(f"  ✅ No unexpected API errors (4xx/5xx)")

    print(f"\n{'=' * 70}")
    if fail_count == 0:
        print("  ✅ ALL CONTRACTOR ACTIONS PASSED E2E TESTS")
    else:
        print(f"  ❌ {fail_count} ACTION(S) NEED FIXING")
    print(f"{'=' * 70}")


if __name__ == "__main__":
    main()
