#!/usr/bin/env python3
"""
BascaWheel emoji-image generator
================================
Renders a placeholder PNG for each emoji shown in the centre of the wheel.

The app loads images/<state>.png at runtime; if a PNG is missing or fails
to load, it falls back to the original emoji character. So you can:

  1. Run this script once to populate images/ with placeholders.
  2. Replace any images/<state>.png with your own PNG (or any image file
     the browser supports — keep the same filename).
  3. Delete a file to revert that state to the emoji fallback.

Tip: edit the EMOJI map below if you want to change which emoji a state
falls back to, then re-run.

Requires Pillow:  pip3 install Pillow
"""

import os
import sys

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("Pillow is required. Install with: pip3 install Pillow")

# ── Configuration ──────────────────────────────────────────────────────────────

EMOJI = {
    "idle":     "😻",
    "excited":  "🤩",
    "nervous":  "😬",
    "shocked":  "😮",
    "relieved": "😅",
    "speed":    "😜",
    "slowdown": "🫣",
    "swap":     "🌀",
    "reverse":  "🔄",
    "explode":  "💥",
    "winner":   "🥳",
    "nobody":   "🙀",
}

OUT_DIR    = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images")
CANVAS_PX  = 256
EMOJI_PX   = 160                                 # Apple Color Emoji ships fixed bitmap sizes; 160 is the largest.
FONT_PATHS = [
    "/System/Library/Fonts/Apple Color Emoji.ttc",       # macOS
    "/usr/share/fonts/truetype/noto/NotoColorEmoji.ttf", # Linux (Noto)
    "C:\\Windows\\Fonts\\seguiemj.ttf",                   # Windows
]


def find_font():
    for p in FONT_PATHS:
        if os.path.exists(p):
            return p
    return None


def render(emoji, font_path, out_path):
    img  = Image.new("RGBA", (CANVAS_PX, CANVAS_PX), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    if font_path:
        try:
            font = ImageFont.truetype(font_path, size=EMOJI_PX)
            bbox = draw.textbbox((0, 0), emoji, font=font, embedded_color=True)
            w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
            x = (CANVAS_PX - w) // 2 - bbox[0]
            y = (CANVAS_PX - h) // 2 - bbox[1]
            draw.text((x, y), emoji, font=font, embedded_color=True)
            img.save(out_path)
            return True
        except Exception as e:
            print(f"  warn: {emoji} → {os.path.basename(out_path)}: {e}", file=sys.stderr)

    # Fallback: write a transparent PNG. The app will fall back to the emoji
    # character at runtime, which is the desired behaviour anyway.
    img.save(out_path)
    return False


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    font_path = find_font()

    if not font_path:
        print("No system emoji font found. Generating blank placeholders;")
        print("the app will fall back to emoji characters at runtime.\n")

    print("Generating images...")
    rendered = 0
    for state, emoji in EMOJI.items():
        path = os.path.join(OUT_DIR, f"{state}.png")
        ok   = render(emoji, font_path, path)
        mark = "✓" if ok else "·"
        print(f"  {mark} {state:<10} {emoji}  →  images/{state}.png")
        if ok:
            rendered += 1

    print(f"\nDone — {rendered}/{len(EMOJI)} rendered with the system emoji font.")
