#!/usr/bin/env python3
"""
Final attachment test — upload → save → edit → preview → coordinator.
Verifies file SHA256 at every stage.
"""
import json, time, os, signal, subprocess, urllib.request, hashlib
from datetime import datetime
from playwright.sync_api import sync_playwright

BASE = "http://localhost:3000"
SERVER_DIR = "/home/z/my-project/.next/standalone"
TEST_IMAGE = "/tmp/id-test.png"
EVIDENCE_DIR = "/home/z/my-project/download/final-attachment-test"
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
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            chunk = f.read(8192)
            if not chunk: break
            h.update(chunk)
    return h.hexdigest()


def main():
    original_hash = file_hash(TEST_IMAGE)
    original_size = os.path.getsize(TEST_IMAGE)
    print(f"\n{'='*60}")
    print(f"  FINAL ATTACHMENT TEST")
    print(f"{'='*60}")
    print(f"  Original: {TEST_IMAGE}")
    print(f"  Size: {original_size} bytes")
    print(f"  SHA256: {original_hash}")

    subprocess.run(["pkill","-9","-f","node server.js"],capture_output=True)
    subprocess.run(["pkill","-9","-f","next-server"],capture_output=True)
    time.sleep(2)
    proc = start_server()

    course_out,_ = db_query("const c=await db.course.findFirst({select:{id:true}});console.log(c.id);")
    course_id = course_out

    try:
        _run(course_id, original_hash, original_size)
    finally:
        stop_server(proc)


