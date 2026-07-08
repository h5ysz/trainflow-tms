"""Analyze the uploaded official GCCLAB logo.

The PNG is 310x150, RGBA, mostly transparent (76%).
The dark text is around RGB(35,31,32) — near-black, 2.8% of pixels.
The burgundy color is around RGB(115, 26, 42) — 0.2% of pixels.

Goal: Identify what's in the image (text? icon? both?) and locate bounding box.
"""
from PIL import Image
import numpy as np

img = Image.open('/home/z/my-project/upload/pasted_image_1783549805736.png').convert('RGBA')
arr = np.array(img)
print("Shape:", arr.shape)

# Find non-transparent pixels
alpha = arr[:, :, 3]
non_transparent = alpha > 10
print(f"Non-transparent pixels: {non_transparent.sum()}")

# Bounding box of non-transparent content
rows = np.any(non_transparent, axis=1)
cols = np.any(non_transparent, axis=0)
ymin, ymax = np.where(rows)[0][[0, -1]]
xmin, xmax = np.where(cols)[0][[0, -1]]
print(f"Content bounding box: ({xmin}, {ymin}) to ({xmax}, {ymax})")
print(f"Content size: {xmax - xmin + 1}x{ymax - ymin + 1}")

# Sample rows to see vertical structure
print("\nNon-transparent pixel count per row (every 5 rows):")
for y in range(0, 150, 5):
    count = non_transparent[y, :].sum()
    if count > 0:
        # What colors are in this row?
        row_colors = arr[y, non_transparent[y, :], :3]
        avg_color = row_colors.mean(axis=0) if len(row_colors) > 0 else [0, 0, 0]
        print(f"  Row {y:3d}: {count:3d} pixels, avg color RGB({avg_color[0]:.0f}, {avg_color[1]:.0f}, {avg_color[2]:.0f})")

# Sample columns
print("\nNon-transparent pixel count per column (every 10 cols):")
for x in range(0, 310, 10):
    count = non_transparent[:, x].sum()
    if count > 0:
        col_colors = arr[non_transparent[:, x], x, :3]
        avg_color = col_colors.mean(axis=0) if len(col_colors) > 0 else [0, 0, 0]
        print(f"  Col {x:3d}: {count:3d} pixels, avg color RGB({avg_color[0]:.0f}, {avg_color[1]:.0f}, {avg_color[2]:.0f})")

# Save a cropped version of just the content
content = img.crop((xmin, ymin, xmax + 1, ymax + 1))
content.save('/home/z/my-project/download/uploaded-logo-cropped.png')
print(f"\nCropped content saved to download/uploaded-logo-cropped.png ({content.size})")

# Also save a version on white background to see what it looks like
white_bg = Image.new('RGBA', img.size, (255, 255, 255, 255))
white_bg.paste(img, (0, 0), img)
white_bg.convert('RGB').save('/home/z/my-project/download/uploaded-logo-on-white.png')
print("White background version saved to download/uploaded-logo-on-white.png")

# Save on burgundy background too
burgundy_bg = Image.new('RGBA', img.size, (123, 30, 43, 255))
burgundy_bg.paste(img, (0, 0), img)
burgundy_bg.convert('RGB').save('/home/z/my-project/download/uploaded-logo-on-burgundy.png')
print("Burgundy background version saved to download/uploaded-logo-on-burgundy.png")
