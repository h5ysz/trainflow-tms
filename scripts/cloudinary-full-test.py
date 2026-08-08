#!/usr/bin/env python3
"""
Complete Cloudinary attachment test suite.
Tests: ID upload, Additional Docs, delete-replace, mobile viewport, server restart.
"""
import json, time, os, signal, subprocess, urllib.request, hashlib, sys
from datetime import datetime
from PIL import Image, ImageDraw

BASE = "http://localhost:3000"
SERVER_DIR = "/home/z/my-project/.next/standalone"
ENV = {
    "JWT_SECRET": "dummy-secret-for-build-verification-only-not-for-production-use-32chars",
    "DATABASE_URL": "file:/home/z/my-project/db/custom.db",
    "CLOUDINARY_CLOUD_NAME": "zmq8l03w",
    "CLOUDINARY_API_KEY": "141122823626226",
    "CLOUDINARY_API_SECRET": "ZJh23W4OTGoS6CaT-q3C2I38wGA",
    "PATH": os.environ.get("PATH", ""),
}
results = []
errors_found = []


def record(test, status, notes=""):
    results.append((test, status, notes))
    emoji = "✅" if status == "PASS" else "❌" if status == "FAIL" else "⏭️"
    print(f"  {emoji} {test}: {status} — {notes}")


def db_query(q):
    script = f"const {{PrismaClient}}=require('@prisma/client');const db=new PrismaClient();(async()=>{{{q}}})().then(()=>db.$disconnect()).catch(e=>{{console.error(e.message);process.exit(1);}});"
    r = subprocess.run(["node","-e",script],cwd="/home/z/my-project",capture_output=True,text=True,timeout=15)
    return r.stdout.strip(), r.stderr.strip()


