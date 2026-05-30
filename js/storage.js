// ── storage.js ─────────────────────────────────────────────────
// localStorage read/write helpers. No DOM access, no UI side effects.
//
// LOAD ORDER: must come after constants.js and state.js.
// Reads: ACTIVE_SLOT_KEY, WHEEL_LIST_KEY, SLOT_KEY, SETTINGS_DEFAULTS,
//        DEFAULT_ENTRANTS (constants.js)
// Mutates: wheelList, activeSlot, entrants, settings, slotTitle,
//          winnerHistory (state.js)
//          — but only inside activateSlot(), which is called from ui.js/boot.js.

function newSlotId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// Wraps localStorage.setItem so a QuotaExceededError can't throw uncaught and
// break the app. Safari Private Browsing historically gives localStorage a
// near-zero quota and throws on any write; a full disk or full quota does too.
// Returns true on success, false on failure. All persistence in the app goes
// through this — never call localStorage.setItem directly.
function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn("localStorage write failed for", key, "—", e && e.message);
    return false;
  }
}

function saveWheelList() {
  safeSetItem(WHEEL_LIST_KEY, JSON.stringify(wheelList));
}

function defaultSlotData() {
  return {
    title:    "",
    entrants: JSON.parse(JSON.stringify(DEFAULT_ENTRANTS)),
    settings: { ...SETTINGS_DEFAULTS },
    history:  [],
  };
}

function loadSlotData(slot) {
  try {
    const raw = localStorage.getItem(SLOT_KEY(slot));
    if (!raw) return defaultSlotData();
    const d = JSON.parse(raw);
    return {
      title:    d.title ?? "",
      entrants: Array.isArray(d.entrants) && d.entrants.length
        ? d.entrants
        : JSON.parse(JSON.stringify(DEFAULT_ENTRANTS)),
      // customImages and customSounds are objects — they must be spread
      // separately so a shallow { ...SETTINGS_DEFAULTS, ...d.settings }
      // doesn't overwrite the entire sub-object with a stale reference.
      settings: {
        ...SETTINGS_DEFAULTS,
        ...(d.settings ?? {}),
        customImages: { ...(d.settings?.customImages ?? {}) },
        customSounds: { ...(d.settings?.customSounds ?? {}) },
      },
      history: Array.isArray(d.history) ? d.history : [],
    };
  } catch { return defaultSlotData(); }
}

function saveCurrentSlot() {
  if (!activeSlot) return;
  safeSetItem(SLOT_KEY(activeSlot), JSON.stringify({
    title:    slotTitle,
    entrants: entrants,
    settings: settings,
    // Only persist history when the feature is enabled; otherwise save an
    // empty array so toggling the flag off clears it on next load.
    history:  settings.keepWinnersLog ? winnerHistory : [],
  }));
}

// Thin alias kept for call sites inside renderEntrants() that want to
// signal "this save is for entrant data" without coupling to saveCurrentSlot.
function saveEntrants() { saveCurrentSlot(); }

// ── Load a slot into live state ───────────────────────────────
// Calls several functions defined in later files (emoji.js, audio.js,
// wheel.js, ui.js). This is safe because activateSlot() is never invoked
// until after all scripts have been evaluated (it's first called from
// boot.js). Function declarations are hoisted within their script, but
// the call itself only runs after the full page script load is complete.
function activateSlot(slotId) {
  activeSlot = slotId;
  safeSetItem(ACTIVE_SLOT_KEY, slotId);

  const data = loadSlotData(slotId);
  slotTitle     = data.title;
  entrants      = data.entrants;
  settings      = data.settings;
  winnerHistory = data.history; // per-slot; [] when keepWinnersLog is off

  // emoji.js — seeds customImages defaults and rebuilds EMOJI_VARIANTS
  initCustomImagesFromProbed();
  rebuildEmojiVariantsFromSettings();

  // audio.js — reloads sound buffers with the slot's customSounds
  if (typeof reloadSounds === "function" && audioCtx) reloadSounds();

  // ui.js / wheel.js — UI refresh
  updateWheelTitle();
  applySettingsToInputs();
  renderEntrants();
  updateStats();
  resetWheelState();
  renderWheelList();
  renderHistory(); // refresh history panel with the newly loaded slot's log
}
