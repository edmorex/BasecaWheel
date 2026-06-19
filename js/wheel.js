// ── wheel.js ───────────────────────────────────────────────────
// Canvas drawing, wheel math, layout, idle rotation, flame speed.
//
// LOAD ORDER: must come after constants.js, state.js, emoji.js, audio.js.
// Reads:   COLORS, IDLE_RPS, WHEEL_TITLE_MIN_FONT, WHEEL_TITLE_MAX_FONT (constants.js)
// Reads/mutates: canvas, ctx, pointer, wheelWrap, wheelEmoji, wheelTitleText,
//                wheelCX, wheelCY, wheelRadius, currentRotation, spinning,
//                winnerShowing, idleRafId, idleLastTime, flameLastRot, etc. (state.js)
// Calls:   updateFlameSpeed (this file), playTick (audio.js), setEmoji (emoji.js)
//
// PITFALL — resizeCanvas() mutates wheelCX, wheelCY, wheelRadius.
// Any code that positions the pointer or computes slice geometry must call
// resizeCanvas() first (or wait for the window resize handler). boot.js
// calls resizeCanvas() once after all scripts are loaded.

// ── Overlay positioning ──────────────────────���────────────────
// syncOverlayToWheelPanel() must be called whenever the wheel panel
// is resized or the winner overlay is shown. winnerOverlay was reparented
// to <body> in state.js so it sits in the root stacking context.
function syncOverlayToWheelPanel(isExploded = false) {
  const rect = wheelWrap.getBoundingClientRect();
  winnerOverlay.style.left   = (rect.left + window.scrollX) + "px";
  winnerOverlay.style.top    = (rect.top  + window.scrollY) + "px";
  winnerOverlay.style.width  = rect.width  + "px";
  winnerOverlay.style.height = rect.height + "px";

  if (isExploded) {
    winnerOverlay.style.paddingTop = "8%";
  } else {
    // Align the visible top of the heart just below the wheel title.
    // The clip-path's topmost pixel sits at 0.11 * 420px ≈ 46px inside the box.
    const titleEl    = wheelWrap.querySelector(".wheel-title");
    const titleBottom = titleEl
      ? titleEl.getBoundingClientRect().bottom - rect.top
      : 70;
    const HEART_INTERNAL_TOP = 46; // 0.11 * 420px (matches clip-path + box height)
    const padTop = Math.max(0, titleBottom + 8 - HEART_INTERNAL_TOP);
    winnerOverlay.style.paddingTop = padTop + "px";
  }
}

// ── Flame speed ──────────���──────────────────────────���─────────
// Mirrors angular velocity onto --flame-speed so the pink flames flicker
// faster while the wheel spins. Throttled to ~10 Hz because changing
// animation-duration mid-flight resyncs keyframe phase — doing it every
// frame causes visible jitter.
function updateFlameSpeed(rotation, now) {
  if (flameLastTime !== null) {
    const dt = (now - flameLastTime) / 1000;
    if (dt > 0 && dt < 0.5) {
      const inst = Math.abs(rotation - flameLastRot) / dt;
      flameOmegaSmoothed = flameOmegaSmoothed * 0.85 + inst * 0.15;
    }
  }
  flameLastTime = now;
  flameLastRot  = rotation;

  if (now - flameCssLastUpdate > 100) {
    const dur = Math.max(0.4, Math.min(3.0, 2.5 / (1 + flameOmegaSmoothed * 0.25)));
    wheelWrap.style.setProperty("--flame-speed", dur.toFixed(3) + "s");
    flameCssLastUpdate = now;
  }
}

// ── Idle rotation ─────────────────────────────────────────────
function startIdleRotation() {
  if (idleRafId !== null) return;
  idleLastTime = performance.now();
  function tick(now) {
    if (spinning || winnerShowing) { idleRafId = null; return; }
    const dt = now - idleLastTime;
    idleLastTime = now;
    currentRotation = (currentRotation + IDLE_RPS * Math.PI * 2 * (dt / 1000)) % (Math.PI * 2);
    drawWheel(currentRotation);
    updateFlameSpeed(currentRotation, now);
    if (settings.idleTicks) updatePointerTick(currentRotation);
    idleRafId = requestAnimationFrame(tick);
  }
  idleRafId = requestAnimationFrame(tick);
}

