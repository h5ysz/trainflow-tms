"""Generate GCCLAB logo PNGs (color + white) from SVG sources.

Outputs:
- /home/z/my-project/public/gcclab-logo-official.png  (color, for light bg)
- /home/z/my-project/public/gcclab-logo-white.png     (white, for burgundy bg)
- /home/z/my-project/public/gcclab-icon.png           (color icon, for favicon)
"""
import cairosvg
from pathlib import Path

PUBLIC = Path("/home/z/my-project/public")

def svg_to_png(svg_path: Path, png_path: Path, width: int, height: int | None = None):
    """Render SVG to PNG at given width (height auto-scaled if None)."""
    svg_path_str = str(svg_path)
    png_path_str = str(png_path)
    cairosvg.svg2png(
        url=svg_path_str,
        write_to=png_path_str,
        output_width=width,
        output_height=height if height else int(width * 0.2857),  # 280:80 ≈ 3.5:1
    )
    print(f"  Generated: {png_path} ({width}x{height if height else int(width * 0.2857)})")

# 1. Color logo PNG (for light backgrounds — sidebar, mobile)
print("[1/3] Color logo PNG (light backgrounds)")
svg_to_png(
    PUBLIC / "gcclab-logo.svg",
    PUBLIC / "gcclab-logo-official.png",
    width=620,  # 2x of 310 for retina
    height=178, # keep aspect ratio 280:80
)

# 2. White logo PNG (for burgundy panels)
print("[2/3] White logo PNG (burgundy backgrounds)")
svg_to_png(
    PUBLIC / "gcclab-logo-white.svg",
    PUBLIC / "gcclab-logo-white.png",
    width=620,
    height=178,
)

# 3. Icon-only PNG (for favicon — square)
print("[3/3] Icon PNG (favicon, square)")
cairosvg.svg2png(
    url=str(PUBLIC / "gcclab-icon.svg"),
    write_to=str(PUBLIC / "gcclab-icon.png"),
    output_width=128,
    output_height=128,
)
print(f"  Generated: {PUBLIC}/gcclab-icon.png (128x128)")

print("\nDone.")
