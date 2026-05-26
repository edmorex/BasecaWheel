// ── state.js ───────────────────────────────────────────────────
// DOM element references and all shared mutable state.
//
// LOAD ORDER: must come after constants.js (references SETTINGS_DEFAULTS).
//
// GLOBAL SCOPE WARNING: Every variable declared here is a plain global.
// There are no access controls — any later script can read or mutate any
// of these directly. Keep mutations close to the owning subsystem to
// avoid hard-to-trace bugs.
//
// WHY ONE FILE: element refs and mutable state are separated from constants
// only to make constants.js a clean, dependency-free data file. If the app
// grows significantly, consider splitting into audio-state.js, spin-state.js,
// etc., each living next to their owning module.

// ── DOM element references ────────────────────────────────────
const canvas         = document.getElementById("wheel");
const ctx            = canvas.getContext("2d");
const entrantListEl  = document.getElementById("entrantList");
const statsDiv       = document.getElementById("stats");
const pointer        = document.getElementById("pointer");
const winnerOverlay  = document.getElementById("winnerOverlay");
const winnerBox      = document.getElementById("winnerBox");
const winnerTitle    = document.getElementById("winnerTitle");
const winnerName     = document.getElementById("winnerName");
const wheelWrap      = document.querySelector(".wheel-wrap");
const wheelEmoji     = document.getElementById("wheelEmoji");
const wheelTitleText = document.getElementById("wheelTitleText");
const wheelListEl    = document.getElementById("wheelListEl");
const wheelTopFade   = document.getElementById("wheelTopFade");
const wheelBottomFade = document.getElementById("wheelBottomFade");
const topFade        = document.getElementById("topFade");
const bottomFade     = document.getElementById("bottomFade");
const sidebarWrapper = document.getElementById("sidebarWrapper");
const panelToggle    = document.getElementById("panelToggle");
const historyBtn     = document.getElementById("historyBtn");
const historyList    = document.getElementById("historyList");
const muteBtn        = document.getElementById("muteBtn");
const rawDataOverlay   = document.getElementById("rawDataOverlay");
const rawDataText      = document.getElementById("rawDataText");
const rawDataError     = document.getElementById("rawDataError");
const rawDataFileInput = document.getElementById("rawDataFileInput");

// The winner overlay is reparented to <body> here. The wheel panel has
// backdrop-filter (via .panel), which creates a stacking context and acts
// as the containing block for fixed descendants, trapping the overlay's
// z-index inside the panel. Lifting it to body lets its z-index 100 sit
// in the root stacking context, above confetti (z-index 25), below modals
// (200). JS pins it over the wheel panel — see syncOverlayToWheelPanel().
document.body.appendChild(winnerOverlay);

// ── Wheel list state ──────────────────────────────────────────
// Mutated by: storage.js (addWheel, deleteWheel), ui.js (importAllData)
let wheelList = []; // [{ id, title }, ...]

// ── Per-slot state ────────────────────────────────────────────
// Mutated by: storage.js (activateSlot), ui.js (entrant controls)
let activeSlot = "";
let entrants   = [];
let settings   = { ...SETTINGS_DEFAULTS };
let slotTitle  = "";

// ── Spin state ────────────────────────────────────────────────
// Mutated exclusively by: spin.js, wheel.js
let currentRotation  = 0;
let spinning         = false;
let previousSliceIdx = -1;
let prevTickRotation = null;
let wasNearEdge      = false;
let wheelRadius      = 0;
let wheelCX          = 0;
let wheelCY          = 0;
let nobodyWinsActive = false;
let winnerShowing    = false;
let idleRafId        = null;
let idleLastTime     = 0;

// ── Flame animation state ─────────────────────────────────────
// Mutated exclusively by: wheel.js (updateFlameSpeed)
let flameLastRot       = null;
let flameLastTime      = null;
let flameOmegaSmoothed = 0;
let flameCssLastUpdate = 0;

// ── Audio state ───────────────────────────────────────────────
// Mutated exclusively by: audio.js
// Declared here so other files (spin.js, ui.js) can read muted/audioCtx
// without depending on audio.js evaluation order.
let muted             = false;
let audioCtx          = null;
let bgNode            = null;
let bgFallbackAudio   = null;
let bgFadeId          = null;
let tickGain          = null;
const audioBufs       = {};
// URLs that couldn't be fetched (cross-origin without CORS headers) — played
// via HTMLAudioElement as a fallback, which doesn't need CORS for playback.
const audioFallbacks  = {};
let audioPreloadPromise = null;
let audioWarmedUp       = false;

// ── Effects state ─────────────────────────────────────────────
// Mutated exclusively by: spin.js
let confettiBurstId = null;

// ── Sidebar state ─────────────────────────────────────────────
// Mutated exclusively by: ui.js (sidebar toggle handler)
let sidebarVisible = true;

// ── Winner history state ──────────────────────────────────────
// Session-only — deliberately not persisted, wiped on page reload.
const winnerHistory = [];