function stopIdleRotation() {
  if (idleRafId !== null) { cancelAnimationFrame(idleRafId); idleRafId = null; }
}

// ── Layout ────────────────────────────────────────────────────
function resizeCanvas() {
  const rect    = wheelWrap.getBoundingClientRect();
  canvas.width  = rect.width;
  canvas.height = rect.height;
  const titleReserve = 80;
  wheelCX     = canvas.width / 2;
  wheelRadius = Math.min(canvas.width / 2 - 16, (canvas.height - titleReserve) / 2 - 16);
  wheelCY     = canvas.height / 2 + titleReserve / 2;
  pointer.style.left = (wheelCX + wheelRadius - 20) + "px";
  pointer.style.top  = wheelCY + "px";
  const emojiPx = Math.round(wheelRadius * 0.36 * 1.4);
  wheelEmoji.style.left     = wheelCX + "px";
  wheelEmoji.style.top      = wheelCY + "px";
  wheelEmoji.style.fontSize = (wheelRadius * 0.36) + "px";
  wheelEmoji.style.width    = emojiPx + "px";
  wheelEmoji.style.height   = emojiPx + "px";
  fitWheelTitle();
  syncOverlayToWheelPanel();
  renderWheelCache(); // geometry changed — rebuild the cached face at the new size
  drawWheel();
}

window.addEventListener("resize", () => {
  resizeCanvas();
  // On mobile, un-collapse the sidebar when the layout switches to
  // single-column — the toggle button is hidden by CSS on small screens
  // so the user has no way to restore it.
  if (window.innerWidth <= 640 && !sidebarVisible) {
    sidebarWrapper.style.width = "";
    document.querySelector(".app").classList.remove("sidebar-collapsed");
    sidebarVisible           = true;
    panelToggle.innerHTML = '<img src="icons/chevron-left.svg" class="btn-icon" alt="">';
    panelToggle.title     = "Hide panel";
  }
  // Re-evaluate scroll fades after crossing the mobile breakpoint —
  // the lists switch to overflow:visible, making previous show-classes stale.
  updateScrollFades();
  updateWheelScrollFades();
});

// ── Wheel math ────────────────────────────────────────────────
function totalWeight() {
  return entrants.reduce((s, e) => s + e.weight, 0);
}

// pointerAngle maps a canvas rotation value to the angle the pointer
// actually touches (0 = right, increasing clockwise in canvas coords).
function pointerAngle(rotation) {
  return ((-(rotation % (Math.PI * 2))) + Math.PI * 2) % (Math.PI * 2);
}

function getSliceIndexAt(rotation) {
  const total = totalWeight();
  const pa    = pointerAngle(rotation);
  let   cum   = 0;
  for (let i = 0; i < entrants.length; i++) {
    cum += entrants[i].weight / total * Math.PI * 2;
    if (pa < cum) return i;
  }
  return 0;
}

function getWinnerAtRotation(rotation) {
  return entrants[getSliceIndexAt(rotation)];
}

function pointerNearSliceEdge(rotation) {
  if (!entrants.length) return false;
  const total     = totalWeight();
  const pa        = pointerAngle(rotation);
  const THRESHOLD = 0.06;
  let   cum       = 0;
  for (const e of entrants) {
    const end = cum + e.weight / total * Math.PI * 2;
    if (Math.abs(pa - cum) < THRESHOLD || Math.abs(pa - end) < THRESHOLD) return true;
    cum = end;
  }
  return false;
}

// ── Draw ──────────────────────────────────────────────────────
// The wheel face (slices + labels) only changes when entrants, weights,
// percentages, or the nobody-wins state change — NOT while it spins. So it's
// rendered once into an offscreen canvas (renderWheelCache) and each animation
// frame is just a clear + rotate + drawImage of that bitmap. That turns the
// per-frame cost from "N arc fills + N strokes + N fillText" into a single
// GPU-accelerated blit, keeping full-speed spins smooth even with many
// entrants.
//
// CACHE INVALIDATION — every place that mutates the face must call
// renderWheelCache(): resizeCanvas() (this file, geometry), resetWheelState()
// (ui.js, covers add/remove/rename/weight/clear/shuffle/wheel-switch),
// randomSwap() + doNobodyWins() (spin.js, mid-spin face changes),
// dismissWinner() (ui.js, names return / post-auto-feature entrants), and the
// hidePercentages toggle (ui.js).
let wheelCache    = null; // offscreen <canvas>
let wheelCacheCtx = null;

