"""Render preview PNGs to visually verify logo visibility on both backgrounds.

Outputs to /home/z/my-project/download/logo-preview.png with two side-by-side panels:
- Left panel: burgundy background with WHITE logo (login/register panels)
- Right panel: white background with COLOR logo (sidebar, mobile)
"""
from PIL import Image, ImageDraw
from pathlib import Path

PUBLIC = Path("/home/z/my-project/public")
DOWNLOAD = Path("/home/z/my-project/download")
DOWNLOAD.mkdir(parents=True, exist_ok=True)

# Load logos
white_logo = Image.open(PUBLIC / "gcclab-logo-white.png").convert("RGBA")
color_logo = Image.open(PUBLIC / "gcclab-logo-official.png").convert("RGBA")

# Preview canvas
W, H = 1200, 400
preview = Image.new("RGB", (W, H), (245, 245, 245))
draw = ImageDraw.Draw(preview)

# Left panel — burgundy (#7B1E2B = 123, 30, 43) with white logo
burgundy = (123, 30, 43)
draw.rectangle([0, 0, W // 2, H], fill=burgundy)

# Right panel — white with color logo
draw.rectangle([W // 2, 0, W, H], fill=(255, 255, 255))

# Place logos (scale down for preview)
white_scaled = white_logo.resize((400, 115))
color_scaled = color_logo.resize((400, 115))

# Center logos on each panel
preview.paste(white_scaled, ((W // 2 - 400) // 2, (H - 115) // 2), white_scaled)
preview.paste(color_scaled, (W // 2 + (W // 2 - 400) // 2, (H - 115) // 2), color_scaled)

# Labels
try:
    from PIL import ImageFont
    font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 18)
except Exception:
    font = ImageFont.load_default()

# Title bars
draw.text((20, 15), "WHITE LOGO on BURGUNDY PANEL (login/register)", fill=(255, 255, 255), font=font)
draw.text((W // 2 + 20, 15), "COLOR LOGO on WHITE PANEL (sidebar/mobile)", fill=(40, 40, 40), font=font)

# Divider
draw.line([(W // 2, 0), (W // 2, H)], fill=(150, 150, 150), width=2)

out_path = DOWNLOAD / "logo-preview.png"
preview.save(out_path)
print(f"Preview saved: {out_path}")
print(f"Size: {preview.size}")
