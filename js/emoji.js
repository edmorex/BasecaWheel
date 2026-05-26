// ── emoji.js ───────────────────────────────────────────────────
// Wheel-emoji / custom-image subsystem.
//
// LOAD ORDER: must come after constants.js and state.js.
// Reads:   EMOJI, DEFAULT_IMAGES (constants.js)
// Reads/mutates: settings (state.js)
// Exports (as globals): EMOJI_VARIANTS, currentEmojiState,
//   rebuildEmojiVariantsFromSettings, initCustomImagesFromProbed, setEmoji
//
// DEPENDENCY NOTE: setEmoji() reads wheelEmoji (state.js DOM ref).
// It may be called from spin.js, ui.js, and boot.js.

// Active URL list per state. Populated by rebuildEmojiVariantsFromSettings();
// spin.js and setEmoji() read it to pick a random image each time.
const EMOJI_VARIANTS  = {};
let   currentEmojiState = "idle";

// Rebuild EMOJI_VARIANTS from settings.customImages.
// Called whenever settings are loaded (activateSlot) or images are changed.
// Falls back to `images/<state>.png` for any state with an empty list —
// NOT DEFAULT_IMAGES, because an empty list means the user explicitly
// cleared it. DEFAULT_IMAGES is only used for newly-seeded slots.
function rebuildEmojiVariantsFromSettings() {
  Object.keys(EMOJI).forEach(state => {
    const list = settings.customImages?.[state];
    EMOJI_VARIANTS[state] = (Array.isArray(list) && list.length > 0)
      ? [...list]
      : [`images/${state}.png`];
  });
}

// Seed settings.customImages with DEFAULT_IMAGES for any state not yet
// configured. This runs when a slot is first activated so users see the
// default images in the settings UI rather than an empty list.
// Does NOT overwrite states the user has already configured (even if empty).
function initCustomImagesFromProbed() {
  if (!settings.customImages) settings.customImages = {};
  let changed = false;
  Object.keys(EMOJI).forEach(state => {
    if (DEFAULT_IMAGES[state]?.length > 0 && !Array.isArray(settings.customImages[state])) {
      settings.customImages[state] = [...DEFAULT_IMAGES[state]];
      changed = true;
    }
  });
  return changed;
}

// requestAnimationFrame ensures setEmoji runs at the start of a render
// frame, AFTER resizeCanvas() has set wheelEmoji's position and font-size,
// so translate(-50%,-50%) resolves against the correct element dimensions.
requestAnimationFrame(() => {
  if (!spinning && !winnerShowing) setEmoji(currentEmojiState);
});

function setEmoji(state) {
  currentEmojiState = state;
  const fallback = EMOJI[state] || "🙂";
  const variants  = EMOJI_VARIANTS[state];

  wheelEmoji.textContent = "";

  if (!variants || variants.length === 0) {
    wheelEmoji.textContent = fallback;
  } else {
    const url = variants[Math.floor(Math.random() * variants.length)];
    const img = document.createElement("img");
    img.alt       = fallback;
    img.draggable = false;
    img.onerror   = () => {
      // Guard against stale onerror firing after a setEmoji() that already
      // replaced this img element. Only act if img is still in the DOM.
      if (img.parentNode !== wheelEmoji) return;
      const idx = EMOJI_VARIANTS[state]?.indexOf(url) ?? -1;
      if (idx !== -1) EMOJI_VARIANTS[state].splice(idx, 1);
      if (EMOJI_VARIANTS[state]?.length > 0) setEmoji(state);
      else wheelEmoji.textContent = fallback;
    };
    img.src = url;
    wheelEmoji.appendChild(img);
  }

  wheelEmoji.classList.remove("excited", "nervous", "shocked", "mischief");
  if (state === "excited")  wheelEmoji.classList.add("excited");
  if (state === "nervous")  wheelEmoji.classList.add("nervous");
  if (state === "shocked" || state === "relieved") wheelEmoji.classList.add("shocked");
  if (["speed","slowdown","swap","reverse","explode"].includes(state))
    wheelEmoji.classList.add("mischief");
}