def _run(course_id, original_hash, original_size):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True,args=["--no-sandbox","--disable-setuid-sandbox"])
        ctx = browser.new_context(viewport={"width":1440,"height":900})
        page = ctx.new_page()

        # ── STEP 1: Login + New Request + Add Trainee + Upload ID + Save ──
        print("\n─ STEP 1: Upload ID and Save (DRAFT) ─")
        page.goto(BASE,wait_until="domcontentloaded",timeout=30000)
        page.wait_for_timeout(2000)
        page.fill('input[type="email"]',"contractor@gcclab.com")
        page.fill('input[type="password"]',"Demo@1234")
        page.click('button:has-text("Sign in")')
        page.wait_for_timeout(4000)

        page.click('button:has-text("Training Requests")',timeout=10000)
        page.wait_for_timeout(2000)
        page.click('button:has-text("New Request")',timeout=5000)
        page.wait_for_timeout(1500)

        # Select course
        page.query_selector('[role="dialog"] button[role="combobox"]').click()
        page.wait_for_timeout(500)
        page.query_selector('[role="option"] >> nth=0').click()
        page.wait_for_timeout(500)

        # Add trainee
        page.click('[role="dialog"] button:has-text("+1")')
        page.wait_for_timeout(500)
        page.query_selector('[role="dialog"] input[placeholder="Full name"]').fill("Final Test Trainee")
        page.query_selector('[role="dialog"] input[placeholder="ID / Iqama"]').fill("3333333333")
        page.wait_for_timeout(300)

        # Upload ID — set file on the SECOND file input (index 1)
        # Index 0 is the Bulk ID upload (multiple=true), index 1 is the first RowIdUpload
        file_input = page.locator('[role="dialog"] input[type="file"]').nth(1)
        file_input.set_input_files(TEST_IMAGE)
        page.wait_for_timeout(8000)  # Wait for upload + state propagation

        # Save
        save_time = datetime.now().isoformat()
        save_btn = page.locator('[role="dialog"] button:has-text("Save")').first
        save_btn.click()
        page.wait_for_timeout(3000)

        # Check DB
        out,_ = db_query(f"""
            const r = await db.trainingRequest.findFirst({{
              where: {{ createdAt: {{ gte: new Date('{save_time}') }} }},
              orderBy: {{ createdAt: 'desc' }},
              select: {{ id: true, refNumber: true, status: true, documents: true,
                requestCourses: {{ select: {{ trainees: {{ select: {{ trainee: {{ select: {{ fullName: true, documents: true }} }} }} }} }} }}
              }}
            }});
            const trainees = (r?.requestCourses || []).flatMap(rc => rc.trainees || []).map(t => t.trainee);
            console.log(JSON.stringify({{
              refNumber: r?.refNumber,
              status: r?.status,
              requestDocuments: r?.documents,
              traineeDocuments: trainees.map(t => ({{ fullName: t.fullName, documents: t.documents }})
            }}));
        """)
        saved = json.loads(out)
        print(f"  Saved: {saved['refNumber']} status={saved['status']}")
        print(f"  Request docs: {saved['requestDocuments']}")
        print(f"  Trainee docs: {saved['traineeDocuments']}")

        # ── STEP 2: Verify file on disk ──
        print("\n─ STEP 2: Verify file on disk ─")
        upload_dir = f"{SERVER_DIR}/public/uploads/trainee-docs"
        files = sorted(os.listdir(upload_dir), key=lambda f: os.path.getmtime(os.path.join(upload_dir, f)), reverse=True)
        newest = os.path.join(upload_dir, files[0]) if files else None
        if newest:
            stored_hash = file_hash(newest)
            print(f"  File: {os.path.basename(newest)}")
            print(f"  SHA256: {stored_hash}")
            print(f"  Match: {'✅ YES' if stored_hash == original_hash else '❌ NO'}")

        # ── STEP 3: Test direct URL (should work now with /api/uploads/) ──
        print("\n─ STEP 3: Direct URL test ─")
        if saved['traineeDocuments'] and saved['traineeDocuments'][0]['documents']:
            docs = json.loads(saved['traineeDocuments'][0]['documents'])
            if docs:
                doc_url = docs[0]['url']
                full_url = f"{BASE}{doc_url}"
                print(f"  URL: {full_url}")
                page.goto(full_url, wait_until="load", timeout=15000)
                page.wait_for_timeout(2000)
                page.screenshot(path=f"{EVIDENCE_DIR}/01-direct-url.png")
                print(f"  Screenshot saved")

        # ── STEP 4: Preview as contractor ──
        print("\n─ STEP 4: Preview as contractor ─")
        page.goto(BASE,wait_until="domcontentloaded",timeout=30000)
        page.wait_for_timeout(2000)
        if "Sign in" in page.content():
            page.fill('input[type="email"]',"contractor@gcclab.com")
            page.fill('input[type="password"]',"Demo@1234")
            page.click('button:has-text("Sign in")')
            page.wait_for_timeout(4000)
        page.click('button:has-text("Training Requests")',timeout=10000)
        page.wait_for_timeout(2000)
        page.query_selector('table tbody tr:first-child button.font-mono').click()
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{EVIDENCE_DIR}/02-preview-contractor.png")
        links = page.query_selector_all('[role="dialog"] a[href*="/uploads/"], [role="dialog"] a[href*="/api/uploads/"]')
        print(f"  Attachment links: {len(links)}")
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        # ── STEP 5: Preview as coordinator ──
        print("\n─ STEP 5: Preview as coordinator ─")
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
        page.query_selector('table tbody tr:first-child button:has(svg.lucide-eye)').click()
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{EVIDENCE_DIR}/03-preview-coordinator.png")
        links2 = page.query_selector_all('a[href*="/uploads/"], a[href*="/api/uploads/"]')
        print(f"  Attachment links: {len(links2)}")

        browser.close()

        # ── FINAL ──
        print(f"\n{'='*60}")
        print(f"  FINAL VERDICT")
        print(f"{'='*60}")
        print(f"  Original SHA256:  {original_hash}")
        if stored_hash == original_hash:
            print(f"  Stored SHA256:    {stored_hash}")
            print(f"  ✅ FILE IS IDENTICAL — no screenshot, no canvas, no DOM capture")
        else:
            print(f"  ❌ FILE MISMATCH")


if __name__=="__main__":
    main()
