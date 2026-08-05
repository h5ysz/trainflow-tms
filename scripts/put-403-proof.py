#!/usr/bin/env python3
"""
PUT 403 definitive test — clean scenario from scratch.
Login as contractor → New Request → Save (DRAFT) → Edit → Save → verify PUT 200 + DB.
Captures screenshots, network logs, and DB state at every step.
"""
import json, sys, time, os, signal, subprocess, urllib.request
from datetime import datetime
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
SERVER_DIR = "/home/z/my-project/.next/standalone"
EVIDENCE_DIR = "/home/z/my-project/download/put-403-proof"
os.makedirs(EVIDENCE_DIR, exist_ok=True)


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


def main():
    subprocess.run(["pkill","-9","-f","node server.js"],capture_output=True)
    subprocess.run(["pkill","-9","-f","next-server"],capture_output=True)
    time.sleep(2)
    proc = start_server()

    # Get a course ID
    course_out,_ = db_query("const c=await db.course.findFirst({select:{id:true,title:true}});console.log(JSON.stringify(c));")
    course = json.loads(course_out)
    print(f"Using course: {course['title']} ({course['id']})")

    try:
        _run(course)
    finally:
        stop_server(proc)


def _run(course):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True,args=["--no-sandbox","--disable-setuid-sandbox"])
        ctx = browser.new_context(viewport={"width":1440,"height":900})
        page = ctx.new_page()

        # Capture ALL network requests
        network_logs = []
        def on_request(req):
            network_logs.append({"type":"request","method":req.method,"url":req.url[:150]})
        def on_response(resp):
            network_logs.append({"type":"response","method":resp.request.method,"url":resp.url[:150],"status":resp.status})
        page.on("request",on_request)
        page.on("response",on_response)

        # ── STEP 1: Login ──
        print("\n─ STEP 1: Login as contractor ─")
        page.goto(BASE,wait_until="domcontentloaded",timeout=30000)
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{EVIDENCE_DIR}/01-login.png")
        page.fill('input[type="email"]',"contractor@gcclab.com")
        page.fill('input[type="password"]',"Demo@1234")
        page.click('button:has-text("Sign in")')
        page.wait_for_timeout(4000)
        page.screenshot(path=f"{EVIDENCE_DIR}/02-logged-in.png")
        print("  ✅ Logged in")

        # ── STEP 2: Navigate to Training Requests ──
        print("\n─ STEP 2: Navigate to Training Requests ─")
        page.click('button:has-text("Training Requests")',timeout=10000)
        page.wait_for_timeout(2000)
        page.wait_for_selector("table",timeout=10000)
        page.screenshot(path=f"{EVIDENCE_DIR}/03-requests-page.png")
        print("  ✅ On Training Requests page")

        # ── STEP 3: New Request ──
        print("\n─ STEP 3: Click New Request ─")
        page.click('button:has-text("New Request")',timeout=5000)
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{EVIDENCE_DIR}/04-new-request-dialog.png")
        print("  ✅ Dialog opened")

        # ── STEP 4: Select course ──
        print("\n─ STEP 4: Select course ─")
        ct = page.query_selector('[role="dialog"] button[role="combobox"]')
        if ct:
            ct.click(); page.wait_for_timeout(500)
            opt = page.query_selector('[role="option"] >> nth=0')
            if opt: opt.click(); page.wait_for_timeout(500)
        page.screenshot(path=f"{EVIDENCE_DIR}/05-course-selected.png")
        print("  ✅ Course selected")

        # ── STEP 5: Save (DRAFT) ──
        print("\n─ STEP 5: Click Save (DRAFT) ─")
        save_time = datetime.now().isoformat()
        network_start = len(network_logs)

        save_btn = page.query_selector('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("حفظ")')
        save_btn.click()
        page.wait_for_timeout(3000)

        page.screenshot(path=f"{EVIDENCE_DIR}/06-after-save.png")

        # Find the POST /api/requests in network logs
        save_network = network_logs[network_start:]
        post_requests = [n for n in save_network if n.get("method")=="POST" and "/api/requests" in n.get("url","") and "transition" not in n.get("url","") and "upload" not in n.get("url","")]
        post_status = next((n.get("status") for n in post_requests if n.get("type")=="response"), None)
        print(f"  POST /api/requests → HTTP {post_status}")

        # Get the created request from DB
        out,_ = db_query(f"""
            const r = await db.trainingRequest.findFirst({{
              where: {{ createdAt: {{ gte: new Date('{save_time}') }} }},
              orderBy: {{ createdAt: 'desc' }},
              select: {{ id: true, refNumber: true, status: true, notes: true }}
            }});
            console.log(JSON.stringify(r));
        """)
        saved_req = json.loads(out) if out and out != "null" else None
        if saved_req:
            print(f"  ✅ DB: id={saved_req['id']}, ref={saved_req['refNumber']}, status={saved_req['status']}")
        else:
            print("  ❌ No request found in DB after Save")
            browser.close()
            return

        # ── STEP 6: Open the same request with Edit (pencil) ──
        print("\n─ STEP 6: Open the request with Edit (pencil) ─")
        page.wait_for_timeout(1000)
        page.screenshot(path=f"{EVIDENCE_DIR}/07-before-edit.png")

        edit_btn = page.query_selector('table tbody tr:first-child button:has(svg.lucide-pencil)')
        if not edit_btn:
            print("  ❌ Edit button not found on first row")
            browser.close()
            return

        edit_btn.click()
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{EVIDENCE_DIR}/08-edit-dialog-open.png")
        print("  ✅ Edit dialog opened")

        # ── STEP 7: Modify a field (notes) ──
        print("\n─ STEP 7: Modify notes field ─")
        notes_before = saved_req.get("notes")
        notes_textarea = page.query_selector('[role="dialog"] textarea')
        if notes_textarea:
            notes_textarea.fill("PUT 403 proof test — modified notes")
            page.wait_for_timeout(500)
        page.screenshot(path=f"{EVIDENCE_DIR}/09-notes-modified.png")
        print(f"  Notes before: {notes_before}")
        print(f"  Notes after (UI): PUT 403 proof test — modified notes")

        # ── STEP 8: Save again (PUT) ──
        print("\n─ STEP 8: Click Save (PUT) ─")
        network_start = len(network_logs)

        save_btn2 = page.query_selector('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("حفظ")')
        if save_btn2:
            save_btn2.click()
            page.wait_for_timeout(3000)

        page.screenshot(path=f"{EVIDENCE_DIR}/10-after-put-save.png")

        # Find the PUT /api/requests/[id] in network logs
        put_network = network_logs[network_start:]
        put_requests = [n for n in put_network if n.get("method")=="PUT" and "/api/requests" in n.get("url","")]
        put_status = next((n.get("status") for n in put_requests if n.get("type")=="response"), None)
        print(f"  PUT /api/requests/{saved_req['id']} → HTTP {put_status}")

        # ── STEP 9: Verify DB ──
        print("\n─ STEP 9: Verify DB ─")
        out2,_ = db_query(f"""
            const r = await db.trainingRequest.findUnique({{
              where: {{ id: '{saved_req['id']}' }},
              select: {{ id: true, refNumber: true, status: true, notes: true, updatedAt: true }}
            }});
            console.log(JSON.stringify(r));
        """)
        updated_req = json.loads(out2) if out2 else None
        if updated_req:
            print(f"  DB after PUT:")
            print(f"    id: {updated_req['id']}")
            print(f"    refNumber: {updated_req['refNumber']}")
            print(f"    status: {updated_req['status']}")
            print(f"    notes: {updated_req['notes']}")
            print(f"    updatedAt: {updated_req['updatedAt']}")

        browser.close()

        # ── FINAL VERDICT ──
        print("\n" + "="*60)
        print("  PUT 403 DEFINITIVE TEST — VERDICT")
        print("="*60)

        put_ok = put_status == 200
        db_ok = updated_req and updated_req.get("notes") == "PUT 403 proof test — modified notes"
        status_ok = updated_req and updated_req.get("status") == "DRAFT"

        print(f"\n  PUT HTTP Status:  {put_status} {'✅' if put_ok else '❌'}")
        print(f"  DB notes updated: {'✅ YES' if db_ok else '❌ NO'}")
        print(f"  DB status still DRAFT: {'✅ YES' if status_ok else '❌ NO'}")

        if put_ok and db_ok and status_ok:
            print(f"\n  ✅ PUT 403 ISSUE CLOSED — contractor edit works correctly")
        else:
            print(f"\n  ❌ PUT 403 ISSUE CONFIRMED — needs fix")

        # Save network evidence
        with open(f"{EVIDENCE_DIR}/network-log.json","w") as f:
            json.dump(network_logs, f, indent=2)
        print(f"\n  Network log saved: {EVIDENCE_DIR}/network-log.json")
        print(f"  Screenshots: {EVIDENCE_DIR}/01-*.png through 10-*.png")


if __name__=="__main__":
    main()
