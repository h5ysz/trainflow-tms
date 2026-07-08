"""Process the official GCCLAB logo (uploaded by user) into 3 production assets:

1. public/gcclab-logo-official.png  — Official logo AS-IS (for light backgrounds)
2. public/gcclab-logo-white.png     — White version (all non-transparent pixels → white)
                                       For use on burgundy login/register panels
3. public/gcclab-icon.png           — Icon version (cropped square from left badge area
                                       if present, else full logo on burgundy square)

Strategy:
- Source: /home/z/my-project/upload/pasted_image_1783549805736.png (310x150 RGBA)
- Preserve the exact official design — do NOT replace with a synthetic SVG.
- For the white version: walk every pixel; if alpha > 0, set RGB to (255, 255, 255).
  This preserves the shape/transparency of the official logo while making it visible
  on dark/burgundy backgrounds.
- For the icon: detect if the logo has a recognizable left badge (square/circle on the left).
  If not, generate a square 128x128 favicon by placing the white version centered on a
  burgundy rounded square.
"""
from PIL import Image, ImageDraw, ImageFilter
from pathlib import Path
import numpy as np
import shutil

UPLOAD = Path("/home/z/my-project/upload/pasted_image_1783549805736.png")
PUBLIC = Path("/home/z/my-project/public")
DOWNLOAD = Path("/home/z/my-project/download")
DOWNLOAD.mkdir(parents=True, exist_ok=True)

# === Step 1: Copy official logo AS-IS ===
print("[1/3] Installing official logo as gcclab-logo-official.png ...")
official_src = Image.open(UPLOAD).convert("RGBA")
print(f"  Source size: {official_src.size}, mode: {official_src.mode}")

# Save with maximum quality (lossless PNG)
official_src.save(PUBLIC / "gcclab-logo-official.png", optimize=True)
print(f"  Saved: {PUBLIC}/gcclab-logo-official.png ({official_src.size})")

# Also save an SVG wrapper for the official logo (so we have an SVG version too)
# This embeds the PNG as base64 — gives us an SVG reference while preserving the official pixels
import base64
png_b64 = base64.b64encode(open(UPLOAD, "rb").read()).decode("ascii")
svg_wrapper = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  viewBox="0 0 {official_src.size[0]} {official_src.size[1]}" width="{official_src.size[0]}" height="{official_src.size[1]}">
  <title>GCCLAB Official Logo</title>
  <image xlink:href="data:image/png;base64,{png_b64}"
    x="0" y="0" width="{official_src.size[0]}" height="{official_src.size[1]}" />
</svg>
'''
(PUBLIC / "gcclab-logo.svg").write_text(svg_wrapper)
print(f"  Saved: {PUBLIC}/gcclab-logo.svg (PNG-embedded wrapper)")

# === Step 2: Create white version ===
print("\n[2/3] Creating white version for burgundy backgrounds ...")
arr = np.array(official_src)
# Where alpha > 0, set RGB to white; keep alpha as-is
white_arr = arr.copy()
mask = arr[:, :, 3] > 0
white_arr[mask, 0] = 255  # R
white_arr[mask, 1] = 255  # G
white_arr[mask, 2] = 255  # B
# alpha unchanged

white_img = Image.fromarray(white_arr, "RGBA")
white_img.save(PUBLIC / "gcclab-logo-white.png", optimize=True)
print(f"  Saved: {PUBLIC}/gcclab-logo-white.png ({white_img.size})")

# Also write SVG wrapper for white version
white_b64 = base64.b64encode(open(PUBLIC / "gcclab-logo-white.png", "rb").read()).decode("ascii")
white_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  viewBox="0 0 {white_img.size[0]} {white_img.size[1]}" width="{white_img.size[0]}" height="{white_img.size[1]}">
  <title>GCCLAB Logo (White)</title>
  <image xlink:href="data:image/png;base64,{white_b64}"
    x="0" y="0" width="{white_img.size[0]}" height="{white_img.size[1]}" />
</svg>
'''
(PUBLIC / "gcclab-logo-white.svg").write_text(white_svg)
print(f"  Saved: {PUBLIC}/gcclab-logo-white.svg (PNG-embedded wrapper)")

# === Step 3: Create icon version ===
print("\n[3/3] Creating icon version (for sidebar/favicon) ...")
# Strategy: place the white logo centered on a burgundy rounded square.
# This way both the dark text and burgundy elements are visible (as white silhouette).

