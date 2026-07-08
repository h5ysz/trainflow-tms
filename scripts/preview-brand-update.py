"""Generate a comprehensive visual preview showing all the brand updates.

Shows:
1. Burgundy panel with white logo (login/register left panel)
2. White panel with color logo (sidebar/mobile)
3. Sidebar mockup with icon + Arabic name
4. Sidebar mockup with icon + English name
5. Mobile login mockup
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

PUBLIC = Path("/home/z/my-project/public")
DOWNLOAD = Path("/home/z/my-project/download")
DOWNLOAD.mkdir(parents=True, exist_ok=True)

# Load assets
white_logo = Image.open(PUBLIC / "gcclab-logo-white.png").convert("RGBA")
color_logo = Image.open(PUBLIC / "gcclab-logo-official.png").convert("RGBA")
icon = Image.open(PUBLIC / "gcclab-icon.png").convert("RGBA")

# Fonts
try:
    font_bold_lg = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
    font_bold_md = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
    font_sm = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 14)
    font_xs = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 11)
    # Arabic font
    font_ar_bold_lg = ImageFont.truetype(
        "/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Bold.otf", 28
    )
except Exception:
    font_bold_lg = ImageFont.load_default()
    font_bold_md = ImageFont.load_default()
    font_sm = ImageFont.load_default()
    font_xs = ImageFont.load_default()
    font_ar_bold_lg = ImageFont.load_default()

# Arabic font - use IBM Plex Sans Arabic if available
try:
    ar_font_path = "/usr/share/fonts/truetype/IBM-Plex-Sans-Arabic/IBMPlexSansArabic-Bold.ttf"
    import os
    if not os.path.exists(ar_font_path):
        # Try alternatives
        for p in [
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",  # fallback
        ]:
            if os.path.exists(p):
                ar_font_path = p
                break
    font_ar_bold = ImageFont.truetype(ar_font_path, 22)
    font_ar_sm = ImageFont.truetype(ar_font_path, 13)
except Exception:
    font_ar_bold = font_bold_md
    font_ar_sm = font_sm

# === Build preview canvas ===
W, H = 1600, 1000
canvas = Image.new("RGB", (W, H), (235, 235, 238))
draw = ImageDraw.Draw(canvas)

# Title
draw.text((40, 20), "GCCLAB Brand Update — Visual Verification", fill=(40, 40, 40), font=font_bold_lg)
draw.text((40, 60), "Fix 1: Arabic name المختبر العربي → المختبر الخليجي", fill((60, 60, 60))[0] if False else (80, 80, 80), font=font_sm)
draw.text((40, 80), "Fix 2: Logo now visible on burgundy panels (white version)", fill=(80, 80, 80), font=font_sm)

# === Section 1: Burgundy panel with white logo (simulating login left panel) ===
panel_x, panel_y, panel_w, panel_h = 40, 110, 480, 320
draw.rectangle([panel_x, panel_y, panel_x + panel_w, panel_y + panel_h], fill=(123, 30, 43))

# Logo on burgundy
wl = white_logo.resize((300, 86))
canvas.paste(wl, (panel_x + 30, panel_y + 30), wl)
draw.text((panel_x + 30, panel_y + 130), "نظام إدارة التدريب والشهادات", fill=(255, 255, 255, 180), font=font_ar_sm)
draw.text((panel_x + 30, panel_y + 165), "Training & Certification Management System", fill=(255, 230, 230), font=font_xs)

# Sample headline
draw.text((panel_x + 30, panel_y + 210), "Training Management", fill=(255, 255, 255), font=font_bold_md)
draw.text((panel_x + 30, panel_y + 240), "Enterprise platform for managing corporate safety training,", fill=(255, 220, 220), font=font_xs)
draw.text((panel_x + 30, panel_y + 255), "calibration certifications, and compliance.", fill=(255, 220, 220), font=font_xs)

# Section label
draw.text((panel_x, panel_y + panel_h + 5), "Login/Register left panel — WHITE logo visible on burgundy", fill=(80, 80, 80), font=font_xs)

# === Section 2: Sidebar mockup ===
side_x, side_y, side_w, side_h = 560, 110, 280, 320
draw.rectangle([side_x, side_y, side_x + side_w, side_y + side_h], fill=(255, 255, 255), outline=(220, 220, 220))

# Sidebar brand area
icon_small = icon.resize((36, 36))
canvas.paste(icon_small, (side_x + 20, side_y + 20), icon_small)
draw.text((side_x + 65, side_y + 22), "GCC Lab", fill=(40, 40, 40), font=font_bold_md)
draw.text((side_x + 65, side_y + 42), "Training Management", fill=(140, 140, 140), font=font_xs)

# Divider
draw.line([(side_x + 15, side_y + 70), (side_x + side_w - 15, side_y + 70)], fill=(230, 230, 230), width=1)

# Nav items (mock)
nav_items = ["Dashboard", "Companies", "Trainees", "Sessions", "Certificates", "Reports", "Settings"]
for i, item in enumerate(nav_items):
    y = side_y + 85 + i * 30
    if i == 0:  # active
        draw.rectangle([side_x + 12, y, side_x + side_w - 12, y + 26], fill=(123, 30, 43))
        draw.text((side_x + 22, y + 6), item, fill=(255, 255, 255), font=font_sm)
    else:
        draw.text((side_x + 22, y + 6), item, fill=(100, 100, 100), font=font_sm)

draw.text((side_x, side_y + side_h + 5), "Sidebar — COLOR icon visible on white", fill=(80, 80, 80), font=font_xs)

# === Section 3: Sidebar in Arabic ===
side2_x = 880
draw.rectangle([side2_x, side_y, side2_x + side_w, side_y + side_h], fill=(255, 255, 255), outline=(220, 220, 220))

# Sidebar brand area (Arabic) - mirror for RTL
icon_small2 = icon.resize((36, 36))
canvas.paste(icon_small2, (side2_x + side_w - 56, side_y + 20), icon_small2)
draw.text((side2_x + side_w - 175, side_y + 22), "المختبر الخليجي", fill=(40, 40, 40), font=font_ar_bold)
draw.text((side2_x + side_w - 175, side_y + 45), "إدارة التدريب", fill=(140, 140, 140), font=font_ar_sm)

# Divider
draw.line([(side2_x + 15, side_y + 70), (side2_x + side_w - 15, side_y + 70)], fill=(230, 230, 230), width=1)

nav_items_ar = ["لوحة التحكم", "الشركات", "المتدربون", "الجلسات", "الشهادات", "التقارير", "الإعدادات"]
for i, item in enumerate(nav_items_ar):
    y = side_y + 85 + i * 30
    if i == 0:
        draw.rectangle([side2_x + 12, y, side2_x + side_w - 12, y + 26], fill=(123, 30, 43))
        # Right-aligned text for RTL
        draw.text((side2_x + side_w - 22, y + 6), item, fill=(255, 255, 255), font=font_ar_sm, anchor="ra")
    else:
        draw.text((side2_x + side_w - 22, y + 6), item, fill=(100, 100, 100), font=font_ar_sm, anchor="ra")

draw.text((side2_x, side_y + side_h + 5), "Sidebar (Arabic RTL) — المختبر الخليجي", fill=(80, 80, 80), font=font_xs)

# === Section 4: Logo variations showcase ===
showcase_y = 480
draw.text((40, showcase_y), "Logo Assets", fill=(40, 40, 40), font=font_bold_md)

# White logo on burgundy
draw.rectangle([40, showcase_y + 30, 320, showcase_y + 110], fill=(123, 30, 43))
wl2 = white_logo.resize((260, 74))
canvas.paste(wl2, (50, showcase_y + 33), wl2)
draw.text((40, showcase_y + 115), "gcclab-logo-white.png (for burgundy panels)", fill=(80, 80, 80), font=font_xs)

# Color logo on white
draw.rectangle([360, showcase_y + 30, 640, showcase_y + 110], fill=(255, 255, 255), outline=(220, 220, 220))
cl2 = color_logo.resize((260, 74))
canvas.paste(cl2, (370, showcase_y + 33), cl2)
draw.text((360, showcase_y + 115), "gcclab-logo-official.png (for light bg)", fill=(80, 80, 80), font=font_xs)

# Icon on white
draw.rectangle([680, showcase_y + 30, 780, showcase_y + 130], fill=(255, 255, 255), outline=(220, 220, 220))
icon_lg = icon.resize((80, 80))
canvas.paste(icon_lg, (690, showcase_y + 40), icon_lg)
draw.text((680, showcase_y + 135), "gcclab-icon.png (favicon/sidebar)", fill=(80, 80, 80), font=font_xs)

# === Section 5: Before/After comparison ===
compare_y = 660
draw.text((40, compare_y), "Before vs After — Logo Visibility on Burgundy Panel", fill=(40, 40, 40), font=font_bold_md)

# Before: color logo on burgundy (the problem)
draw.rectangle([40, compare_y + 30, 380, compare_y + 150], fill=(123, 30, 43))
cl3 = color_logo.resize((280, 80))
canvas.paste(cl3, (60, compare_y + 50), cl3)
draw.text((40, compare_y + 155), "BEFORE: Color logo — burgundy icon disappears into burgundy bg", fill=(180, 30, 30), font=font_xs)

# After: white logo on burgundy (the fix)
draw.rectangle([420, compare_y + 30, 760, compare_y + 150], fill=(123, 30, 43))
wl3 = white_logo.resize((280, 80))
canvas.paste(wl3, (440, compare_y + 50), wl3)
draw.text((420, compare_y + 155), "AFTER: White logo — clearly visible on burgundy bg", fill=(30, 130, 50), font=font_xs)

# === Section 6: Arabic name change ===
name_y = 870
draw.text((40, name_y), "Arabic Name Correction", fill=(40, 40, 40), font=font_bold_md)

draw.text((40, name_y + 35), "BEFORE:", fill=(120, 120, 120), font=font_sm)
draw.text((120, name_y + 35), "المختبر العربي", fill=(180, 30, 30), font=font_ar_bold)
draw.text((280, name_y + 38), "(means 'Arab Laboratory' — WRONG)", fill=(120, 120, 120), font=font_xs)

draw.text((40, name_y + 70), "AFTER:", fill=(120, 120, 120), font=font_sm)
draw.text((120, name_y + 70), "المختبر الخليجي", fill=(30, 130, 50), font=font_ar_bold)
draw.text((280, name_y + 73), "(means 'Gulf Laboratory' — CORRECT, matches 'GCC Lab')", fill=(120, 120, 120), font=font_xs)

# Save
out_path = DOWNLOAD / "brand-update-preview.png"
canvas.save(out_path)
print(f"Preview saved: {out_path}")
print(f"Size: {canvas.size}")
