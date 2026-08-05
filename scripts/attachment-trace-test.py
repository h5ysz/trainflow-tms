#!/usr/bin/env python3
"""
Single trace test: upload known image → save draft → compare 4 points:
1. Original file (SHA256 + screenshot)
2. Stored file on server (SHA256 + screenshot)
3. Direct URL in browser (screenshot)
4. What appears inside Preview (screenshot)
"""
import json, sys, time, os, signal, subprocess, urllib.request, hashlib
from datetime import datetime
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

BASE = "http://localhost:3000"
SERVER_DIR = "/home/z/my-project/.next/standalone"
TEST_IMAGE = "/tmp/id-test.png"
EVIDENCE_DIR = "/home/z/my-project/download/attachment-trace"
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
    # Create a distinctive test image
    img = Image.new('RGB', (400, 250), color=(200, 50, 50))
    draw = ImageDraw.Draw(img)
    draw.text((30, 30), "ID-TEST-ORIGINAL", fill='white')
    draw.text((30, 80), "Red background", fill='white')
    draw.text((30, 130), "SHA256 will verify", fill='yellow')
    draw.rectangle([20, 20, 380, 230], outline='white', width=3)
    # Draw a unique pattern
    for i in range(5):
        draw.ellipse([50 + i*60, 170, 80 + i*60, 200], fill=(255, 255, 0))
    img.save(TEST_IMAGE)
    print(f"Created test image: {TEST_IMAGE}")

    original_hash = file_hash(TEST_IMAGE)
    original_size = os.path.getsize(TEST_IMAGE)

    subprocess.run(["pkill","-9","-f","node server.js"],capture_output=True)
    subprocess.run(["pkill","-9","-f","next-server"],capture_output=True)
    time.sleep(2)
    proc = start_server()

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

        print("\n" + "="*60)
        print("  POINT 1: ORIGINAL FILE")
        print("="*60)
        print(f"  Path: {TEST_IMAGE}")
        print(f"  Size: {original_size} bytes")
        print(f"  SHA256: {original_hash}")

        # ── Login ──
        print("\n→ Login as contractor...")
        page.goto(BASE,wait_until="domcontentloaded",timeout=30000)
        page.wait_for_timeout(2000)
        page.fill('input[type="email"]',"contractor@gcclab.com")
        page.fill('input[type="password"]',"Demo@1234")
        page.click('button:has-text("Sign in")')
        page.wait_for_timeout(4000)

        # Navigate + New Request
        page.click('button:has-text("Training Requests")',timeout=10000)
        page.wait_for_timeout(2000)
        page.click('button:has-text("New Request")',timeout=5000)
        page.wait_for_timeout(1500)

        # Select course
        page.query_selector('[role="dialog"] button[role="combobox"]').click()
        page.wait_for_timeout(500)
        page.query_selector('[role="option"] >> nth=0').click()
        page.wait_for_timeout(500)

        # Add trainee row
        page.click('[role="dialog"] button:has-text("+1")')
        page.wait_for_timeout(500)
        page.query_selector('[role="dialog"] input[placeholder="Full name"]').fill("Trace Test Trainee")
        page.query_selector('[role="dialog"] input[placeholder="ID / Iqama"]').fill("5555555555")
        page.wait_for_timeout(300)

        # ── Upload ──
        print("\n→ Uploading image...")
        # Use file chooser — click the Upload button in the trainee row
        upload_btn = page.locator('[role="dialog"] button:has-text("Upload")').first
        with page.expect_file_chooser(timeout=5000) as fc:
            upload_btn.click()
        fc.value.set_files(TEST_IMAGE)
        page.wait_for_timeout(6000)  # Wait for upload + state update

        # Save as DRAFT
        print("→ Saving as DRAFT...")
        save_time = datetime.now().isoformat()
        save_btn = page.query_selector('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("حفظ")')
        save_btn.click()
        page.wait_for_timeout(3000)

        # Get the saved request
        out,_ = db_query(f"""
            const r = await db.trainingRequest.findFirst({{
              where: {{ createdAt: {{ gte: new Date('{save_time}') }} }},
              orderBy: {{ createdAt: 'desc' }},
              select: {{ id: true, refNumber: true, status: true, documents: true }}
            }});
            console.log(JSON.stringify(r));
        """)
        saved_req = json.loads(out)
        print(f"  Saved: {saved_req['refNumber']} status={saved_req['status']}")

        # ── POINT 2: DB VALUES ──
        print("\n" + "="*60)
        print("  POINT 2: DATABASE VALUES")
        print("="*60)

        # Get trainee documents
        out2,_ = db_query(f"""
            const r = await db.trainingRequest.findUnique({{
              where: {{ id: '{saved_req['id']}' }},
              select: {{
                documents: true,
                requestCourses: {{
                  select: {{
                    trainees: {{
                      select: {{
                        trainee: {{ select: {{ id: true, fullName: true, documents: true }} }}
                      }}
                    }}
                  }}
                }}
              }}
            }});
            const trainees = (r?.requestCourses || []).flatMap(rc => rc.trainees || []).map(t => t.trainee);
            console.log(JSON.stringify({{
              requestDocuments: r?.documents,
              traineeDocuments: trainees.map(t => ({{ fullName: t.fullName, documents: t.documents }}))
            }}));
        """)
        db_data = json.loads(out2)
        print(f"\n  Request-level documents (additionalDocuments):")
        print(f"    {db_data['requestDocuments']}")
        print(f"\n  Trainee documents:")
        for tn in db_data['traineeDocuments']:
            print(f"    Trainee: {tn['fullName']}")
            print(f"    documents: {tn['documents']}")

        # ── POINT 3: STORED FILE ON SERVER ──
        print("\n" + "="*60)
        print("  POINT 3: STORED FILE ON SERVER")
        print("="*60)

        # Find the uploaded file
        upload_dir = f"{SERVER_DIR}/public/uploads/trainee-docs"
        files = sorted(os.listdir(upload_dir), key=lambda f: os.path.getmtime(os.path.join(upload_dir, f)), reverse=True)
        newest_file = os.path.join(upload_dir, files[0]) if files else None

        if newest_file and os.path.exists(newest_file):
            stored_hash = file_hash(newest_file)
            stored_size = os.path.getsize(newest_file)
            print(f"  Path: {newest_file}")
            print(f"  Size: {stored_size} bytes")
            print(f"  SHA256: {stored_hash}")
            if stored_hash == original_hash:
                print(f"  ✅ HASH MATCHES ORIGINAL — file is identical")
            else:
                print(f"  ❌ HASH MISMATCH — file was modified!")
                print(f"     Original: {original_hash}")
                print(f"     Stored:   {stored_hash}")

            # Copy the stored file to evidence dir for inspection
            import shutil
            shutil.copy(newest_file, f"{EVIDENCE_DIR}/stored-file{os.path.splitext(newest_file)[1]}")
        else:
            print("  ❌ No file found in upload directory")
            stored_hash = None

        # ── POINT 4: DIRECT URL IN BROWSER ──
        print("\n" + "="*60)
        print("  POINT 4: DIRECT URL IN BROWSER")
        print("="*60)

        if newest_file:
            stored_url = f"/uploads/trainee-docs/{os.path.basename(newest_file)}"
            full_url = f"{BASE}{stored_url}"
            print(f"  URL: {full_url}")

            # Open the URL directly in the browser
            page.goto(full_url, wait_until="load", timeout=15000)
            page.wait_for_timeout(2000)
            page.screenshot(path=f"{EVIDENCE_DIR}/03-direct-url.png")
            print(f"  Screenshot saved: {EVIDENCE_DIR}/03-direct-url.png")

            # Check content-type
            content_type = page.evaluate("() => document.contentType || document.querySelector('img')?.src ? 'image' : 'unknown'")
            print(f"  Content type: {content_type}")

        # ── POINT 5: PREVIEW INSIDE SYSTEM ──
        print("\n" + "="*60)
        print("  POINT 5: PREVIEW INSIDE SYSTEM")
        print("="*60)

        # Go back to the app and open the request preview
        page.goto(BASE, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)
        if "Sign in" in page.content():
            page.fill('input[type="email"]',"contractor@gcclab.com")
            page.fill('input[type="password"]',"Demo@1234")
            page.click('button:has-text("Sign in")')
            page.wait_for_timeout(4000)
        page.click('button:has-text("Training Requests")',timeout=10000)
        page.wait_for_timeout(2000)

        # Click the first row's ref number to open preview
        ref_btn = page.query_selector('table tbody tr:first-child button.font-mono')
        if ref_btn:
            ref_btn.click()
            page.wait_for_timeout(2000)
            page.screenshot(path=f"{EVIDENCE_DIR}/04-preview-inside.png")
            print(f"  Screenshot saved: {EVIDENCE_DIR}/04-preview-inside.png")

            # Check for attachment links
            links = page.query_selector_all('[role="dialog"] a[href*="/uploads/"]')
            print(f"  Attachment links found in preview: {len(links)}")
            for link in links:
                href = link.get_attribute('href')
                text = link.inner_text()
                print(f"    - href: {href}")
                print(f"    - text: {text}")

            # If there's a link, open it
            if links:
                first_href = links[0].get_attribute('href')
                full_link_url = f"{BASE}{first_href}" if first_href.startswith("/") else first_href
                print(f"\n  Opening attachment link: {full_link_url}")
                page.goto(full_link_url, wait_until="load", timeout=15000)
                page.wait_for_timeout(2000)
                page.screenshot(path=f"{EVIDENCE_DIR}/05-attachment-opened.png")
                print(f"  Screenshot saved: {EVIDENCE_DIR}/05-attachment-opened.png")
        else:
            print("  ❌ Could not open preview")

        browser.close()

        # ── COMPARISON SUMMARY ──
        print("\n" + "="*60)
        print("  COMPARISON SUMMARY")
        print("="*60)
        print(f"\n  1. Original file:    {original_hash} ({original_size} bytes)")
        if stored_hash:
            print(f"  2. Stored on server: {stored_hash} ({stored_size} bytes) {'✅ MATCH' if stored_hash == original_hash else '❌ MISMATCH'}")
        print(f"  3. Direct URL:       see {EVIDENCE_DIR}/03-direct-url.png")
        print(f"  4. Inside Preview:   see {EVIDENCE_DIR}/04-preview-inside.png")
        print(f"  5. Attachment opened: see {EVIDENCE_DIR}/05-attachment-opened.png")


if __name__=="__main__":
    main()