function renderWheelCache() {
  if (!wheelCache) {
    wheelCache    = document.createElement("canvas");
    wheelCacheCtx = wheelCache.getContext("2d");
  }
  if (wheelCache.width !== canvas.width || wheelCache.height !== canvas.height) {
    wheelCache.width  = canvas.width;
    wheelCache.height = canvas.height;
  }
  const c  = wheelCacheCtx;
  const cx = wheelCX;
  const cy = wheelCY;
  c.clearRect(0, 0, wheelCache.width, wheelCache.height);

  if (!entrants.length) {
    c.beginPath();
    c.arc(cx, cy, wheelRadius, 0, Math.PI * 2);
    c.fillStyle = "#334155";
    c.fill();
    return;
  }

  const total      = totalWeight();
  let   startAngle = 0; // face is cached at rotation 0; drawWheel() rotates it

  entrants.forEach((e, i) => {
    const slice    = e.weight / total * Math.PI * 2;
    const endAngle = startAngle + slice;

    c.beginPath();
    c.moveTo(cx, cy);
    c.arc(cx, cy, wheelRadius, startAngle, endAngle);
    c.closePath();
    c.fillStyle   = COLORS[i % COLORS.length];
    c.fill();
    c.lineWidth   = 4;
    c.strokeStyle = "#0f172a";
    c.stroke();

    c.save();
    c.translate(cx, cy);
    c.rotate(startAngle + slice / 2);
    c.fillStyle = "white";
    c.font      = `bold ${Math.max(12, wheelRadius * 0.045)}px Arial`;
    c.textAlign = "right";
    const label = nobodyWinsActive
      ? "Nobody"
      : settings.hidePercentages
        ? e.name
        : `${e.name} (${(e.weight / total * 100).toFixed(1)}%)`;
    c.fillText(label, wheelRadius - 20, 8);
    c.restore();

    startAngle = endAngle;
  });
}

function drawWheel(rotation = currentRotation) {
  if (!wheelCache) renderWheelCache(); // safety: ensure the cache exists
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!wheelCache.width || !wheelCache.height) return; // not sized yet (pre first resize)
  ctx.save();
  ctx.translate(wheelCX, wheelCY);
  ctx.rotate(rotation);
  ctx.drawImage(wheelCache, -wheelCX, -wheelCY);
  ctx.restore();
}

// ── Pointer tick ────────────────��─────────────────────────────
function triggerPointerTick(cwSpin) {
  pointer.classList.remove("tick-cw", "tick-ccw");
  pointer.style.animation = "none";
  void pointer.offsetWidth; // force reflow so removing the class is visible
  pointer.style.animation = "";
  pointer.classList.add(cwSpin ? "tick-cw" : "tick-ccw");
  playTick();
}

function updatePointerTick(rotation) {
  if (!entrants.length) return;
  const idx = getSliceIndexAt(rotation);
  if (idx !== previousSliceIdx) {
    const cw = prevTickRotation === null || (rotation - prevTickRotation) >= 0;
    triggerPointerTick(cw);
    previousSliceIdx = idx;
  }
  prevTickRotation = rotation;
}

// ── Wheel title ──────────────��────────────────────────────────
function updateWheelTitle() {
  const txt = slotTitle.trim();
  wheelTitleText.textContent = txt;
  wheelTitleText.classList.toggle("visible", txt.length > 0);
  fitWheelTitle();
}

// Pick the largest integer font-size in [MIN, MAX] that lets the title
// render on a single line inside the wheel-title container.
// Binary search: O(log n) reflows instead of O(n).
function fitWheelTitle() {
  const txt = slotTitle.trim();
  if (!txt) return;
  const container = wheelTitleText.parentElement;
  if (!container) return;
  const cs    = getComputedStyle(container);
  const padX  = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
  const avail = container.clientWidth - padX;
  if (avail <= 0) return;

  let lo = WHEEL_TITLE_MIN_FONT, hi = WHEEL_TITLE_MAX_FONT;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    wheelTitleText.style.fontSize = mid + "px";
    if (wheelTitleText.scrollWidth <= avail) lo = mid;
    else                                     hi = mid - 1;
  }
  wheelTitleText.style.fontSize = lo + "px";
}
