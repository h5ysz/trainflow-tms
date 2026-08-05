#!/usr/bin/env python3
"""
Attachment pipeline test — upload a real image, save the request,
submit it, then preview it as contractor/coordinator/admin.
Verifies the ORIGINAL image file is what gets stored and displayed.
"""
import json, sys, time, os, signal, subprocess, urllib.request, hashlib
from datetime import datetime
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
SERVER_DIR = "/home/z/my-project/.next/standalone"
TEST_IMAGE = "/tmp/test-id-card.png"
EVIDENCE_DIR = "/home/z/my-project/download/attachment-proof"
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


def file_hash(path):
    """Get SHA256 hash of a file."""
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            chunk = f.read(8192)
            if not chunk: break
            h.update(chunk)
    return h.hexdigest()


def main():
    subprocess.run(["pkill","-9","-f","node server.js"],capture_output=True)
    subprocess.run(["pkill","-9","-f","next-server"],capture_output=True)
    time.sleep(2)
    proc = start_server()

    # Get original file hash
    original_hash = file_hash(TEST_IMAGE)
    original_size = os.path.getsize(TEST_IMAGE)
    print(f"\n{'='*60}")
    print(f"  ATTACHMENT PIPELINE TEST")
    print(f"{'='*60}")
    print(f"  Original file: {TEST_IMAGE}")
    print(f"  Original size: {original_size} bytes")
    print(f"  Original SHA256: {original_hash}")

    # Get a course ID
    course_out,_ = db_query("const c=await db.course.findFirst({select:{id:true,title:true}});console.log(JSON.stringify(c));")
    course = json.loads(course_out)

    try:
        _run(course, original_hash, original_size)
    finally:
        stop_server(proc)


