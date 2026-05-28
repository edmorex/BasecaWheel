// ── spin.js ────────────────────────────────────────────────────
// Spin loop, special effects, confetti, explosion, nobody-wins.
//
// LOAD ORDER: must come after constants.js, state.js, emoji.js,
//             audio.js, and wheel.js.
// Reads:   COLORS, HEART_SEGS, HEART_CX, HEART_CY (constants.js)
// Reads/mutates: spinning, currentRotation, wasNearEdge, nobodyWinsActive,
//                winnerShowing, confettiBurstId, entrants, settings (state.js)
// Calls:   drawWheel, updatePointerTick, updateFlameSpeed,
//          stopIdleRotation, syncOverlayToWheelPanel,
//          fitWheelTitle (wheel.js)
//          setEmoji (emoji.js)
//          playSound, startBg, fadeBgOut, initAudio (audio.js)
//          renderEntrants, saveEntrants, addToHistory (ui.js)
//
// PITFALL — cwAnimate / ccwAnimate / blastSpin are all nested inside
// spinWheel() and doNobodyWins(). They close over local spin-state
// variables (cwStart, cwDuration, etc.) so that overlapping spins can't
// corrupt each other's state. Do not hoist them to module level.

// ── Confetti ──────────────────────────────────────────────────
function spawnConfetti(x, y, baseAngle, spreadRad) {
  const c = document.createElement("div");
  c.className = "burst-confetti";
  c.style.left = x + "px";
  c.style.top  = y + "px";
  c.style.background = COLORS[Math.floor(Math.random() * COLORS.length)];
  const sz = (6 + Math.random() * 10) + "px";
  c.style.width = c.style.height = sz;

  // Outward velocity along (baseAngle ± spread/2), plus a downward gravity
  // bias baked into ty so every particle eventually falls.
  const angle = baseAngle + (Math.random() - 0.5) * spreadRad;
  const speed = 240 + Math.random() * 360;
  const tx = Math.cos(angle) * speed;
  const ty = Math.sin(angle) * speed + 220 + Math.random() * 320;
  const tr = (Math.random() - 0.5) * 720;
  c.style.setProperty("--tx", tx + "px");
  c.style.setProperty("--ty", ty + "px");
  c.style.setProperty("--tr", tr + "deg");

  const dur = 1.5 + Math.random() * 1.5;
  c.style.animationDuration = dur + "s";
  document.body.appendChild(c);
  setTimeout(() => c.remove(), dur * 1000 + 100);
}

function sampleHeartOutline(box, n) {
  const pts    = [];
  const perSeg = Math.ceil(n / HEART_SEGS.length);
  for (const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]] of HEART_SEGS) {
    for (let i = 0; i < perSeg; i++) {
      const t = i / perSeg, mt = 1 - t;
      const nx = mt*mt*mt*x0 + 3*mt*mt*t*x1 + 3*mt*t*t*x2 + t*t*t*x3;
      const ny = mt*mt*mt*y0 + 3*mt*mt*t*y1 + 3*mt*t*t*y2 + t*t*t*y3;
      pts.push({ x: box.left + nx * box.width, y: box.top + ny * box.height });
    }
  }
  return pts;
}

function startConfettiBursts() {
  if (confettiBurstId) return;
  const wave = () => {
    const box = winnerBox.getBoundingClientRect();
    if (!box.width) return;
    // Exclude the top lobe (ny < 0.30) so confetti never fires upward.
    const outline = sampleHeartOutline(box, 120).filter(
      pt => (pt.y - box.top) / box.height > 0.30
    );
    if (!outline.length) return;
    const cx = box.left + HEART_CX * box.width;
    const cy = box.top  + HEART_CY * box.height;
    for (let i = 0; i < 100; i++) {
      const pt = outline[Math.floor(Math.random() * outline.length)];
      spawnConfetti(pt.x, pt.y, Math.atan2(pt.y - cy, pt.x - cx), Math.PI * 0.45);
    }
  };
  wave();
  confettiBurstId = setInterval(wave, 700);
}

