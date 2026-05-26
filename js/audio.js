// ── audio.js ───────────────────────────────────────────────────
// Web Audio API sound system.
//
// LOAD ORDER: must come after constants.js and state.js.
// Reads:   DEFAULT_SOUNDS, SOUND_VOLS, BG_VOL (constants.js)
// Reads:   settings.customSounds (state.js) — read at call time, not load time
// Mutates: muted, audioCtx, bgNode, bgFallbackAudio, bgFadeId, tickGain,
//          audioBufs, audioFallbacks, audioPreloadPromise, audioWarmedUp (state.js)
//
// CROSS-ORIGIN SOUNDS: fetch() is blocked by CORS for URLs on a different
// origin. isCrossOriginUrl() detects these upfront and skips fetch entirely,
// going straight to an HTMLAudioElement fallback. The <audio> element can
// play cross-origin media without CORS headers. Volume control for fallback
// sounds uses audio.volume (0-1) instead of a Web Audio gain node.
//
// AUTOPLAY POLICY: AudioContext creation is attempted at script load time.
// Modern browsers may create it in a "suspended" state until a user gesture.
// _firstUserGesture hooks the first pointer/touch/key event to resume it
// early — before the spin click — so the first spin never drops ticks.

function isCrossOriginUrl(url) {
  try { return new URL(url, location.href).origin !== location.origin; }
  catch { return false; }
}

function makeAudioFallback(url) {
  // Pre-create the Audio element with preload="auto" so the browser begins
  // fetching the file immediately. playTick/playSound use .cloneNode() on
  // this element, which shares the browser's HTTP cache — near-zero latency
  // after the first load. cloneNode() is preferred over new Audio(url) per
  // play because it avoids a new network request each time.
  const a = new Audio(url);
  a.preload = "auto";
  return a;
}

async function reloadSounds() {
  if (!audioCtx) return;
  await Promise.all(Object.keys(DEFAULT_SOUNDS).map(async key => {
    const url = (settings.customSounds && key in settings.customSounds)
      ? settings.customSounds[key]
      : DEFAULT_SOUNDS[key];

    delete audioFallbacks[key];
    if (!url) { audioBufs[key] = null; return; }

    if (isCrossOriginUrl(url)) {
      // Don't attempt fetch for cross-origin URLs — CORS would block it and
      // print an ugly console error even when the catch handles it.
      audioBufs[key] = null;
      audioFallbacks[key] = makeAudioFallback(url);
      return;
    }

    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(res.status);
      audioBufs[key] = await audioCtx.decodeAudioData(await res.arrayBuffer());
    } catch {
      // Same-origin fetch failed (404, server error, etc.) — fall back to
      // HTMLAudioElement so the sound still plays if the browser can load it.
      audioBufs[key] = null;
      audioFallbacks[key] = makeAudioFallback(url);
    }
  }));
}

function preloadAudio() {
  if (audioCtx) return;
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return; // very old / locked-down browsers — lazy init via initAudio()
  }
  tickGain = audioCtx.createGain();
  tickGain.gain.value = 0.65;
  tickGain.connect(audioCtx.destination);
  audioPreloadPromise = reloadSounds();
}

async function initAudio() {
  if (!audioCtx) preloadAudio(); // fallback if pre-load was blocked by browser policy
  if (!audioCtx) return;
  if (audioCtx.state === "suspended") await audioCtx.resume();
  if (audioPreloadPromise) await audioPreloadPromise;

  if (!audioWarmedUp) {
    audioWarmedUp = true;
    try {
      // Play a 1-frame silent buffer to warm the audio output path on Safari/iOS.
      // Without this, the very first real sample plays at full system volume
      // regardless of the gain node setting.
      const silent = audioCtx.createBuffer(1, 1, audioCtx.sampleRate);
      const src    = audioCtx.createBufferSource();
      src.buffer   = silent;
      src.connect(audioCtx.destination);
      src.start();
    } catch {}
  }
}

// Kick off buffer decoding immediately. If the browser blocks AudioContext
// creation before a user gesture, preloadAudio() is a no-op and initAudio()
// retries it on the first spin click.
preloadAudio();

