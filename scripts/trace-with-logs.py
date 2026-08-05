#!/usr/bin/env python3
"""
Trace test with console log capture — shows exact values at each step.
"""
import json, time, os, signal, subprocess, urllib.request, hashlib
from datetime import datetime
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

BASE = "http://localhost:3000"
SERVER_DIR = "/home/z/my-project/.next/standalone"
TEST_IMAGE = "/tmp/id-test.png"
EVIDENCE_DIR = "/home/z/my-project/download/attachment-trace-logs"
os.makedirs(EVIDENCE_DIR, exist_ok=True)


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

    # Get course ID
    script = "const {PrismaClient}=require('@prisma/client');const db=new PrismaClient();db.course.findFirst({select:{id:true}}).then(c=>{console.log(c.id);return db.$disconnect();});"
    r = subprocess.run(["node","-e",script],cwd="/home/z/my-project",capture_output=True,text=True,timeout=15)
    course_id = r.stdout.strip()

    try:
        _run(course_id)
    finally:
        stop_server(proc)


def _run(course_id):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True,args=["--no-sandbox","--disable-setuid-sandbox"])
        ctx = browser.new_context(viewport={"width":1440,"height":900})
        page = ctx.new_page()

        # Capture ALL console logs
        all_logs = []
        def on_console(msg):
            all_logs.append(f"[{msg.type}] {msg.text}")
        page.on("console",on_console)

        # Login
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
        page.query_selector('[role="dialog"] input[placeholder="Full name"]').fill("Trace Test")
        page.query_selector('[role="dialog"] input[placeholder="ID / Iqama"]').fill("7777777777")
        page.wait_for_timeout(300)

        # Clear logs before upload
        all_logs.clear()
        print("="*60)
        print("  CONSOLE LOGS — UPLOAD + SAVE")
        print("="*60)

        # Upload — use file chooser
        upload_btn = page.locator('[role="dialog"] button:has-text("Upload")').first
        with page.expect_file_chooser(timeout=5000) as fc:
            upload_btn.click()
        fc.value.set_files(TEST_IMAGE)

        # Wait for upload to complete
        page.wait_for_timeout(8000)

        # Print logs so far (upload phase)
        print("\n--- AFTER UPLOAD (before Save) ---")
        for log in all_logs:
            print(f"  {log}")

        # Now click Save
        all_logs.clear()
        save_btn = page.query_selector('[role="dialog"] button:has-text("Save"), [role="dialog"] button:has-text("حفظ")')
        save_btn.click()
        page.wait_for_timeout(4000)

        # Print logs from Save phase
        print("\n--- AFTER SAVE ---")
        for log in all_logs:
            print(f"  {log}")

        browser.close()


if __name__=="__main__":
    main()
