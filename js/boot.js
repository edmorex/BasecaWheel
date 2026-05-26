// ── boot.js ────────────────────────────────────────────────────
// Application startup: migrate legacy data, load the active slot,
// size the canvas, pre-cache images, and watch for settings close.
//
// LOAD ORDER: must come last — after constants.js, state.js, storage.js,
//             emoji.js, audio.js, wheel.js, spin.js, ui.js.
// Reads:   WHEEL_LIST_KEY, ACTIVE_SLOT_KEY, SLOT_KEY (constants.js)
//          EMOJI_VARIANTS (emoji.js)
// Reads/mutates: wheelList (state.js)
// Calls:   newSlotId, defaultSlotData, saveWheelList, activateSlot (storage.js)
//          resizeCanvas (wheel.js)
//          reloadSounds (audio.js)
//          precacheImages (this file)
//          setEmoji (emoji.js)
//
// PITFALL — activateSlot() calls renderWheelList() and renderEntrants(),
// which are declared in ui.js. This file must load after ui.js.

// ── Wheel list init ───────────────────────────────────────────
// Reads stored wheel list and migrates any legacy numeric-key slots
// (basca_slot_1 … basca_slot_9) created before the multi-wheel system.
(function initWheelList() {
  let list = null;
  try {
    const raw = localStorage.getItem(WHEEL_LIST_KEY);
    if (raw) list = JSON.parse(raw);
  } catch {}

  if (!list || !list.length) {
    list = [];
    for (let i = 1; i <= 9; i++) {
      const raw = localStorage.getItem(`basca_slot_${i}`);
      if (!raw) continue;
      try {
        const d  = JSON.parse(raw);
        const id = `migrated_${i}`;
        localStorage.setItem(SLOT_KEY(id), raw);
        list.push({ id, title: d.title || `Wheel ${i}` });
      } catch {}
    }
    if (!list.length) {
      const id = newSlotId();
      list.push({ id, title: "Default" });
      localStorage.setItem(SLOT_KEY(id), JSON.stringify(defaultSlotData()));
    }
    localStorage.setItem(WHEEL_LIST_KEY, JSON.stringify(list));
  }

  wheelList = list;
  const savedId = localStorage.getItem(ACTIVE_SLOT_KEY);
  const valid   = wheelList.find(w => w.id === savedId);
  activateSlot(valid ? valid.id : wheelList[0].id);
})();

resizeCanvas();

// ── Image pre-caching ─────────────────────────────────────────
// Fire-and-forget: asks the browser to fetch every variant image so
// they're in cache before the wheel first spins to that state.
function precacheImages() {
  const seen = new Set();
  Object.values(EMOJI_VARIANTS).forEach(urls => {
    urls.forEach(url => {
      if (!seen.has(url)) { seen.add(url); new Image().src = url; }
    });
  });
}

precacheImages();

// ── Settings close observer ───────────────────────────────────
// Re-cache images/sounds and refresh the wheel emoji whenever the
// settings overlay is hidden (e.g. the user saves a new image/sound URL).
new MutationObserver(() => {
  if (settingsOverlay.classList.contains("hidden")) {
    precacheImages();
    if (audioCtx) reloadSounds();
    if (!spinning && !winnerShowing) setEmoji(currentEmojiState);
  }
}).observe(settingsOverlay, { attributes: true, attributeFilter: ["class"] });