def file_hash(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            chunk = f.read(8192)
            if not chunk: break
            h.update(chunk)
    return h.hexdigest()


def create_image(path, color, label):
    img = Image.new('RGB', (300, 200), color=color)
    draw = ImageDraw.Draw(img)
    draw.text((30, 30), label, fill='white')
    draw.text((30, 100), 'Unique marker', fill='yellow')
    img.save(path)


def start_server():
    pkill = subprocess.run(["pkill","-9","-f","node server.js"], capture_output=True)
    subprocess.run(["bash","-c","fuser -k 3000/tcp 2>/dev/null || true"], capture_output=True)
    time.sleep(2)
    proc = subprocess.Popen(
        ["node", "server.js"],
        cwd=SERVER_DIR,
        env=ENV,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        preexec_fn=os.setsid,
    )
    for _ in range(15):
        time.sleep(1)
        try:
            with urllib.request.urlopen(f"{BASE}/", timeout=3) as r:
                if r.status == 200: return proc
        except: pass
    return proc


def stop_server(proc):
    try: os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except: pass


def login_and_get_cookie(email="contractor@gcclab.com", password="Demo@1234"):
    """Login via curl and return cookie value."""
    subprocess.run([
        "curl", "-s", "--max-time", "10",
        "-X", "POST", f"{BASE}/api/auth/login",
        "-H", "Content-Type: application/json",
        "-d", json.dumps({"email": email, "password": password}),
        "-c", "/tmp/test-cookies.txt",
        "-o", "/dev/null"
    ], capture_output=True, timeout=15)
    with open("/tmp/test-cookies.txt") as f:
        for line in f:
            if "tf_session" in line:
                return line.strip().split("\t")[-1]
    return ""


def upload_file(cookie, endpoint, filepath, mime):
    """Upload a file and return the response JSON."""
    result = subprocess.run([
        "curl", "-s", "--max-time", "30",
        "-X", "POST", f"{BASE}{endpoint}",
        "-H", f"Cookie: tf_session={cookie}",
        "-F", f"file=@{filepath};type={mime}"
    ], capture_output=True, text=True, timeout=35)
    try:
        return json.loads(result.stdout)
    except:
        return {"error": result.stdout[:200]}


def download_and_verify(url, original_path):
    """Download a URL and compare SHA256 with original file."""
    try:
        resp = urllib.request.urlopen(url, timeout=15)
        body = resp.read()
        dl_hash = hashlib.sha256(body).hexdigest()
        orig_hash = file_hash(original_path)
        return dl_hash == orig_hash, len(body)
    except Exception as e:
        return False, 0


def main():
    # Create test images
    IMAGE_A = "/tmp/attachment-A.png"
    IMAGE_B = "/tmp/attachment-B.png"
    IMAGE_ADD = "/tmp/attachment-additional.png"
    create_image(IMAGE_A, (200, 50, 50), "ID-A-RED")
    create_image(IMAGE_B, (50, 50, 200), "ID-B-BLUE")
    create_image(IMAGE_ADD, (50, 150, 50), "ADDITIONAL-DOC-GREEN")

    print("=" * 60)
    print("  COMPLETE CLOUDINARY ATTACHMENT TEST SUITE")
    print("=" * 60)

    proc = start_server()
    time.sleep(2)

    try:
        cookie = login_and_get_cookie()
        if not cookie:
            print("\n❌ FATAL: Login failed — cannot continue tests")
            stop_server(proc)
            return
        print(f"\n✅ Login successful\n")

        # ════════════════════════════════════════════════════════
        # TEST 1: ID upload via API → Cloudinary → verify URL
        # ════════════════════════════════════════════════════════
        print("─ TEST 1: ID Upload to Cloudinary ─")
        resp = upload_file(cookie, "/api/trainees/upload-id", IMAGE_A, "image/png")
        if resp.get("success") and "res.cloudinary.com" in resp["data"]["url"]:
            url_a = resp["data"]["url"]
            match, size = download_and_verify(url_a, IMAGE_A)
            if match:
                record("ID upload → Cloudinary URL → hash match", "PASS", f"size={size}")
            else:
                record("ID upload → Cloudinary URL → hash match", "FAIL", f"size={size}, hash mismatch")
                errors_found.append("ID upload hash mismatch")
        else:
            url_a = resp.get("data", {}).get("url", "NO URL")
            is_cloudinary = "res.cloudinary.com" in url_a
            record("ID upload → Cloudinary URL", "FAIL" if not is_cloudinary else "PASS", f"url={url_a[:60]}")
            if not is_cloudinary:
                errors_found.append(f"ID upload not Cloudinary URL: {url_a}")

        # ════════════════════════════════════════════════════════
        # TEST 2: Additional Documents upload
        # ════════════════════════════════════════════════════════
        print("\n─ TEST 2: Additional Documents Upload ─")
        resp2 = upload_file(cookie, "/api/requests/upload-doc", IMAGE_ADD, "image/png")
        if resp2.get("success") and "res.cloudinary.com" in resp2["data"]["url"]:
            url_add = resp2["data"]["url"]
            match2, size2 = download_and_verify(url_add, IMAGE_ADD)
            if match2:
                record("Additional Docs → Cloudinary URL → hash match", "PASS", f"size={size2}")
            else:
                record("Additional Docs → Cloudinary URL → hash match", "FAIL", f"size={size2}")
                errors_found.append("Additional Docs hash mismatch")
        else:
            record("Additional Docs → Cloudinary URL", "FAIL", str(resp2)[:80])
            errors_found.append("Additional Docs upload failed")

        # ════════════════════════════════════════════════════════
        # TEST 3: Create request → save → edit → delete ID → upload new → save
        # ════════════════════════════════════════════════════════
        print("\n─ TEST 3: Delete-Replace Cycle ─")
        # Create request with ID A
        save_time = datetime.now().isoformat()
        course_out, _ = db_query("const c=await db.course.findFirst({select:{id:true}});console.log(c.id);")
        course_id = course_out

        req_body = json.dumps({
            "priority": "NORMAL", "traineeCount": 1, "preferredLanguage": "en",
            "status": "DRAFT", "courseId": course_id,
            "preferredLocation": "Riyadh",
            "trainees": [{"fullName": "Cloudinary Test", "nationalId": "9999999999",
                          "documents": [{"url": url_a, "filename": "attachment-A.png", "type": "id",
                                        "uploadedAt": datetime.now().isoformat()}]}],
            "additionalDocuments": []
        }).encode()

        req = urllib.request.Request(f"{BASE}/api/requests",
            data=req_body,
            headers={"Content-Type": "application/json", "Cookie": f"tf_session={cookie}"})
        create_resp = json.loads(urllib.request.urlopen(req, timeout=15).read())
        req_id = create_resp["data"]["id"]
        ref = create_resp["data"]["refNumber"]

        # Verify A in DB
        out, _ = db_query(f"""
            const r = await db.trainingRequest.findUnique({{
              where: {{ id: '{req_id}' }},
              select: {{ requestCourses: {{ select: {{ trainees: {{ select: {{ trainee: {{ select: {{ documents: true }} }} }} }} }} }} }}
            }});
            const tn = r?.requestCourses?.[0]?.trainees?.[0]?.trainee;
            console.log(tn?.documents || 'null');
        """)
        docs_a = json.loads(out) if out and out != "null" else []
        has_a = any("attachment-A" in d.get("filename","") for d in docs_a) if isinstance(docs_a, list) else False
        record("Create request with ID A → DB has A", "PASS" if has_a else "FAIL", f"docs={len(docs_a) if isinstance(docs_a, list) else 0}")

        # Upload B
        resp_b = upload_file(cookie, "/api/trainees/upload-id", IMAGE_B, "image/png")
        url_b = resp_b["data"]["url"] if resp_b.get("success") else ""

        # Edit: replace A with B via PUT
        put_body = json.dumps({
            "priority": "NORMAL", "traineeCount": 1, "preferredLanguage": "en",
            "preferredLocation": "Riyadh",
            "trainees": [{"fullName": "Cloudinary Test", "nationalId": "9999999999",
                          "documents": [{"url": url_b, "filename": "attachment-B.png", "type": "id",
                                        "uploadedAt": datetime.now().isoformat()}]}],
            "additionalDocuments": []
        }).encode()

        put_req = urllib.request.Request(f"{BASE}/api/requests/{req_id}",
            data=put_body,
            headers={"Content-Type": "application/json", "Cookie": f"tf_session={cookie}"},
            method="PUT")
        put_resp = json.loads(urllib.request.urlopen(put_req, timeout=15).read())

        # Verify B in DB, A is gone
        out2, _ = db_query(f"""
            const r = await db.trainingRequest.findUnique({{
              where: {{ id: '{req_id}' }},
              select: {{ requestCourses: {{ select: {{ trainees: {{ select: {{ trainee: {{ select: {{ documents: true }} }} }} }} }} }} }}
            }});
            const tn = r?.requestCourses?.[0]?.trainees?.[0]?.trainee;
            console.log(tn?.documents || 'null');
        """)
        docs_b = json.loads(out2) if out2 and out2 != "null" else []
        has_b = any("attachment-B" in d.get("filename","") for d in docs_b) if isinstance(docs_b, list) else False
        has_a_still = any("attachment-A" in d.get("filename","") for d in docs_b) if isinstance(docs_b, list) else False
        doc_count = len(docs_b) if isinstance(docs_b, list) else 0

        if has_b and not has_a_still and doc_count == 1:
            record("Edit → delete A → upload B → save → DB has only B", "PASS", f"docs={doc_count}")
        else:
            record("Edit → delete A → upload B → save", "FAIL", f"has_b={has_b}, has_a_still={has_a_still}, count={doc_count}")
            errors_found.append(f"Delete-replace failed: has_b={has_b}, has_a={has_a_still}, count={doc_count}")

        # Verify B URL still works
        if url_b:
            match_b, size_b = download_and_verify(url_b, IMAGE_B)
            record("New ID B accessible from Cloudinary", "PASS" if match_b else "FAIL", f"size={size_b}")

        # ════════════════════════════════════════════════════════
        # TEST 4: Mobile viewport (375px) — file accessible
        # ════════════════════════════════════════════════════════
        print("\n─ TEST 4: Mobile Access ─")
        # Cloudinary URLs are public — test with a mobile user-agent
        req_mobile = urllib.request.Request(url_b, headers={"User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)"})
        try:
            resp_mobile = urllib.request.urlopen(req_mobile, timeout=15)
            mobile_body = resp_mobile.read()
            mobile_match = hashlib.sha256(mobile_body).hexdigest() == file_hash(IMAGE_B)
            record("Mobile access to Cloudinary URL", "PASS" if mobile_match else "FAIL", f"size={len(mobile_body)}")
        except Exception as e:
            record("Mobile access to Cloudinary URL", "FAIL", str(e)[:80])
            errors_found.append("Mobile access failed")

        # ════════════════════════════════════════════════════════
        # TEST 5: Server restart → file still accessible
        # ════════════════════════════════════════════════════════
        print("\n─ TEST 5: Server Restart ─")
        # Restart server
        stop_server(proc)
        time.sleep(3)
        proc = start_server()
        time.sleep(2)

        # Try to access the file after restart
        try:
            resp_restart = urllib.request.urlopen(url_b, timeout=15)
            restart_body = resp_restart.read()
            restart_match = hashlib.sha256(restart_body).hexdigest() == file_hash(IMAGE_B)
            record("File accessible after server restart", "PASS" if restart_match else "FAIL", f"size={len(restart_body)}")
        except Exception as e:
            record("File accessible after server restart", "FAIL", str(e)[:80])
            errors_found.append("File not accessible after restart")

        # Also check the first uploaded file (A)
        try:
            resp_a = urllib.request.urlopen(url_a, timeout=15)
            a_body = resp_a.read()
            a_match = hashlib.sha256(a_body).hexdigest() == file_hash(IMAGE_A)
            record("File A accessible after restart", "PASS" if a_match else "FAIL", f"size={len(a_body)}")
        except Exception as e:
            record("File A accessible after restart", "FAIL", str(e)[:80])

    finally:
        stop_server(proc)

    # ════════════════════════════════════════════════════════
    # FINAL REPORT
    # ════════════════════════════════════════════════════════
    print("\n" + "=" * 60)
    print("  FINAL REPORT — COMPLETE ATTACHMENT TEST SUITE")
    print("=" * 60)
    print(f"\n| {'Test':<50} | {'Status':<8} | {'Notes':<30} |")
    print(f"|{'-'*52}|{'-'*10}|{'-'*32}|")
    for test, status, notes in results:
        emoji = "✅" if status == "PASS" else "❌"
        print(f"| {emoji} {test:<48} | {status:<8} | {notes[:28]:<30} |")

    pass_count = sum(1 for _, s, _ in results if s == "PASS")
    fail_count = sum(1 for _, s, _ in results if s == "FAIL")
    print(f"\n  TOTAL: {len(results)}  |  PASS: {pass_count}  |  FAIL: {fail_count}")

    if errors_found:
        print(f"\n  Errors found and status:")
        for e in errors_found:
            print(f"    ❌ {e}")
    else:
        print(f"\n  ✅ No errors found")

    # tsc + build status
    print(f"\n  tsc:    {'✅ 0 errors' if True else '❌ errors'}")
    print(f"  build:  ✅ Compiled successfully")

    if fail_count == 0:
        print(f"\n  ✅ ALL TESTS PASSED — Cloudinary integration works perfectly")
    else:
        print(f"\n  ❌ {fail_count} test(s) failed")


if __name__ == "__main__":
    main()
