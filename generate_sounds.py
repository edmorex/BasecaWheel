#!/usr/bin/env python3
"""
BascaWheel Sound Generator
==========================
Edit the synthesis functions below to customise sounds, then run:

    python3 generate_sounds.py

WAV files are written to sounds/. Reload the app in your browser
(served via `python3 serve.py`) to hear the new sounds.

TIPS
----
- SR controls quality vs. file size. 22050 is plenty for these sounds.
- Each make_*() function returns a list of float samples in [-1, 1].
- Helper functions: sine_wave(), noise_burst(), env(), mix(), concat()
"""

import math, os, random, struct, wave

# ── Configuration ──────────────────────────────────────────────────────────────

SR         = 22050   # sample rate in Hz  (try 44100 for higher quality)
SOUNDS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sounds")


# ── Synthesis helpers ──────────────────────────────────────────────────────────

def sine_wave(freq, dur, amp=1.0):
    """Pure sine tone at `freq` Hz for `dur` seconds."""
    n = int(dur * SR)
    return [amp * math.sin(2 * math.pi * freq * i / SR) for i in range(n)]

def noise_burst(dur, amp=1.0):
    """White noise for `dur` seconds."""
    return [(random.random() * 2 - 1) * amp for _ in range(int(dur * SR))]

def env(samples, attack=0.01, release=0.05):
    """Linear attack / release envelope."""
    n, a, r = len(samples), int(attack * SR), int(release * SR)
    return [s * (i / a if i < a else (n - i) / r if i >= n - r else 1.0)
            for i, s in enumerate(samples)]

def mix(*tracks):
    """Sum tracks and normalise peak to 0.95."""
    n   = max(len(t) for t in tracks)
    out = [sum(t[i] if i < len(t) else 0.0 for t in tracks) for i in range(n)]
    pk  = max(abs(x) for x in out) or 1.0
    k   = 0.95 / pk
    return [x * k for x in out]

def concat(*parts):
    out = []
    for p in parts:
        out.extend(p)
    return out


# ── Sound definitions — edit freely ───────────────────────────────────────────

def make_tick():
    """Short cat-meow chirp when the pointer crosses a wheel segment."""
    dur = 0.15
    n   = int(dur * SR)
    out = []
    phase = 0.0
    for i in range(n):
        t = i / n  # 0 → 1

        # Frequency sweep: rise then fall (meow shape)
        if t < 0.35:
            freq = 550 + 650 * (t / 0.35) ** 0.7
        else:
            freq = 1200 - 700 * ((t - 0.35) / 0.65) ** 0.6

        # Vibrato that fades in then out with the note
        vib    = 1 + 0.018 * math.sin(2 * math.pi * 9 * t) * math.sin(math.pi * t)
        phase += 2 * math.pi * freq * vib / SR

        # Smooth bell-shaped amplitude envelope
        amp = math.sin(math.pi * t) ** 0.6

        # Vocal harmonics for cat-like timbre
        sample = (
            math.sin(phase)     * 0.55
          + math.sin(2 * phase) * 0.26
          + math.sin(3 * phase) * 0.13
          + math.sin(4 * phase) * 0.06
        )
        out.append(amp * sample * 0.8)
    return out


def make_explode():
    """Played when nobody wins (explode mischief event)."""
    n   = int(0.7 * SR)
    out = []
    for i in range(n):
        g     = math.exp(-i / n * 4)
        sweep = 800 * (1 - i / n * 0.85)
        out.append(g * ((random.random() * 2 - 1) * 0.55
                      + math.sin(2 * math.pi * sweep * i / SR) * 0.45))
    return out


def make_reverse():
    """Played when reverse-spin mischief triggers."""
    n, phase = int(0.5 * SR), 0.0
    out = []
    for i in range(n):
        phase += 2 * math.pi * (200 + 1200 * i / n) / SR
        g = min(1.0, i / (0.05 * SR)) * min(1.0, (n - i) / (0.05 * SR))
        out.append(g * math.sin(phase) * 0.7)
    return out


def make_slowdown():
    """Played when the wheel unexpectedly slows down."""
    n, phase = int(0.9 * SR), 0.0
    out = []
    for i in range(n):
        phase += 2 * math.pi * (440 * (1 + (1 - i / n) * 0.3)) / SR
        g = (1 - 0.6 * i / n) * min(1.0, i / (0.04 * SR))
        out.append(g * math.sin(phase) * 0.65)
    return out


