"""Final verification — render mockups of login, register, and sidebar
using the OFFICIAL GCCLAB logo (uploaded by user).

This produces a single verification image showing:
1. Login page (burgundy panel with WHITE logo on left, form on right)
2. Register page (similar)
3. Sidebar (white bg with icon + brand name)
4. Sidebar in Arabic RTL
5. PDF certificate header sample
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

PUBLIC = Path("/home/z/my-project/public")
DOWNLOAD = Path("/home/z/my-project/download")
DOWNLOAD.mkdir(parents=True, exist_ok=True)

# Load assets
official_logo = Image.open(PUBLIC / "gcclab-logo-official.png").convert("RGBA")
white_logo = Image.open(PUBLIC / "gcclab-logo-white.png").convert("RGBA")
icon = Image.open(PUBLIC / "gcclab-icon.png").convert("RGBA")

# Fonts
font_path_bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
font_path_reg = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
font_ar_bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"  # fallback for Arabic

font_xl = ImageFont.truetype(font_path_bold, 32)
font_lg = ImageFont.truetype(font_path_bold, 22)
font_md = ImageFont.truetype(font_path_bold, 16)
font_sm = ImageFont.truetype(font_path_reg, 13)
font_xs = ImageFont.truetype(font_path_reg, 11)
font_ar_md = ImageFont.truetype(font_ar_bold, 18)

# === Canvas ===
W, H = 1800, 1400
canvas = Image.new("RGB", (W, H), (245, 245, 248))
draw = ImageDraw.Draw(canvas)

# Title
draw.text((40, 25), "GCCLAB Official Logo — Final Visual Verification", fill=(20, 20, 20), font=font_xl)
draw.text((40, 70), "Using user-uploaded official logo. White version generated for burgundy panels.", fill=(80, 80, 80), font=font_sm)
draw.text((40, 88), "Arabic brand: المختبر الخليجي (Gulf Calibration Laboratory)", fill=(80, 80, 80), font=font_sm)

# ===========================================
# Panel 1: Login Page Mockup (1200x500 area)
# ===========================================
LOGIN_X, LOGIN_Y = 40, 130
LOGIN_W, LOGIN_H = 880, 540

# Left burgundy panel (40%)
BURG_W = int(LOGIN_W * 0.45)
draw.rectangle([LOGIN_X, LOGIN_Y, LOGIN_X + BURG_W, LOGIN_Y + LOGIN_H], fill=(123, 30, 43))

# White logo on burgundy (scaled)
wl_scaled = white_logo.resize((360, 174))
canvas.paste(wl_scaled, (LOGIN_X + 30, LOGIN_Y + 40), wl_scaled)
draw.text((LOGIN_X + 30, LOGIN_Y + 230), "نظام إدارة التدريب والشهادات", fill=(255, 220, 220), font=font_ar_md)
draw.text((LOGIN_X + 30, LOGIN_Y + 258), "Training & Certification Management System", fill=(255, 220, 220), font=font_sm)

# Burgundy panel content
draw.text((LOGIN_X + 30, LOGIN_Y + 310), "Training", fill=(255, 255, 255), font=font_xl)
draw.text((LOGIN_X + 30, LOGIN_Y + 350), "Management System", fill=(255, 255, 255), font=font_xl)

# Footer dots
draw.ellipse([LOGIN_X + 30, LOGIN_Y + 480, LOGIN_X + 38, LOGIN_Y + 488], fill=(255, 255, 255, 180))
draw.text((LOGIN_X + 45, LOGIN_Y + 478), "Electrical Safety", fill=(255, 220, 220), font=font_xs)

# Right form panel (60%)
draw.rectangle([LOGIN_X + BURG_W, LOGIN_Y, LOGIN_X + LOGIN_W, LOGIN_Y + LOGIN_H], fill=(255, 255, 255))
draw.text((LOGIN_X + BURG_W + 50, LOGIN_Y + 60), "Sign in", fill=(20, 20, 20), font=font_xl)
draw.text((LOGIN_X + BURG_W + 50, LOGIN_Y + 110), "Sign in to access the GCCLAB training platform.", fill=(120, 120, 120), font=font_sm)

# Form fields
form_x = LOGIN_X + BURG_W + 50
form_y = LOGIN_Y + 160
for i, (label, placeholder) in enumerate([("Email", "name@gcclab.com"), ("Password", "••••••••")]):
    y = form_y + i * 80
    draw.text((form_x, y), label, fill=(60, 60, 60), font=font_sm)
    draw.rectangle([form_x, y + 20, form_x + 350, y + 56], fill=(245, 245, 245), outline=(200, 200, 200))
    draw.text((form_x + 10, y + 30), placeholder, fill=(160, 160, 160), font=font_sm)

# Sign in button
btn_y = form_y + 180
draw.rectangle([form_x, btn_y, form_x + 350, btn_y + 44], fill=(123, 30, 43))
draw.text((form_x + 140, btn_y + 14), "Sign in", fill=(255, 255, 255), font=font_md)

# Links
draw.text((form_x, btn_y + 70), "Don't have an account? Create New Account", fill=(123, 30, 43), font=font_sm)

draw.text((LOGIN_X, LOGIN_Y + LOGIN_H + 8), "LOGIN PAGE — White logo on burgundy panel (clearly visible)", fill=(60, 60, 60), font=font_xs)

# ===========================================
# Panel 2: Sidebar Mockup (280x540)
# ===========================================
SIDE_X = LOGIN_X + LOGIN_W + 40
SIDE_Y = LOGIN_Y
SIDE_W = 280
SIDE_H = LOGIN_H

draw.rectangle([SIDE_X, SIDE_Y, SIDE_X + SIDE_W, SIDE_Y + SIDE_H], fill=(255, 255, 255), outline=(220, 220, 220))

# Brand block
icon_small = icon.resize((36, 36))
canvas.paste(icon_small, (SIDE_X + 20, SIDE_Y + 20), icon_small)
draw.text((SIDE_X + 65, SIDE_Y + 22), "GCC Lab", fill=(20, 20, 20), font=font_md)
draw.text((SIDE_X + 65, SIDE_Y + 42), "Training Management", fill=(140, 140, 140), font=font_xs)

draw.line([(SIDE_X + 15, SIDE_Y + 70), (SIDE_X + SIDE_W - 15, SIDE_Y + 70)], fill=(230, 230, 230), width=1)

# Nav
nav_items = [
    ("Dashboard", True),
    ("Companies", False), ("Trainees", False), ("Training Requests", False),
    ("Sessions", False), ("Attendance", False), ("Exams", False),
    ("Certificates", False), ("Reports", False), ("Settings", False),
]
for i, (label, active) in enumerate(nav_items):
    y = SIDE_Y + 85 + i * 32
    if active:
        draw.rectangle([SIDE_X + 12, y, SIDE_X + SIDE_W - 12, y + 28], fill=(123, 30, 43))
        draw.text((SIDE_X + 22, y + 7), label, fill=(255, 255, 255), font=font_sm)
    else:
        draw.text((SIDE_X + 22, y + 7), label, fill=(100, 100, 100), font=font_sm)

# Footer
draw.line([(SIDE_X + 15, SIDE_Y + SIDE_H - 30), (SIDE_X + SIDE_W - 15, SIDE_Y + SIDE_H - 30)], fill=(230, 230, 230), width=1)
draw.ellipse([SIDE_X + 20, SIDE_Y + SIDE_H - 18, SIDE_X + 28, SIDE_Y + SIDE_H - 10], fill=(40, 180, 100))
draw.text((SIDE_X + 35, SIDE_Y + SIDE_H - 18), "GCC Lab v1.0 RC1", fill=(140, 140, 140), font=font_xs)

draw.text((SIDE_X, SIDE_Y + SIDE_H + 8), "SIDEBAR — Icon + brand name on white", fill=(60, 60, 60), font=font_xs)

# ===========================================
# Panel 3: Arabic Sidebar (RTL)
# ===========================================
SIDE2_X = SIDE_X
SIDE2_Y = SIDE_Y + SIDE_H + 60
SIDE2_H = 540

draw.rectangle([SIDE2_X, SIDE2_Y, SIDE2_X + SIDE_W, SIDE2_Y + SIDE2_H], fill=(255, 255, 255), outline=(220, 220, 220))

# Brand block (Arabic - mirror RTL)
icon_small2 = icon.resize((36, 36))
canvas.paste(icon_small2, (SIDE2_X + SIDE_W - 56, SIDE2_Y + 20), icon_small2)
draw.text((SIDE2_X + SIDE_W - 175, SIDE2_Y + 22), "المختبر الخليجي", fill=(20, 20, 20), font=font_ar_md)
draw.text((SIDE2_X + SIDE_W - 175, SIDE2_Y + 45), "إدارة التدريب", fill=(140, 140, 140), font=font_xs)

draw.line([(SIDE2_X + 15, SIDE2_Y + 70), (SIDE2_X + SIDE_W - 15, SIDE2_Y + 70)], fill=(230, 230, 230), width=1)

nav_ar = [
    ("لوحة التحكم", True),
    ("الشركات", False), ("المتدربون", False), ("طلبات التدريب", False),
    ("الجلسات", False), ("الحضور", False), ("الاختبارات", False),
    ("الشهادات", False), ("التقارير", False), ("الإعدادات", False),
]
for i, (label, active) in enumerate(nav_ar):
    y = SIDE2_Y + 85 + i * 32
    if active:
        draw.rectangle([SIDE2_X + 12, y, SIDE2_X + SIDE_W - 12, y + 28], fill=(123, 30, 43))
        draw.text((SIDE2_X + SIDE_W - 22, y + 7), label, fill=(255, 255, 255), font=font_ar_md, anchor="ra")
    else:
        draw.text((SIDE2_X + SIDE_W - 22, y + 7), label, fill=(100, 100, 100), font=font_ar_md, anchor="ra")

draw.text((SIDE2_X, SIDE2_Y + SIDE2_H + 8), "SIDEBAR (Arabic RTL) — المختبر الخليجي", fill=(60, 60, 60), font=font_xs)

# ===========================================
# Panel 4: Asset Inventory (right side, lower)
# ===========================================
ASSET_X = LOGIN_X
ASSET_Y = LOGIN_Y + LOGIN_H + 60
ASSET_W = LOGIN_W
ASSET_H = 280

draw.text((ASSET_X, ASSET_Y), "Asset Inventory", fill=(20, 20, 20), font=font_lg)

# Asset 1: Official color logo on white
draw.rectangle([ASSET_X, ASSET_Y + 40, ASSET_X + 280, ASSET_Y + 180], fill=(255, 255, 255), outline=(200, 200, 200))
ol = official_logo.resize((240, 116))
canvas.paste(ol, (ASSET_X + 20, ASSET_Y + 52), ol)
draw.text((ASSET_X, ASSET_Y + 190), "gcclab-logo-official.png", fill=(40, 40, 40), font=font_xs)
draw.text((ASSET_X, ASSET_Y + 205), "310x150, for light backgrounds", fill=(120, 120, 120), font=font_xs)

# Asset 2: White logo on burgundy
draw.rectangle([ASSET_X + 300, ASSET_Y + 40, ASSET_X + 580, ASSET_Y + 180], fill=(123, 30, 43))
wl = white_logo.resize((240, 116))
canvas.paste(wl, (ASSET_X + 320, ASSET_Y + 52), wl)
draw.text((ASSET_X + 300, ASSET_Y + 190), "gcclab-logo-white.png", fill=(40, 40, 40), font=font_xs)
draw.text((ASSET_X + 300, ASSET_Y + 205), "310x150, for burgundy panels", fill=(120, 120, 120), font=font_xs)

# Asset 3: Icon on white
draw.rectangle([ASSET_X + 600, ASSET_Y + 40, ASSET_X + 880, ASSET_Y + 180], fill=(255, 255, 255), outline=(200, 200, 200))
icon_lg = icon.resize((120, 120))
canvas.paste(icon_lg, (ASSET_X + 740, ASSET_Y + 50), icon_lg)
draw.text((ASSET_X + 600, ASSET_Y + 190), "gcclab-icon.png", fill=(40, 40, 40), font=font_xs)
draw.text((ASSET_X + 600, ASSET_Y + 205), "128x128, for favicon/sidebar/mobile", fill=(120, 120, 120), font=font_xs)

# ===========================================
# Panel 5: Before/After Comparison
# ===========================================
CMP_Y = ASSET_Y + ASSET_H + 30
draw.text((ASSET_X, CMP_Y), "Before/After — Logo Visibility on Burgundy Panel", fill=(20, 20, 20), font=font_lg)

# Before: official color logo on burgundy (shows the problem)
draw.rectangle([ASSET_X, CMP_Y + 40, ASSET_X + 420, CMP_Y + 180], fill=(123, 30, 43))
ol2 = official_logo.resize((360, 174))
canvas.paste(ol2, (ASSET_X + 30, CMP_Y + 43), ol2)
draw.text((ASSET_X, CMP_Y + 190), "BEFORE: Official logo on burgundy", fill=(180, 30, 30), font=font_xs)
draw.text((ASSET_X, CMP_Y + 205), "Burgundy elements invisible — same color as bg", fill=(180, 30, 30), font=font_xs)

# After: white version on burgundy (the fix)
draw.rectangle([ASSET_X + 460, CMP_Y + 40, ASSET_X + 880, CMP_Y + 180], fill=(123, 30, 43))
wl2 = white_logo.resize((360, 174))
canvas.paste(wl2, (ASSET_X + 490, CMP_Y + 43), wl2)
draw.text((ASSET_X + 460, CMP_Y + 190), "AFTER: White version on burgundy", fill=(30, 130, 50), font=font_xs)
draw.text((ASSET_X + 460, CMP_Y + 205), "All elements clearly visible as white silhouette", fill=(30, 130, 50), font=font_xs)

out = DOWNLOAD / "official-logo-final-verification.png"
canvas.save(out)
print(f"Final verification saved: {out}")
print(f"Size: {canvas.size}")
