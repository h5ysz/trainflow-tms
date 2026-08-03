#!/usr/bin/env python3
"""Convert each sheet of an .xlsx file to a PNG screenshot.

Uses LibreOffice headless to convert xlsx → PDF, then pdftoppm to convert
each PDF page to a PNG. Each sheet becomes one PNG.

Usage:
    python3 render_excel_screenshots.py <xlsx_path> <output_dir> [name_prefix]
"""
import os
import sys
import subprocess
import shutil
import glob

# Ensure user-local pip packages are importable
sys.path.insert(0, os.path.expanduser("~/.local/lib/python3.13/site-packages"))

def main():
    if len(sys.argv) < 3:
        print("Usage: render_excel_screenshots.py <xlsx_path> <output_dir> [name_prefix]")
        sys.exit(1)
    xlsx_path = os.path.abspath(sys.argv[1])
    out_dir = os.path.abspath(sys.argv[2])
    prefix = sys.argv[3] if len(sys.argv) > 3 else "sheet"
    os.makedirs(out_dir, exist_ok=True)

    if not os.path.exists(xlsx_path):
        print(f"❌ xlsx not found: {xlsx_path}")
        sys.exit(1)

    # Step 1: convert xlsx → pdf via LibreOffice headless
    print(f"→ Converting {xlsx_path} → PDF via LibreOffice…")
    # Use a temp dir for the PDF
    tmp_dir = os.path.join(out_dir, "_tmp_lo")
    os.makedirs(tmp_dir, exist_ok=True)
    cmd = [
        "libreoffice", "--headless", "--norestore", "--nolockcheck",
        "--convert-to", "pdf",
        "--outdir", tmp_dir,
        xlsx_path,
    ]
    env = os.environ.copy()
    # LibreOffice sometimes needs HOME set
    env["HOME"] = env.get("HOME", "/tmp")
    result = subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=120)
    if result.returncode != 0:
        print(f"❌ LibreOffice failed: {result.stderr}")
        sys.exit(1)
    pdf_name = os.path.splitext(os.path.basename(xlsx_path))[0] + ".pdf"
    pdf_path = os.path.join(tmp_dir, pdf_name)
    if not os.path.exists(pdf_path):
        print(f"❌ PDF not found at {pdf_path}")
        print(f"   Contents of tmp dir: {os.listdir(tmp_dir)}")
        sys.exit(1)
    print(f"  ✓ {pdf_path} ({os.path.getsize(pdf_path)} bytes)")

    # Step 2: convert PDF → PNGs (one per page) via pdftoppm
    print(f"→ Converting PDF → PNGs (one per page/sheet)…")
    out_prefix = os.path.join(tmp_dir, "page")
    cmd = ["pdftoppm", "-r", "150", "-png", pdf_path, out_prefix]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
    if result.returncode != 0:
        print(f"❌ pdftoppm failed: {result.stderr}")
        sys.exit(1)
    pages = sorted(glob.glob(out_prefix + "-*.png"))
    print(f"  ✓ Generated {len(pages)} page PNGs")

    # Step 3: rename + move to out_dir with friendly names
    # We'll inspect the xlsx to get sheet names
    import openpyxl
    wb = openpyxl.load_workbook(xlsx_path, data_only=False)
    sheet_names = wb.sheetnames
    print(f"  Sheet names: {sheet_names}")

    # PDF page order may not match sheet order if a sheet spans multiple pages.
    # Best-effort: assign sheet names to first N pages, extra pages get suffix.
    final_files = []
    for i, page_path in enumerate(pages):
        if i < len(sheet_names):
            sheet_name = sheet_names[i]
            # sanitize
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in sheet_name)[:30]
        else:
            safe = f"extra_{i - len(sheet_names) + 1}"
        out_path = os.path.join(out_dir, f"{prefix}-{i+1:02d}-{safe}.png")
        shutil.copy2(page_path, out_path)
        final_files.append(out_path)
        print(f"  ✓ {out_path}")

    # Cleanup tmp
    shutil.rmtree(tmp_dir, ignore_errors=True)
    print(f"\n✅ {len(final_files)} screenshots saved to {out_dir}/")


if __name__ == "__main__":
    main()