def make_boost():
    """Played when a speed-boost mischief triggers."""
    notes = [262, 330, 392, 523, 659, 784]
    total = int(0.55 * SR)
    seg   = total // len(notes)
    out   = []
    for freq in notes:
        start = len(out)
        for j in range(seg):
            g = min(1.0, j / (0.005 * SR)) * min(1.0, (seg - j) / (0.025 * SR))
            out.append(g * math.sin(2 * math.pi * freq * (start + j) / SR) * 0.75)
    return out[:total]


def make_shuffle():
    """Played when a late-shuffle mischief triggers."""
    pairs = [660, 880, 740, 987, 660, 880, 740, 987, 880, 1100]
    total = int(0.45 * SR)
    seg   = total // len(pairs)
    out   = []
    for freq in pairs:
        start = len(out)
        for j in range(seg):
            g = min(1.0, j / (0.005 * SR)) * min(1.0, (seg - j) / (0.01 * SR))
            out.append(g * math.sin(2 * math.pi * freq * (start + j) / SR) * 0.6)
    return out[:total]


def make_fanfare():
    """Triumphant fanfare when the winner is revealed."""
    SEQ = [
        (392, .12), (392, .12), (392, .12), (523, .50),
        (659, .12), (622, .12), (659, .50),
        (659, .10), (698, .10), (784, .50),
        (784, .12), (880, .12), (988, .12), (1047, .70),
    ]
    out = []
    for freq, dur in SEQ:
        sn = int(dur * SR)
        for j in range(sn):
            ag  = min(1.0, j / (0.015 * SR))
            rg  = min(1.0, (sn - j) / (0.04 * SR))
            vib = 1 + 0.008 * math.sin(2 * math.pi * 6 * j / SR)
            out.append(ag * rg * (
                  math.sin(2 * math.pi * freq * vib * j / SR)
                + 0.45 * math.sin(4 * math.pi * freq * j / SR)
                + 0.20 * math.sin(6 * math.pi * freq * j / SR)
            ) * 0.55)
    return out


def make_bg():
    """Looping background music — chord pad + melody phrase."""
    CHORD  = [(261.63, .35), (329.63, .28), (392.00, .22), (523.25, .15)]
    PHRASE = [
        (523.25, .5), (587.33, .5), (659.25, .5), (698.46, .5),
        (659.25, .5), (587.33, .5), (523.25, 1.0),
    ]
    total = int(sum(d for _, d in PHRASE) * SR)
    # Chord pad
    pad = []
    for i in range(total):
        s = sum(a * (0.5 + 0.5 * math.sin(2 * math.pi * 0.25 * i / SR))
                  * math.sin(2 * math.pi * f * i / SR) * 0.28
                for f, a in CHORD)
        pad.append(s)
    # Melody on top
    pos = 0
    for freq, dur in PHRASE:
        sn = int(dur * SR)
        for j in range(sn):
            if pos + j >= total:
                break
            ag  = min(1.0, j / (0.03 * SR))
            rg  = min(1.0, (sn - j) / (0.05 * SR))
            vib = 1 + 0.006 * math.sin(2 * math.pi * 5.5 * j / SR)
            pad[pos + j] += ag * rg * math.sin(2 * math.pi * freq * vib * j / SR) * 0.38
        pos += sn
    return pad


# ── Sound registry — add/remove entries to change what gets built ──────────────

SOUNDS = [
    ("tick",     make_tick),
    ("explode",  make_explode),
    ("reverse",  make_reverse),
    ("slowdown", make_slowdown),
    ("boost",    make_boost),
    ("shuffle",  make_shuffle),
    ("fanfare",  make_fanfare),
    ("bg",       make_bg),
]


# ── Build / export machinery (no need to edit below this line) ─────────────────

def _to_pcm(samples):
    pk    = max(abs(s) for s in samples) or 1.0
    scale = min(1.0, 0.95 / pk) * 32767
    return b"".join(
        struct.pack("<h", max(-32767, min(32767, int(s * scale))))
        for s in samples
    )

def write_wav(name, samples):
    os.makedirs(SOUNDS_DIR, exist_ok=True)
    path = os.path.join(SOUNDS_DIR, f"{name}.wav")
    pcm  = _to_pcm(samples)
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm)
    kb = (len(pcm) + 44) // 1024
    print(f"  {name:<12}  {len(samples)/SR:.2f}s  {kb} KB")
    return path

if __name__ == "__main__":
    print(f"Sample rate : {SR} Hz\n")
    print("Generating sounds...")
    for name, fn in SOUNDS:
        write_wav(name, fn())
    print("\nDone — to bake the new WAVs into BasecaWheel.html run:")
    print("    python3 embed_sounds.py")