// Resume the AudioContext on the very first user gesture anywhere on the
// page — earlier than the spin click — so buffers are ready before the
// first spin. capture:true + once:true fires ahead of any other handler.
const _firstUserGesture = () => { initAudio(); };
document.addEventListener("pointerdown", _firstUserGesture, { once: true, capture: true });
document.addEventListener("touchstart",  _firstUserGesture, { once: true, capture: true, passive: true });
document.addEventListener("keydown",     _firstUserGesture, { once: true, capture: true });

// ── Playback ──────────────────────────────────────────────────

function playTick() {
  if (muted) return;
  if (audioCtx && audioBufs.tick) {
    const src = audioCtx.createBufferSource();
    src.buffer = audioBufs.tick;
    src.connect(tickGain);
    src.start();
  } else if (audioFallbacks.tick) {
    const a = audioFallbacks.tick.cloneNode();
    a.volume = 0.65;
    a.play().catch(e => console.warn("tick fallback failed:", e.message));
  }
}

function playSound(key) {
  if (muted) return;
  if (audioCtx && audioBufs[key]) {
    const gain = audioCtx.createGain();
    gain.gain.value = SOUND_VOLS[key] ?? 0.8;
    gain.connect(audioCtx.destination);
    const src = audioCtx.createBufferSource();
    src.buffer = audioBufs[key];
    src.connect(gain);
    src.start();
  } else if (audioFallbacks[key]) {
    const a = audioFallbacks[key].cloneNode();
    a.volume = SOUND_VOLS[key] ?? 0.8;
    a.play().catch(e => console.warn("sound fallback failed:", key, e.message));
  }
}

function stopBg() {
  // Always clear bgFadeId first so a pending timeout can't call stopBg again.
  if (bgFadeId) { clearTimeout(bgFadeId); bgFadeId = null; }
  if (bgNode) {
    try { bgNode.src.stop(); } catch {}
    bgNode.src.disconnect(); bgNode.gain.disconnect();
    bgNode = null;
  }
  if (bgFallbackAudio) {
    bgFallbackAudio.pause();
    bgFallbackAudio = null;
  }
}

function startBg() {
  if (muted) return;
  stopBg();
  if (audioCtx && audioBufs.bg) {
    const gain = audioCtx.createGain();
    gain.gain.value = BG_VOL;
    gain.connect(audioCtx.destination);
    const src = audioCtx.createBufferSource();
    src.buffer = audioBufs.bg;
    src.loop = true;
    src.connect(gain);
    src.start();
    bgNode = { src, gain };
  } else if (audioFallbacks.bg) {
    bgFallbackAudio = audioFallbacks.bg.cloneNode();
    bgFallbackAudio.loop = true;
    bgFallbackAudio.volume = BG_VOL;
    bgFallbackAudio.play().catch(e => console.warn("bg fallback failed:", e.message));
  }
}

function fadeBgOut(durationMs = 1000) {
  if (bgFallbackAudio) {
    // HTMLAudioElement has no built-in gain ramp, so simulate with setInterval.
    const audio    = bgFallbackAudio;
    const startVol = audio.volume;
    const steps    = 20;
    const stepMs   = durationMs / steps;
    let   step     = 0;
    bgFadeId = setInterval(() => {
      step++;
      audio.volume = Math.max(0, startVol * (1 - step / steps));
      if (step >= steps) { clearInterval(bgFadeId); bgFadeId = null; audio.pause(); }
    }, stepMs);
    bgFallbackAudio = null; // prevent stopBg() from double-pausing during fade
    return;
  }
  if (!bgNode || !audioCtx) return;
  if (bgFadeId) { clearTimeout(bgFadeId); bgFadeId = null; }
  const t = audioCtx.currentTime;
  bgNode.gain.gain.cancelScheduledValues(t);
  bgNode.gain.gain.setValueAtTime(bgNode.gain.gain.value, t);
  bgNode.gain.gain.linearRampToValueAtTime(0, t + durationMs / 1000);
  bgFadeId = setTimeout(() => { stopBg(); bgFadeId = null; }, durationMs + 100);
}
