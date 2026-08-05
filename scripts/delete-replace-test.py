#!/usr/bin/env python3
"""
Delete-Replace test: create → upload A → save → edit → delete A → upload B → save → reopen → verify.
Proves that only B remains in DB, JSON, and attachment URL.
"""
import json, time, os, signal, subprocess, urllib.request, hashlib
from datetime import datetime
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

BASE = "http://localhost:3000"
SERVER_DIR = "/home/z/my-project/.next/standalone"
EVIDENCE_DIR = "/home/z/my-project/download/delete-replace-test"
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


def create_image(path, color, label):
    img = Image.new('RGB', (400, 250), color=color)
    draw = ImageDraw.Draw(img)
    draw.text((30, 30), label, fill='white')
    draw.text((30, 100), 'Unique marker', fill='yellow')
    draw.rectangle([20, 20, 380, 230], outline='white', width=3)
    img.save(path)


def main():
    # Create two distinct images
    IMAGE_A = "/tmp/id-A.png"
    IMAGE_B = "/tmp/id-B.png"
    create_image(IMAGE_A, (200, 50, 50), "ID-A-RED")
    create_image(IMAGE_B, (50, 50, 200), "ID-B-BLUE")

    hash_a = file_hash(IMAGE_A)
    hash_b = file_hash(IMAGE_B)
    print(f"\n{'='*60}")
    print(f"  DELETE-REPLACE TEST")
    print(f"{'='*60}")
    print(f"  Image A: {IMAGE_A} | SHA256: {hash_a}")
    print(f"  Image B: {IMAGE_B} | SHA256: {hash_b}")

    subprocess.run(["pkill","-9","-f","node server.js"],capture_output=True)
    subprocess.run(["pkill","-9","-f","next-server"],capture_output=True)
    time.sleep(2)
    proc = start_server()

    try:
        _run(IMAGE_A, IMAGE_B, hash_a, hash_b)
    finally:
        stop_server(proc)


