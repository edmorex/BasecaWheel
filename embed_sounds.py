#!/usr/bin/env python3
"""
BascaWheel Sound Embedder
=========================
Reads every WAV in sounds/, base64-encodes it, and patches the SOUND_DATA
block in BasecaWheel.html (between the `// SOUND_DATA_BEGIN` and
`// SOUND_DATA_END` markers in the inline script).

Run this whenever WAVs in sounds/ are added, replaced, or removed.
After running, BasecaWheel.html can be opened directly via file:// with
working audio — no local server required.

Usage
-----
    python3 embed_sounds.py
"""

import base64
import os

ROOT       = os.path.dirname(os.path.abspath(__file__))
SOUNDS_DIR = os.path.join(ROOT, "sounds")
HTML_PATH  = os.path.join(ROOT, "BasecaWheel.html")

BEGIN_MARKER = "// SOUND_DATA_BEGIN"
END_MARKER   = "// SOUND_DATA_END"


def collect_sounds():
    """Return a list of (name, base64_str) for every .wav in sounds/, sorted by name."""
    if not os.path.isdir(SOUNDS_DIR):
        raise RuntimeError(f"sounds/ directory not found at {SOUNDS_DIR}")
    out = []
    for fname in sorted(os.listdir(SOUNDS_DIR)):
        if not fname.lower().endswith(".wav"):
            continue
        name = os.path.splitext(fname)[0]
        with open(os.path.join(SOUNDS_DIR, fname), "rb") as f:
            b64 = base64.b64encode(f.read()).decode("ascii")
        out.append((name, b64))
    return out


def patch_html(sounds):
    """Replace the SOUND_DATA block in BasecaWheel.html with `sounds`."""
    with open(HTML_PATH, "r") as f:
        html = f.read()

    begin_idx = html.find(BEGIN_MARKER)
    end_idx   = html.find(END_MARKER, begin_idx + 1) if begin_idx != -1 else -1
    if begin_idx == -1 or end_idx == -1:
        raise RuntimeError(
            f"Could not find SOUND_DATA markers in {HTML_PATH}. "
            f"Make sure the HTML contains both '{BEGIN_MARKER}' and '{END_MARKER}'."
        )
    begin_line_end = html.find("\n", begin_idx) + 1
    end_line_end   = html.find("\n", end_idx)
    if end_line_end == -1:
        end_line_end = len(html)

    body = ["const SOUND_DATA = {"]
    for name, b64 in sounds:
        body.append(f'  {name}: "{b64}",')
        kb = (len(b64) + 1023) // 1024
        print(f"  embed  {name:<10}  {kb} KB (base64)")
    body.append("};")
    body.append(END_MARKER)

    new_html = html[:begin_line_end] + "\n".join(body) + html[end_line_end:]
    with open(HTML_PATH, "w") as f:
        f.write(new_html)


if __name__ == "__main__":
    sounds = collect_sounds()
    if not sounds:
        print(f"No .wav files found in {SOUNDS_DIR}")
        raise SystemExit(1)
    print(f"Embedding {len(sounds)} sound(s) into BasecaWheel.html...")
    patch_html(sounds)
    print("\nDone — open BasecaWheel.html directly (no server needed).")