function stopConfettiBursts() {
  if (confettiBurstId) { clearInterval(confettiBurstId); confettiBurstId = null; }
}

// ── Winner text sizing ────────────────────────────────────────
// Shrink winner-name font until text fits in MAX_LINES lines.
// The heart's lobe clips the top of the box — 4+ lines cuts the first line.
// Binary search: O(log n) reflows.
function fitWinnerText() {
  const MAX_PX       = 52;
  const MIN_PX       = 11;
  const MAX_LINES    = 3;
  const LINE_H_RATIO = 1.1; // matches CSS line-height on .winner-name

  function fits(px) {
    winnerName.style.fontSize = px + "px";
    return winnerName.offsetHeight <= Math.ceil(MAX_LINES * px * LINE_H_RATIO) + 2;
  }

  if (fits(MAX_PX)) return;
  let lo = MIN_PX, hi = MAX_PX - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid;
    else           hi = mid - 1;
  }
  winnerName.style.fontSize = lo + "px";
}

// ── Explosion effect ──────────────────────────────────────────
function launchExplosion() {
  const cols = ["#ef4444","#f97316","#fbbf24","#fff","#f43f5e"];
  const imageStates = Object.keys(EMOJI_VARIANTS)
    .filter(s => EMOJI_VARIANTS[s] && EMOJI_VARIANTS[s].length > 0);

  // Confetti shards at random viewport positions
  for (let b = 0; b < 12; b++) {
    const cx = 8 + Math.random() * 84; // vw
    const cy = 8 + Math.random() * 84; // vh
    for (let i = 0; i < 8; i++) {
      const s = document.createElement("div");
      s.className   = "shard";
      s.style.left  = cx + "vw";
      s.style.top   = cy + "vh";
      s.style.width  = (4  + Math.random() * 14) + "px";
      s.style.height = (3  + Math.random() * 8)  + "px";
      s.style.background = cols[Math.floor(Math.random() * cols.length)];
      const angle = Math.random() * Math.PI * 2;
      const speed = 150 + Math.random() * 400;
      s.style.setProperty("--tx", (Math.cos(angle) * speed) + "px");
      s.style.setProperty("--ty", (Math.sin(angle) * speed) + "px");
      s.style.setProperty("--tr", ((Math.random() - 0.5) * 1080) + "deg");
      const dur = 0.8 + Math.random() * 1.0;
      s.style.animationDuration = dur + "s";
      document.body.appendChild(s);
      setTimeout(() => s.remove(), dur * 1000 + 100);
    }
  }

  // Wheel-image debris fired radially outward from the wheel centre
  if (imageStates.length > 0) {
    const wrapRect       = wheelWrap.getBoundingClientRect();
    const centerX        = wrapRect.left + wheelCX;
    const centerY        = wrapRect.top  + wheelCY;
    const CLUSTER_RADIUS = Math.max(40, wheelRadius * 0.25);

    for (let i = 0; i < 36; i++) {
      const state    = imageStates[Math.floor(Math.random() * imageStates.length)];
      const variants = EMOJI_VARIANTS[state];
      const url      = variants[Math.floor(Math.random() * variants.length)];

      // Same angle for spawn offset and launch direction → flies straight out.
      const angle   = Math.random() * Math.PI * 2;
      const offsetR = Math.random() * CLUSTER_RADIUS;
      const spawnX  = centerX + Math.cos(angle) * offsetR;
      const spawnY  = centerY + Math.sin(angle) * offsetR;

      const img = document.createElement("img");
      img.className = "explode-img";
      img.alt       = "";
      img.draggable = false;
      img.src       = url;
      const size = 44 + Math.random() * 60;
      img.style.width  = size + "px";
      img.style.height = size + "px";
      img.style.left   = (spawnX - size / 2) + "px";
      img.style.top    = (spawnY - size / 2) + "px";
      const speed = 350 + Math.random() * 700;
      img.style.setProperty("--tx", (Math.cos(angle) * speed) + "px");
      img.style.setProperty("--ty", (Math.sin(angle) * speed) + "px");
      img.style.setProperty("--tr", ((Math.random() - 0.5) * 1440) + "deg");
      const dur = 1.0 + Math.random() * 1.5;
      img.style.animationDuration = dur + "s";
      document.body.appendChild(img);
      setTimeout(() => img.remove(), dur * 1000 + 100);
    }
  }

  document.body.classList.remove("shaking");
  void document.body.offsetWidth;
  document.body.classList.add("shaking");
  setTimeout(() => document.body.classList.remove("shaking"), 600);
}

