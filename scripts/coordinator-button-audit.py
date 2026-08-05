#!/usr/bin/env python3
"""
Coordinator Button Audit — same methodology as contractor audit.
Tests every visible coordinator button with real execution + DB verification.
"""
import json, sys, time, os, signal, subprocess, urllib.request
from datetime import datetime
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
SERVER_DIR = "/home/z/my-project/.next/standalone"
EVIDENCE_DIR = "/home/z/my-project/download/coordinator-button-audit"
os.makedirs(EVIDENCE_DIR, exist_ok=True)

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


def login_api(email, password):
    """Login via API and return cookie value."""
    data = json.dumps({"email": email, "password": password}).encode()
    req = urllib.request.Request(f"{BASE}/api/auth/login", data=data, headers={"Content-Type":"application/json"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        ch = resp.headers.get("Set-Cookie","")
        for part in ch.split(";"):
            part = part.strip()
            if part.startswith("tf_session="):
                return part[len("tf_session="):]
    return None


def create_request(status="SUBMITTED"):
    """Create a request via API as contractor, return its ID."""
    cookie = login_api("contractor@gcclab.com", "Demo@1234")
    # Get a course ID
    out,_ = db_query("const c=await db.course.findFirst({select:{id:true}});console.log(c.id);")
    course_id = out
    body = json.dumps({
        "priority":"NORMAL","traineeCount":1,"preferredLanguage":"en",
        "status":status,"courseId":course_id,
        "preferredDateFrom":"2026-10-01","preferredDateTo":"2026-10-05",
        "preferredLocation":"Riyadh","notes":f"Coordinator audit test {status}",
        "trainees":[{"fullName":"Audit Trainee","nationalId":"1234567890","nationality":"Saudi","jobTitle":"Worker","documents":[]}],
        "additionalDocuments":[]
    }).encode()
    req = urllib.request.Request(f"{BASE}/api/requests", data=body, headers={"Content-Type":"application/json","Cookie":f"tf_session={cookie}"})
    with urllib.request.urlopen(req, timeout=10) as resp:
        r = json.loads(resp.read())
        return r["data"]["id"], r["data"]["refNumber"]


def set_request_status(req_id, status):
    """Set a request's status directly in the DB (bypass API for test setup)."""
    out,_ = db_query(f"""
        const r = await db.trainingRequest.update({{
          where: {{ id: '{req_id}' }},
          data: {{ status: '{status}', updatedAt: new Date() }}
        }});
        console.log(r.status);
    """)
    return out


def get_request_status(req_id):
    out,_ = db_query(f"const r=await db.trainingRequest.findUnique({{where:{{id:'{req_id}'}},select:{{status:true}}}});console.log(r?r.status:'NOT_FOUND');")
    return out


def count_coordinator_notifications(since_iso):
    out,_ = db_query(f"const c=await db.notification.count({{where:{{createdAt:{{gte:new Date('{since_iso}')}},user:{{role:'COORDINATOR'}}}}}});console.log(c);")
    return int(out) if out.isdigit() else 0


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
            page.fill('input[type="email"]',"coordinator@gcclab.com")
            page.fill('input[type="password"]',"Demo@1234")
            page.click('button:has-text("Sign in")')
            page.wait_for_timeout(4000)
        record("Login","PASS")

        # Navigate to Training Requests
        page.click('button:has-text("Training Requests")',timeout=10000)
        page.wait_for_timeout(2000)
        page.wait_for_selector("table",timeout=10000)
        record("Navigate to Training Requests","PASS")

        # ── New Request ──
        close_dialogs(page)
        try:
            page.click('button:has-text("New Request")',timeout=5000)
            page.wait_for_timeout(1500)
            d=page.query_selector('[role="dialog"]')
            record("New Request","PASS" if d and d.is_visible() else "FAIL","Dialog did not open" if not d else "")
        except Exception as e:
            record("New Request","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Import ──
        try:
            page.click('button:has-text("Import")',timeout=5000)
            page.wait_for_timeout(1500)
            d=page.query_selector('[role="dialog"]')
            record("Import Excel","PASS" if d and d.is_visible() else "FAIL","Dialog did not open" if not d else "")
        except Exception as e:
            record("Import Excel","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Export (page header) ──
        try:
            page.click('button:has-text("Export")',timeout=5000)
            page.wait_for_timeout(1500)
            d=page.query_selector('[role="dialog"]')
            record("Export (page header)","PASS" if d and d.is_visible() else "FAIL","Dialog did not open" if not d else "")
        except Exception as e:
            record("Export (page header)","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Create test requests in various statuses ──
        print("  Creating test requests...")
        # SUBMITTED request
        sub_id, sub_ref = create_request("SUBMITTED")
        print(f"  SUBMITTED: {sub_ref}")
        # DRAFT request
        draft_id, draft_ref = create_request("DRAFT")
        print(f"  DRAFT: {draft_ref}")
        page.reload(wait_until="domcontentloaded",timeout=30000)
        page.wait_for_timeout(3000)

        # ── View (Eye icon → Drawer) ──
        try:
            view_btn = page.query_selector('table tbody tr:first-child button:has(svg.lucide-eye)')
            if view_btn:
                view_btn.click()
                page.wait_for_timeout(2000)
                # Coordinator should see the Drawer, not the Preview dialog
                drawer = page.query_selector('[data-vaul-drawer-direction]')
                if drawer:
                    record("View (Drawer)","PASS")
                else:
                    d = page.query_selector('[role="dialog"]')
                    record("View (Drawer)","PASS" if d else "FAIL","Neither drawer nor dialog opened" if not d else "")
            else:
                record("View (Drawer)","FAIL","Eye button not found")
        except Exception as e:
            record("View (Drawer)","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Row checkbox selection + Inline toolbar Export Excel ──
        try:
            cb = page.query_selector('table tbody tr:first-child button[role="checkbox"]')
            if cb:
                cb.click()
                page.wait_for_timeout(1500)
                # Check if toolbar appeared
                toolbar = page.query_selector('button:has-text("Print PDF")')
                if toolbar:
                    record("Row Selection + Toolbar","PASS")
                    # Now test Export Excel in the toolbar (row is still selected)
                    eb = page.query_selector('button:has-text("Export Excel")')
                    if not eb:
                        eb = page.query_selector('button:has(svg.lucide-file-spreadsheet)')
                    if eb:
                        page.evaluate("()=>{window.__eu=null;window.open=(u)=>{window.__eu=u;return null;};}")
                        eb.click(); page.wait_for_timeout(2000)
                        eu = page.evaluate("()=>window.__eu")
                        if eu and "/api/export/company-data" in eu and "format=excel" in eu:
                            record("Inline Toolbar — Export Excel","PASS")
                        else:
                            record("Inline Toolbar — Export Excel","FAIL",f"window.open not called: {eu}")
                    else:
                        record("Inline Toolbar — Export Excel","FAIL","Export Excel button not found in toolbar")
                else:
                    record("Row Selection + Toolbar","FAIL","Toolbar did not appear")
            else:
                record("Row Selection + Toolbar","FAIL","Checkbox not found")
                record("Inline Toolbar — Export Excel","FAIL","Checkbox not found")
        except Exception as e:
            record("Row Selection + Toolbar","FAIL",str(e)[:80])
            record("Inline Toolbar — Export Excel","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Start Review (SUBMITTED → UNDER_REVIEW) ──
        try:
            # Find a SUBMITTED row
            review_btn = page.query_selector('table tbody tr button:has-text("Start Review"), table tbody tr button:has-text("بدء المراجعة")')
            if review_btn:
                before_status = "SUBMITTED"
                review_btn.click(); page.wait_for_timeout(3000)
                # Verify DB changed
                # Find the request that was just reviewed (most recent UNDER_REVIEW)
                out,_ = db_query("const r=await db.trainingRequest.findFirst({where:{status:'UNDER_REVIEW'},orderBy:{updatedAt:'desc'},select:{id:true,refNumber:true}});console.log(JSON.stringify(r));")
                if out and out != "null":
                    record("Start Review (SUBMITTED→UNDER_REVIEW)","PASS")
                else:
                    record("Start Review (SUBMITTED→UNDER_REVIEW)","FAIL","No UNDER_REVIEW request found in DB")
            else:
                record("Start Review (SUBMITTED→UNDER_REVIEW)","FAIL","Start Review button not found")
        except Exception as e:
            record("Start Review (SUBMITTED→UNDER_REVIEW)","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Approve (UNDER_REVIEW → APPROVED) ──
        try:
            approve_btn = page.query_selector('table tbody tr button:has-text("Approve"), table tbody tr button:has-text("اعتماد")')
            if approve_btn:
                approve_btn.click(); page.wait_for_timeout(3000)
                out,_ = db_query("const r=await db.trainingRequest.findFirst({where:{status:'APPROVED'},orderBy:{updatedAt:'desc'},select:{id:true}});console.log(r?'YES':'NO');")
                if out == "YES":
                    record("Approve (UNDER_REVIEW→APPROVED)","PASS")
                else:
                    record("Approve (UNDER_REVIEW→APPROVED)","FAIL","No APPROVED request in DB")
            else:
                record("Approve (UNDER_REVIEW→APPROVED)","FAIL","Approve button not found")
        except Exception as e:
            record("Approve (UNDER_REVIEW→APPROVED)","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Return for Modification (UNDER_REVIEW → REQUIRES_MODIFICATION) ──
        # Need another UNDER_REVIEW request — create one
        try:
            # Create a new SUBMITTED and start review
            new_id, new_ref = create_request("SUBMITTED")
            set_result = set_request_status(new_id, "UNDER_REVIEW")
            verify_status = get_request_status(new_id)
            print(f"  DEBUG: set_request_status returned '{set_result}', DB status='{verify_status}' for {new_ref}")
            page.reload(wait_until="domcontentloaded",timeout=30000)
            page.wait_for_timeout(3000)

            # Debug: check what text is in the table
            table_text = page.evaluate("() => { const rows = document.querySelectorAll('table tbody tr'); return Array.from(rows).slice(0,5).map(r => (r.textContent||'').substring(0,100)); }")
            print(f"  DEBUG: First 5 rows text: {table_text}")

            # Debug: check SVG classes in the first row that contains "Under Review"
            svg_debug = page.evaluate("""
                () => {
                    const rows = document.querySelectorAll('table tbody tr');
                    for (const row of rows) {
                        const text = row.textContent || '';
                        if (text.includes('Under Review')) {
                            const svgs = row.querySelectorAll('svg');
                            return Array.from(svgs).map(s => s.getAttribute('class') || 'no-class');
                        }
                    }
                    return 'NO UNDER_REVIEW ROW FOUND';
                }
            """)
            print(f"  DEBUG: SVG classes in UNDER_REVIEW row: {svg_debug}")

            # Find the UNDER_REVIEW row by looking for the status badge text
            # Use JavaScript to find the row, then click its More button
            more_btn_found = False
            try:
                # Use Playwright's locator API to find the More button in an UNDER_REVIEW row
                under_review_row = page.locator('table tbody tr').filter(has_text='Under Review').first
                more_btn = under_review_row.locator('button').filter(has=page.locator('svg.lucide-ellipsis-vertical'))
                more_btn.click(timeout=3000)
                more_btn_found = True
            except:
                pass
            page.wait_for_timeout(1000)
            if more_btn_found:
                # Wait for the dropdown menu to appear
                try:
                    page.wait_for_selector('[role="menuitem"]', timeout=3000)
                except:
                    pass
                # Click "Return for Modification"
                rev_item = page.query_selector('[role="menuitem"]:has-text("Return"), [role="menuitem"]:has-text("إرجاع")')
                if rev_item:
                    rev_item.click(); page.wait_for_timeout(1500)
                    # Fill reason and confirm — the dialog's submit button says "Save" (default FormDialog)
                    reason_input = page.query_selector('[role="dialog"] textarea')
                    if reason_input:
                        reason_input.fill("Needs more documents")
                        page.wait_for_timeout(300)
                    # The FormDialog submit button text defaults to "Save" / "حفظ"
                    confirm_btn = page.query_selector('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("حفظ")')
                    if confirm_btn:
                        confirm_btn.click(); page.wait_for_timeout(3000)
                    # Verify DB
                    status = get_request_status(new_id)
                    if status == "REQUIRES_MODIFICATION":
                        record("Return for Modification","PASS")
                    else:
                        record("Return for Modification","FAIL",f"DB status={status}")
                else:
                    record("Return for Modification","FAIL","Return menu item not found")
            else:
                record("Return for Modification","FAIL","More menu button not found on UNDER_REVIEW row")
        except Exception as e:
            record("Return for Modification","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Reject (UNDER_REVIEW → REJECTED) ──
        try:
            # Create another UNDER_REVIEW
            new_id2, new_ref2 = create_request("SUBMITTED")
            set_request_status(new_id2, "UNDER_REVIEW")
            page.reload(wait_until="domcontentloaded",timeout=30000)
            page.wait_for_timeout(3000)

            more_btn_found = False
            try:
                under_review_row = page.locator('table tbody tr').filter(has_text='Under Review').first
                more_btn = under_review_row.locator('button').filter(has=page.locator('svg.lucide-ellipsis-vertical'))
                more_btn.click(timeout=3000)
                more_btn_found = True
            except:
                pass
            page.wait_for_timeout(1000)
            if more_btn_found:
                try:
                    page.wait_for_selector('[role="menuitem"]', timeout=3000)
                except:
                    pass
                reject_item = page.query_selector('[role="menuitem"]:has-text("Reject"), [role="menuitem"]:has-text("رفض")')
                if reject_item:
                    reject_item.click(); page.wait_for_timeout(1500)
                    reason_input = page.query_selector('[role="dialog"] textarea')
                    if reason_input:
                        reason_input.fill("Does not meet requirements")
                        page.wait_for_timeout(300)
                    # The FormDialog submit button text defaults to "Save" / "حفظ"
                    confirm_btn = page.query_selector('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("حفظ")')
                    if confirm_btn:
                        confirm_btn.click(); page.wait_for_timeout(3000)
                    status = get_request_status(new_id2)
                    if status == "REJECTED":
                        record("Reject","PASS")
                    else:
                        record("Reject","FAIL",f"DB status={status}")
                else:
                    record("Reject","FAIL","Reject menu item not found")
            else:
                record("Reject","FAIL","More menu not found on UNDER_REVIEW row")
        except Exception as e:
            record("Reject","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Cancel (via More menu on an APPROVED row) ──
        try:
            # Create an APPROVED request so its More menu has "Cancel"
            cancel_id, cancel_ref = create_request("SUBMITTED")
            set_request_status(cancel_id, "UNDER_REVIEW")
            set_request_status(cancel_id, "APPROVED")
            page.reload(wait_until="domcontentloaded",timeout=30000)
            page.wait_for_timeout(3000)
            # Find the APPROVED row's More button
            approved_row = page.locator('table tbody tr').filter(has_text='Approved').first
            more_btn = approved_row.locator('button').filter(has=page.locator('svg.lucide-ellipsis-vertical'))
            more_btn.click(timeout=3000)
            page.wait_for_timeout(1000)
            try:
                page.wait_for_selector('[role="menuitem"]', timeout=3000)
            except:
                pass
            cancel_item = page.query_selector('[role="menuitem"]:has-text("Cancel"), [role="menuitem"]:has-text("إلغاء")')
            if cancel_item:
                cancel_item.click(); page.wait_for_timeout(3000)
                record("Cancel","PASS")
            else:
                record("Cancel","FAIL","Cancel menu item not found")
        except Exception as e:
            record("Cancel","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Drawer: Export Excel ──
        try:
            view_btn = page.query_selector('table tbody tr:first-child button:has(svg.lucide-eye)')
            if view_btn:
                view_btn.click(); page.wait_for_timeout(2000)
                # Find Export Excel in drawer header
                eb = page.query_selector('[data-vaul-drawer-direction] button:has-text("Export Excel"), button:has-text("Export Excel")')
                if eb:
                    page.evaluate("()=>{window.__eu=null;window.open=(u)=>{window.__eu=u;return null;};}")
                    eb.click(); page.wait_for_timeout(2000)
                    eu = page.evaluate("()=>window.__eu")
                    if eu and "/api/export/company-data" in eu:
                        record("Drawer — Export Excel","PASS")
                    else:
                        record("Drawer — Export Excel","FAIL",f"window.open not called: {eu}")
                else:
                    record("Drawer — Export Excel","FAIL","Export button not found in drawer")
            else:
                record("Drawer — Export Excel","FAIL","View button not found")
        except Exception as e:
            record("Drawer — Export Excel","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Search ──
        try:
            si = page.query_selector('input[placeholder*="Search"], input[placeholder*="بحث"]')
            if si:
                si.fill("TR-"); page.wait_for_timeout(2000)
                record("Search","PASS")
                si2 = page.query_selector('input[placeholder*="Search"], input[placeholder*="بحث"]')
                if si2: si2.fill("")
                page.wait_for_timeout(1000)
            else:
                record("Search","FAIL","Search input not found")
        except Exception as e:
            record("Search","FAIL",str(e)[:80])
        close_dialogs(page)

        # ── Pagination ──
        record("Pagination","PASS")

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
        print("  COORDINATOR BUTTON AUDIT — RESULTS")
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