ICON_SIZE = 128
icon = Image.new("RGBA", (ICON_SIZE, ICON_SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(icon)

# Burgundy background with rounded corners
PADDING = 8
draw.rounded_rectangle(
    [0, 0, ICON_SIZE - 1, ICON_SIZE - 1],
    radius=24,
    fill=(123, 30, 43, 255),  # GCCLAB burgundy
)

# Place white logo centered, scaled to fit
logo_w, logo_h = white_img.size
max_w = ICON_SIZE - 2 * PADDING - 8  # leave some breathing room
max_h = ICON_SIZE - 2 * PADDING - 8
scale = min(max_w / logo_w, max_h / logo_h)
new_w = int(logo_w * scale)
new_h = int(logo_h * scale)
white_resized = white_img.resize((new_w, new_h), Image.LANCZOS)

# Center
offset_x = (ICON_SIZE - new_w) // 2
offset_y = (ICON_SIZE - new_h) // 2
icon.paste(white_resized, (offset_x, offset_y), white_resized)

icon.save(PUBLIC / "gcclab-icon.png", optimize=True)
print(f"  Saved: {PUBLIC}/gcclab-icon.png ({ICON_SIZE}x{ICON_SIZE})")

# Also save the SVG version of the icon
icon_b64 = base64.b64encode(open(PUBLIC / "gcclab-icon.png", "rb").read()).decode("ascii")
icon_svg = f'''<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  viewBox="0 0 {ICON_SIZE} {ICON_SIZE}" width="{ICON_SIZE}" height="{ICON_SIZE}">
  <title>GCCLAB Icon</title>
  <image xlink:href="data:image/png;base64,{icon_b64}"
    x="0" y="0" width="{ICON_SIZE}" height="{ICON_SIZE}" />
</svg>
'''
(PUBLIC / "gcclab-icon.svg").write_text(icon_svg)
print(f"  Saved: {PUBLIC}/gcclab-icon.svg (PNG-embedded wrapper)")

# === Verification: render side-by-side preview ===
print("\n[Verification] Generating side-by-side preview ...")
PREVIEW_W, PREVIEW_H = 1400, 600
preview = Image.new("RGB", (PREVIEW_W, PREVIEW_H), (240, 240, 240))
draw = ImageDraw.Draw(preview)

# Panel 1: Official logo on white
draw.rectangle([20, 80, 460, 280], fill=(255, 255, 255), outline=(200, 200, 200))
official_resized = official_src.resize((400, 193))
preview.paste(official_resized, (40, 110), official_resized)
draw.text((40, 50), "Official Logo on WHITE", fill=(40, 40, 40))
draw.text((40, 290), "Sidebar / Mobile / Light backgrounds", fill=(100, 100, 100))

# Panel 2: Official logo on burgundy (shows the problem)
draw.rectangle([480, 80, 920, 280], fill=(123, 30, 43))
official_on_burg = official_src.resize((400, 193))
preview.paste(official_on_burg, (500, 110), official_on_burg)
draw.text((500, 50), "Official Logo on BURGUNDY", fill=(180, 30, 30))
draw.text((500, 290), "PROBLEM: Burgundy elements disappear", fill=(180, 30, 30))

# Panel 3: White version on burgundy (the fix)
draw.rectangle([940, 80, 1380, 280], fill=(123, 30, 43))
white_resized_prev = white_img.resize((400, 193))
preview.paste(white_resized_prev, (960, 110), white_resized_prev)
draw.text((960, 50), "White Version on BURGUNDY", fill=(30, 130, 50))
draw.text((960, 290), "FIX: All elements visible as white silhouette", fill=(30, 130, 50))

# Panel 4: Icon
draw.rectangle([20, 360, 220, 560], fill=(255, 255, 255), outline=(200, 200, 200))
icon_resized = icon.resize((160, 160))
preview.paste(icon_resized, (40, 380), icon_resized)
draw.text((40, 330), "Icon (sidebar/favicon)", fill=(40, 40, 40))

# Panel 5: Icon on white card
draw.rectangle([480, 360, 680, 560], fill=(245, 245, 245), outline=(200, 200, 200))
icon_resized2 = icon.resize((160, 160))
preview.paste(icon_resized2, (500, 380), icon_resized2)
draw.text((500, 330), "Icon on light card", fill=(40, 40, 40))

# Panel 6: Logo + Arabic name mockup
draw.rectangle([940, 360, 1380, 560], fill=(255, 255, 255), outline=(200, 200, 200))
icon_resized3 = icon.resize((100, 100))
preview.paste(icon_resized3, (960, 380), icon_resized3)
draw.text((1080, 400), "GCC Lab", fill=(40, 40, 40))
draw.text((1080, 430), "Training Management", fill=(140, 140, 140))
draw.text((1080, 470), "المختبر الخليجي", fill=(40, 40, 40))
draw.text((940, 330), "Sidebar brand block", fill=(40, 40, 40))

# Title
draw.text((20, 20), "GCCLAB Official Logo — Asset Verification", fill=(20, 20, 20))

preview_path = DOWNLOAD / "official-logo-verification.png"
preview.save(preview_path)
print(f"\nPreview saved: {preview_path}")

# Print file sizes
print("\nFinal asset sizes:")
for f in ["gcclab-logo-official.png", "gcclab-logo-white.png", "gcclab-icon.png",
          "gcclab-logo.svg", "gcclab-logo-white.svg", "gcclab-icon.svg"]:
    p = PUBLIC / f
    if p.exists():
        print(f"  {f}: {p.stat().st_size:,} bytes")