function randomSwap() {
  if (entrants.length < 2) return;
  let a = Math.floor(Math.random() * entrants.length), b;
  do { b = Math.floor(Math.random() * entrants.length); } while (b === a);
  [entrants[a], entrants[b]] = [entrants[b], entrants[a]];
  renderEntrants(); saveEntrants();
}

// ── Nobody wins ───────────────────────────────────────────────
function doNobodyWins() {
  nobodyWinsActive = true;
  fadeBgOut(600);
  playSound("explode");
  // Fire explosion in sync with the sound — the wheel keeps spinning
  // behind the debris for ~1.2 s, then the "Nobody wins" UI appears.
  launchExplosion();

  const startRot   = currentRotation;
  const blastDur   = 1200;
  const blastStart = performance.now();
  setEmoji("explode");

  function blastSpin(now) {
    const t = Math.min((now - blastStart) / blastDur, 1);
    currentRotation = startRot + Math.PI * 2 * 3 * (t - t * t * 0.5);
    drawWheel(currentRotation);
    updateFlameSpeed(currentRotation, now);
    if (t < 1) { requestAnimationFrame(blastSpin); return; }

    setEmoji("nobody");
    winnerTitle.textContent = "💥 UH OH, IT'S BROKEN! 💥";
    winnerTitle.classList.add("bad");
    winnerBox.classList.add("exploded");
    winnerName.style.fontSize = "36px";
    winnerName.style.color    = "#ef4444";
    winnerName.textContent    = "Nobody wins!";
    syncOverlayToWheelPanel(true);
    winnerOverlay.classList.add("show");
    winnerShowing = true;
    wheelWrap.classList.add("flames-paused");
    setTimeout(() => { winnerName.style.fontSize = ""; }, 100);
  }
  requestAnimationFrame(blastSpin);
}