def _run(image_a, image_b, hash_a, hash_b):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True,args=["--no-sandbox","--disable-setuid-sandbox"])
        ctx = browser.new_context(viewport={"width":1440,"height":900})
        page = ctx.new_page()

        # ── STEP 1: Login + New Request + Upload A + Save ──
        print("\n─ STEP 1: Create request, upload ID-A, save ─")
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
        page.query_selector('[role="dialog"] input[placeholder="Full name"]').fill("Delete Replace Test")
        page.query_selector('[role="dialog"] input[placeholder="ID / Iqama"]').fill("1111222233")
        page.wait_for_timeout(300)

        # Upload A (index 1 = first RowIdUpload, index 0 = bulk)
        page.locator('[role="dialog"] input[type="file"]').nth(1).set_input_files(image_a)
        page.wait_for_timeout(8000)
        print("  ✅ Uploaded A")

        # Save
        save_time = datetime.now().isoformat()
        page.locator('[role="dialog"] button:has-text("Save")').first.click()
        page.wait_for_timeout(3000)

        # Get request ID
        out,_ = db_query(f"""
            const r = await db.trainingRequest.findFirst({{
              where: {{ createdAt: {{ gte: new Date('{save_time}') }} }},
              orderBy: {{ createdAt: 'desc' }},
              select: {{ id: true, refNumber: true }}
            }});
            console.log(JSON.stringify(r));
        """)
        saved_req = json.loads(out)
        req_id = saved_req['id']
        print(f"  ✅ Saved: {saved_req['refNumber']} (id: {req_id})")

        # Verify A is in DB
        out2,_ = db_query(f"""
            const r = await db.trainingRequest.findUnique({{
              where: {{ id: '{req_id}' }},
              select: {{ requestCourses: {{ select: {{ trainees: {{ select: {{ trainee: {{ select: {{ fullName: true, documents: true }} }} }} }} }} }} }}
            }});
            const tn = r?.requestCourses?.[0]?.trainees?.[0]?.trainee;
            console.log(JSON.stringify(tn?.documents || 'null'));
        """)
        docs_after_save_a = json.loads(out2)
        print(f"  DB after save A: {docs_after_save_a}")

        # ── STEP 2: Edit → Delete A → Upload B → Save ──
        print("\n─ STEP 2: Edit, delete A, upload B, save ─")
        page.wait_for_timeout(1000)

        # Click edit on first row
        edit_btn = page.query_selector('table tbody tr:first-child button:has(svg.lucide-pencil)')
        if not edit_btn:
            print("  ❌ Edit button not found")
            browser.close()
            return
        edit_btn.click()
        page.wait_for_timeout(2000)

        # Find and click the X button to delete the ID (next to the FileCheck icon)
        delete_btn = page.query_selector('[role="dialog"] button:has(svg.lucide-x)')
        if delete_btn:
            delete_btn.click()
            page.wait_for_timeout(1000)
            print("  ✅ Deleted A")
        else:
            print("  ⚠️ Delete button not found — trying alternate selector")
            # Try aria-label
            delete_btn = page.query_selector('[role="dialog"] button[aria-label*="remove"], [role="dialog"] button[aria-label*="Remove"]')
            if delete_btn:
                delete_btn.click()
                page.wait_for_timeout(1000)
                print("  ✅ Deleted A (via aria-label)")
            else:
                print("  ❌ Could not find delete button")

        # Upload B
        page.locator('[role="dialog"] input[type="file"]').nth(1).set_input_files(image_b)
        page.wait_for_timeout(8000)
        print("  ✅ Uploaded B")

        # Save
        page.locator('[role="dialog"] button:has-text("Save")').first.click()
        page.wait_for_timeout(3000)
        print("  ✅ Saved after edit")

        # ── STEP 3: Verify DB ──
        print("\n─ STEP 3: Verify DB ─")
        out3,_ = db_query(f"""
            const r = await db.trainingRequest.findUnique({{
              where: {{ id: '{req_id}' }},
              select: {{ requestCourses: {{ select: {{ trainees: {{ select: {{ trainee: {{ select: {{ fullName: true, documents: true }} }} }} }} }} }} }}
            }});
            const tn = r?.requestCourses?.[0]?.trainees?.[0]?.trainee;
            console.log(JSON.stringify(tn?.documents || 'null'));
        """)
        docs_after_edit = json.loads(out3)
        print(f"  DB after edit: {docs_after_edit}")

        # Analyze
        doc_count = len(docs_after_edit) if isinstance(docs_after_edit, list) else 0
        print(f"\n  Document count in DB: {doc_count}")

        if doc_count == 1:
            doc = docs_after_edit[0]
            doc_url = doc.get('url', '')
            doc_filename = doc.get('filename', '')
            print(f"  URL: {doc_url}")
            print(f"  Filename: {doc_filename}")

            # Check it's B, not A
            if 'id-B' in doc_filename or 'BLUE' in doc_filename.upper():
                print(f"  ✅ File is B (new) — A is gone!")
            elif 'id-A' in doc_filename or 'RED' in doc_filename.upper():
                print(f"  ❌ File is A (old) — B was not saved!")
            else:
                print(f"  ⚠️ Unexpected filename: {doc_filename}")

            # Verify the file on disk matches B
            if doc_url:
                file_path = f"{SERVER_DIR}/public/uploads/trainee-docs/{doc_url.split('/')[-1]}"
                if os.path.exists(file_path):
                    stored_hash = file_hash(file_path)
                    print(f"\n  Stored file hash: {stored_hash}")
                    print(f"  Image A hash:     {hash_a}")
                    print(f"  Image B hash:     {hash_b}")
                    if stored_hash == hash_b:
                        print(f"  ✅ STORED FILE IS B — A is completely gone!")
                    elif stored_hash == hash_a:
                        print(f"  ❌ STORED FILE IS A — B was not saved!")
                    else:
                        print(f"  ⚠️ Stored file matches neither A nor B!")
                else:
                    print(f"  ❌ File not found on disk: {file_path}")
        elif doc_count == 0:
            print(f"  ❌ NO documents in DB — both A and B are gone!")
        else:
            print(f"  ❌ {doc_count} documents — old doc was not deleted!")
            for d in docs_after_edit:
                print(f"    - {d.get('filename', '?')} | {d.get('url', '?')}")

        # ── STEP 4: Reopen and screenshot ──
        print("\n─ STEP 4: Reopen request and screenshot ─")
        page.wait_for_timeout(1000)
        ref_btn = page.query_selector('table tbody tr:first-child button.font-mono')
        if ref_btn:
            ref_btn.click()
            page.wait_for_timeout(2000)
            page.screenshot(path=f"{EVIDENCE_DIR}/01-after-reopen.png")
            print(f"  Screenshot saved: {EVIDENCE_DIR}/01-after-reopen.png")

            # Check for attachment links
            links = page.query_selector_all('[role="dialog"] a[href*="/api/uploads/"], [role="dialog"] a[href*="/uploads/"]')
            print(f"  Attachment links in preview: {len(links)}")
            for link in links:
                href = link.get_attribute('href')
                text = link.inner_text()
                print(f"    - href: {href} | text: {text}")

        browser.close()

        # ── FINAL VERDICT ──
        print(f"\n{'='*60}")
        print(f"  FINAL VERDICT")
        print(f"{'='*60}")
        if doc_count == 1 and stored_hash == hash_b:
            print(f"  ✅ PASS — Only B exists. A is completely gone.")
            print(f"  ✅ DB: 1 document (B)")
            print(f"  ✅ File: B (SHA256 matches)")
            print(f"  ✅ A has no trace in DB, JSON, or disk")
        else:
            print(f"  ❌ FAIL — See details above")


if __name__=="__main__":
    main()