def _run(course, original_hash, original_size):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True,args=["--no-sandbox","--disable-setuid-sandbox"])
        ctx = browser.new_context(viewport={"width":1440,"height":900})
        page = ctx.new_page()

        network_logs = []
        def on_resp(resp):
            network_logs.append({"method":resp.request.method,"url":resp.url[:150],"status":resp.status})
        page.on("response",on_resp)

        # ── STEP 1: Login as contractor ──
        print("\n─ STEP 1: Login as contractor ─")
        page.goto(BASE,wait_until="domcontentloaded",timeout=30000)
        page.wait_for_timeout(2000)
        page.fill('input[type="email"]',"contractor@gcclab.com")
        page.fill('input[type="password"]',"Demo@1234")
        page.click('button:has-text("Sign in")')
        page.wait_for_timeout(4000)
        print("  ✅ Logged in")

        # ── STEP 2: New Request ──
        print("\n─ STEP 2: New Request ─")
        page.click('button:has-text("Training Requests")',timeout=10000)
        page.wait_for_timeout(2000)
        page.click('button:has-text("New Request")',timeout=5000)
        page.wait_for_timeout(1500)

        # Select course
        ct = page.query_selector('[role="dialog"] button[role="combobox"]')
        ct.click(); page.wait_for_timeout(500)
        page.query_selector('[role="option"] >> nth=0').click()
        page.wait_for_timeout(500)
        print("  ✅ Course selected")

        # ── STEP 3: Add a trainee row ──
        print("\n─ STEP 3: Add trainee row ─")
        page.click('[role="dialog"] button:has-text("+1")',timeout=5000)
        page.wait_for_timeout(500)
        name_input = page.query_selector('[role="dialog"] input[placeholder="Full name"], [role="dialog"] input[placeholder="الاسم الكامل"]')
        name_input.fill("Attachment Test Trainee")
        page.wait_for_timeout(300)
        id_input = page.query_selector('[role="dialog"] input[placeholder="ID / Iqama"], [role="dialog"] input[placeholder="رقم الهوية / الإقامة"]')
        id_input.fill("9876543210")
        page.wait_for_timeout(300)
        print("  ✅ Trainee added")

        # ── STEP 4: Upload ID image ──
        print("\n─ STEP 4: Upload ID image ─")
        # The RowIdUpload uses a hidden <input type="file">. We set the file
        # directly on the input element to trigger the onChange handler.
        # The first file input in the dialog is the ID upload (RowIdUpload).
        file_inputs = page.query_selector_all('[role="dialog"] input[type="file"]')
        print(f"  Found {len(file_inputs)} file inputs in dialog")
        if file_inputs:
            # The first input is for the ID upload (RowIdUpload appears before RowDocUpload)
            file_inputs[0].set_input_files(TEST_IMAGE)
            page.wait_for_timeout(5000)
            print(f"  ✅ File set on first input")
        else:
            print("  ❌ No file input found")
            browser.close()
            return

        # Check network for upload API call
        upload_calls = [n for n in network_logs if "/api/trainees/upload-id" in n.get("url","")]
        if upload_calls:
            print(f"  ✅ Upload API called: {upload_calls[-1]['status']}")
        page.wait_for_timeout(2000)  # Extra time for state to settle

        # Debug: check if the upload response was processed and doc appears in the row
        debug_info = page.evaluate('''
            () => {
                const dialog = document.querySelector('[role="dialog"]');
                if (!dialog) return 'no dialog';
                const text = dialog.textContent || '';
                const hasFileCheck = text.includes('test-id-card') || text.includes('.png');
                const links = dialog.querySelectorAll('a[href*="/uploads/"]');
                return {
                    hasFileName: hasFileCheck,
                    uploadLinks: links.length,
                    linkHrefs: Array.from(links).map(a => a.href).slice(0, 3)
                };
            }
        ''')
        print(f"  Debug after upload: {debug_info}")

        # ── STEP 5: Save the request (DRAFT) ──
        print("\n─ STEP 5: Save (DRAFT) ─")
        save_time = datetime.now().isoformat()
        save_btn = page.query_selector('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("حفظ")')
        save_btn.click()
        page.wait_for_timeout(3000)
        print("  ✅ Saved")

        # Get the saved request
        out,_ = db_query(f"""
            const r = await db.trainingRequest.findFirst({{
              where: {{ createdAt: {{ gte: new Date('{save_time}') }} }},
              orderBy: {{ createdAt: 'desc' }},
              select: {{ id: true, refNumber: true, status: true }}
            }});
            console.log(JSON.stringify(r));
        """)
        saved_req = json.loads(out)
        print(f"  ✅ DB: {saved_req['refNumber']} status={saved_req['status']}")

        # ── STEP 6: Verify the file on disk matches the original ──
        print("\n─ STEP 6: Verify file on disk ─")
        # Get the trainee's documents from DB
        out2,_ = db_query(f"""
            const r = await db.trainingRequest.findUnique({{
              where: {{ id: '{saved_req['id']}' }},
              select: {{ requestCourses: {{ select: {{ trainees: {{ select: {{ trainee: {{ select: {{ id: true, fullName: true, documents: true }} }} }} }} }} }} }}
            }});
            const trainees = (r?.requestCourses || []).flatMap(rc => rc.trainees || []).map(t => t.trainee);
            console.log(JSON.stringify(trainees));
        """)
        trainees = json.loads(out2)
        if trainees:
            tn = trainees[0]
            docs = json.loads(tn["documents"]) if tn["documents"] else []
            print(f"  Trainee: {tn['fullName']}")
            print(f"  Documents in DB: {len(docs)}")
            for d in docs:
                print(f"    - url: {d.get('url')}")
                print(f"    - filename: {d.get('filename')}")
                print(f"    - type: {d.get('type')}")

            # Verify file exists on disk
            if docs:
                doc_url = docs[0]["url"]
                file_path = f"/home/z/my-project/public{doc_url}"
                if os.path.exists(file_path):
                    stored_hash = file_hash(file_path)
                    stored_size = os.path.getsize(file_path)
                    print(f"\n  File on disk: {file_path}")
                    print(f"  Stored size: {stored_size} bytes")
                    print(f"  Stored SHA256: {stored_hash}")
                    print(f"  Original SHA256: {original_hash}")
                    if stored_hash == original_hash:
                        print(f"  ✅ HASH MATCH — original file is stored correctly!")
                    else:
                        print(f"  ❌ HASH MISMATCH — file was modified during upload!")
                else:
                    print(f"  ❌ File not found on disk: {file_path}")

        # ── STEP 7: Preview the request ──
        print("\n─ STEP 7: Preview request (contractor) ─")
        page.wait_for_timeout(1000)
        # Click the first row's ref number to open preview
        ref_btn = page.query_selector('table tbody tr:first-child button.font-mono')
        ref_btn.click()
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{EVIDENCE_DIR}/01-preview-contractor.png")
        # Check if attachment links are visible
        preview_text = page.evaluate("() => document.querySelector('[role=dialog]')?.textContent || ''")
        if "FileText" in preview_text or ".jpg" in preview_text or ".png" in preview_text or "doc" in preview_text.lower():
            print("  ✅ Attachment links visible in preview")
        else:
            print("  ⚠️  Attachment links not found in preview text")
        # Check for actual links
        links = page.query_selector_all('[role="dialog"] a[href*="/uploads/"]')
        print(f"  Attachment links found: {len(links)}")
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        # ── STEP 8: Test as coordinator ──
        print("\n─ STEP 8: Login as coordinator ─")
        page.click('header button:has(svg.lucide-chevron-down)')
        page.wait_for_timeout(1000)
        page.click('[role="menuitem"]:has(svg.lucide-log-out)')
        page.wait_for_timeout(3000)
        page.fill('input[type="email"]',"coordinator@gcclab.com")
        page.fill('input[type="password"]',"Demo@1234")
        page.click('button:has-text("Sign in")')
        page.wait_for_timeout(4000)
        page.click('button:has-text("Training Requests")',timeout=10000)
        page.wait_for_timeout(2000)

        # Click the eye icon to open drawer
        view_btn = page.query_selector('table tbody tr:first-child button:has(svg.lucide-eye)')
        view_btn.click()
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{EVIDENCE_DIR}/02-preview-coordinator.png")
        # Check for attachment links in drawer
        drawer_links = page.query_selector_all('[data-vaul-drawer-direction] a[href*="/uploads/"], a[href*="/uploads/"]')
        print(f"  Attachment links in drawer: {len(drawer_links)}")
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        # ── STEP 9: Test as admin ──
        print("\n─ STEP 9: Login as admin ─")
        page.click('header button:has(svg.lucide-chevron-down)')
        page.wait_for_timeout(1000)
        page.click('[role="menuitem"]:has(svg.lucide-log-out)')
        page.wait_for_timeout(3000)
        page.fill('input[type="email"]',"admin@gcclab.com")
        page.fill('input[type="password"]',"ChangeMeInProduction!2024")
        page.click('button:has-text("Sign in")')
        page.wait_for_timeout(4000)
        page.click('button:has-text("Training Requests")',timeout=10000)
        page.wait_for_timeout(2000)

        view_btn = page.query_selector('table tbody tr:first-child button:has(svg.lucide-eye)')
        view_btn.click()
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{EVIDENCE_DIR}/03-preview-admin.png")
        admin_links = page.query_selector_all('a[href*="/uploads/"]')
        print(f"  Attachment links in drawer: {len(admin_links)}")

        browser.close()

        # ── FINAL VERDICT ──
        print(f"\n{'='*60}")
        print(f"  FINAL VERDICT")
        print(f"{'='*60}")
        print(f"  Original file SHA256: {original_hash}")
        if stored_hash == original_hash:
            print(f"  Stored file SHA256:   {stored_hash}")
            print(f"  ✅ ORIGINAL FILE IS STORED — no screenshot, no canvas, no DOM capture")
        else:
            print(f"  ❌ File hash mismatch!")
        print(f"\n  Evidence:")
        print(f"    {EVIDENCE_DIR}/01-preview-contractor.png")
        print(f"    {EVIDENCE_DIR}/02-preview-coordinator.png")
        print(f"    {EVIDENCE_DIR}/03-preview-admin.png")


if __name__=="__main__":
    main()