// ── Main spin ─────────────────────────────────────────────────
function spinWheel() {
  if (spinning || !entrants.length) return;

  stopIdleRotation();
  initAudio().then(startBg);
  document.getElementById("settingsOverlay").classList.add("hidden");

  nobodyWinsActive = false;
  winnerShowing    = false;
  wheelWrap.classList.remove("flames-paused");
  winnerOverlay.classList.remove("show");

  spinning         = true;
  wasNearEdge      = false;
  previousSliceIdx = -1;
  prevTickRotation = null;
  setEmoji("excited");

  // Spin Time slider (0-100) maps to a base-time multiplier.
  // Default 33 ≈ 1.0×; 0 ≈ 0.3×; 100 ≈ 2.4×.
  // Only base timings/rotations scale — sub-roll randomness is preserved.
  const spinTimeMultiplier = 0.3 + (settings.spinTime / 100) * 2.1;

  const spinStartRotation = currentRotation;
  const nobodyDelay  = (1000 + Math.random() * 1000) * spinTimeMultiplier;
  let   nobodyChecked = false;

  let   cwDuration    = 9800 * spinTimeMultiplier;
  const cwBase        = Math.PI * 2 * (10 + Math.random() * 6) * spinTimeMultiplier;
  const cwExtra       = Math.random() * Math.PI * 2;
  let   cwStart       = performance.now();
  let   cwStartRot    = spinStartRotation;
  let   cwTotalAngle  = cwBase + cwExtra;

  const earlyTime  = (600  + Math.random() * 1000) * spinTimeMultiplier;
  const midTime    = cwDuration * 0.38 + Math.random() * 800;
  const boostTime  = cwDuration * 0.62 + Math.random() * 600;
  const swapTime   = cwDuration * 0.75 + Math.random() * 600;
  let   earlyDone  = false, midDone = false, boostDone = false, swapDone = false;

  function cwAnimate(now) {
    const elapsed = now - cwStart;

    if (!nobodyChecked && elapsed >= nobodyDelay) {
      nobodyChecked = true;
      if (Math.random() * 100 < settings.explodeChance) {
        spinning = false;
        doNobodyWins();
        return;
      }
    }

    if (!earlyDone && elapsed >= earlyTime) {
      earlyDone = true;
      if (Math.random() * 100 < settings.slowChance) {
        const remainder   = (1800 + Math.random() * 800) * spinTimeMultiplier;
        const tNow        = elapsed / cwDuration;
        const easedNow    = 1 - Math.pow(1 - Math.pow(Math.min(tNow, 0.99), 1), 7);
        const travelSoFar = cwTotalAngle * easedNow;
        cwTotalAngle = travelSoFar + Math.PI * 2 * (1 + Math.random());
        cwStartRot   = currentRotation;
        cwStart      = now;
        cwDuration   = remainder;
        setEmoji("slowdown");
        playSound("slowdown");
        setTimeout(() => { if (spinning) setEmoji("excited"); }, 900);
      }
    }

    if (!midDone && elapsed >= midTime) {
      midDone = true;
      if (Math.random() * 100 < settings.reverseChance) {
        setEmoji("reverse");
        playSound("reverse");
        setTimeout(() => { if (spinning) setEmoji("excited"); }, 1500);
        startCCWDecel();
        return;
      }
    }

    if (!boostDone && elapsed >= boostTime) {
      boostDone = true;
      if (Math.random() * 100 < settings.speedChance) {
        cwStartRot   = currentRotation;
        cwStart      = now;
        cwDuration   = (5000 + Math.random() * 3000) * spinTimeMultiplier;
        cwTotalAngle = Math.PI * 2 * (5 + Math.random() * 5) * spinTimeMultiplier;
        setEmoji("speed");
        playSound("boost");
        setTimeout(() => { if (spinning) setEmoji("excited"); }, 1200);
      }
    }

    if (!swapDone && elapsed >= swapTime) {
      swapDone = true;
      if (Math.random() * 100 < settings.swapChance) {
        randomSwap();
        setEmoji("swap");
        playSound("shuffle");
        setTimeout(() => { if (spinning) setEmoji("excited"); }, 1200);
      }
    }

    const t     = Math.min((now - cwStart) / cwDuration, 1);
    const eased = 1 - Math.pow(1 - t, 4);
    currentRotation = cwStartRot + cwTotalAngle * eased;

    drawWheel(currentRotation);
    updatePointerTick(currentRotation);
    updateNervousEmoji(t);
    updateFlameSpeed(currentRotation, now);

    if (t < 1) { requestAnimationFrame(cwAnimate); }
    else        { finishSpin(); }
  }

  function startCCWDecel() {
    const ccwStartRot   = currentRotation;
    const ccwStart      = performance.now();
    const ccwTotalAngle = Math.PI * 2 * (4 + Math.random() * 4) * spinTimeMultiplier;
    const ccwDuration   = (7000 + Math.random() * 2000) * spinTimeMultiplier;

    const ccwBoostTime = ccwDuration * 0.25 + Math.random() * 800;
    const ccwSwapTime  = ccwDuration * 0.45 + Math.random() * 600;
    let   ccwBoostDone = false, ccwSwapDone = false;
    let   ccwStartRotCur = ccwStartRot;
    let   ccwStartTime   = ccwStart;
    let   ccwTotal       = ccwTotalAngle;
    let   ccwDur         = ccwDuration;

    function ccwAnimate(now) {
      const elapsed = now - ccwStartTime;

      if (!ccwBoostDone && elapsed >= ccwBoostTime) {
        ccwBoostDone = true;
        if (Math.random() * 100 < settings.speedChance) {
          ccwStartRotCur = currentRotation;
          ccwStartTime   = now;
          ccwDur         = (5000 + Math.random() * 2000) * spinTimeMultiplier;
          ccwTotal       = Math.PI * 2 * (4 + Math.random() * 4) * spinTimeMultiplier;
          setEmoji("speed");
          playSound("boost");
          setTimeout(() => { if (spinning) setEmoji("excited"); }, 1200);
        }
      }

      if (!ccwSwapDone && elapsed >= ccwSwapTime) {
        ccwSwapDone = true;
        if (Math.random() * 100 < settings.swapChance) {
          randomSwap();
          setEmoji("swap");
          playSound("shuffle");
          setTimeout(() => { if (spinning) setEmoji("excited"); }, 1200);
        }
      }

      const t     = Math.min((now - ccwStartTime) / ccwDur, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      currentRotation = ccwStartRotCur - ccwTotal * eased;

      drawWheel(currentRotation);
      updatePointerTick(currentRotation);
      updateNervousEmoji(t);
      updateFlameSpeed(currentRotation, now);

      if (t < 1) { requestAnimationFrame(ccwAnimate); }
      else        { finishSpin(); }
    }

    requestAnimationFrame(ccwAnimate);
  }

  function updateNervousEmoji(t) {
    const inSlowZone = t > 0.75 && t < 1.0;
    const nearEdge   = inSlowZone && pointerNearSliceEdge(currentRotation);

    if (nearEdge) {
      if (!wasNearEdge) setEmoji("nervous");
      wasNearEdge = true;
    } else if (wasNearEdge) {
      wasNearEdge = false;
      setEmoji(Math.random() < 0.5 ? "shocked" : "relieved");
      setTimeout(() => { if (spinning) setEmoji("excited"); }, 600);
    } else {
      wasNearEdge = false;
    }
  }

  function finishSpin() {
    spinning        = false;
    wasNearEdge     = false;
    currentRotation = currentRotation % (Math.PI * 2);
    drawWheel(currentRotation);

    const winner = getWinnerAtRotation(currentRotation);
    winnerTitle.textContent = "";
    winnerTitle.classList.remove("bad");
    winnerBox.classList.remove("exploded");
    winnerName.textContent    = winner.name;
    winnerName.style.color    = "";
    winnerName.style.fontSize = "";
    fitWinnerText();
    setEmoji("winner");
    syncOverlayToWheelPanel();
    winnerOverlay.classList.add("show");
    winnerShowing = true;
    wheelWrap.classList.add("flames-paused");
    fadeBgOut(800);
    playSound("fanfare");
    startConfettiBursts();
    addToHistory(winner.name);

    // ── Auto-features ─────────────────────────────────────────
    // Apply weight/presence changes while the winner overlay is visible so
    // the sidebar reflects the new state for the next spin. renderEntrants()
    // and updateStats() are defined in ui.js (safe — called at runtime).
    const winnerIdx = getSliceIndexAt(currentRotation);
    let autoChanged = false;

    if (settings.autoIncrementLosers) {
      entrants.forEach((e, i) => { if (i !== winnerIdx) { e.weight++; autoChanged = true; } });
    }
    if (settings.autoRemoveWinner) {
      entrants.splice(winnerIdx, 1);
      autoChanged = true;
    } else if (settings.autoDecrementWinner && entrants[winnerIdx]?.weight > 1) {
      entrants[winnerIdx].weight--;
      autoChanged = true;
    } else if (settings.setWinnerToOne && entrants[winnerIdx]?.weight !== 1) {
      entrants[winnerIdx].weight = 1;
      autoChanged = true;
    }

    if (autoChanged) { saveEntrants(); renderEntrants(); updateStats(); }
  }

  requestAnimationFrame(cwAnimate);
}
