// ── constants.js ──────────────────────────────────────────────
// Pure read-only data. No DOM access, no mutable state.
//
// LOAD ORDER: must be first — every other JS file reads these values at
// top-level (e.g. `let settings = { ...SETTINGS_DEFAULTS }`), so this
// script must finish evaluating before any other script starts.

// ── localStorage keys ─────────────────────────────────────────
const ACTIVE_SLOT_KEY = "basca_active_slot";
const WHEEL_LIST_KEY  = "basca_wheel_list";
const SLOT_KEY        = s => `basca_slot_${s}`;

// ── Per-slot defaults ─────────────────────────────────────────
// customImages and customSounds are object-valued: they must be
// deep-merged (not shallow spread) when loading from localStorage.
// See loadSlotData() in storage.js.
const SETTINGS_DEFAULTS = {
  speedChance: 20, slowChance: 20, swapChance: 20,
  reverseChance: 20, explodeChance: 5, spinTime: 33,
  hidePercentages: false,
  autoIncrementLosers: false, autoDecrementWinner: false, autoRemoveWinner: false,
  customImages: {}, customSounds: {},
};

const DEFAULT_ENTRANTS = [
  { name: "Alice", weight: 1 },
  { name: "Bob",   weight: 2 },
  { name: "Charlie", weight: 4 },
];

// ── Wheel drawing ─────────────────────────────────────────────
const COLORS = [
  "#ef4444","#3b82f6","#22c55e","#f59e0b","#8b5cf6","#ec4899",
  "#14b8a6","#f97316","#06b6d4","#84cc16","#e11d48","#6366f1",
];

// ── Emoji / image states ──────────────────────────────────────
// Keys here are the canonical state names used everywhere in the app.
// Changing a key requires updating: EMOJI_VARIANTS (emoji.js),
// DEFAULT_IMAGES, IMAGE_STATE_LABELS, and every setEmoji() call site.
const EMOJI = {
  idle:"😻", excited:"🤩", nervous:"😬", shocked:"😮", relieved:"😅",
  speed:"😜", slowdown:"🫣", swap:"🌀", reverse:"🔄",
  explode:"💥", winner:"🥳", nobody:"🙀",
};

// DEFAULT_IMAGES: hard-coded fallback image list for each state.
// Edit these arrays to change what ships with the app.
// A _1 / _2 suffix convention is used so you can easily hand-edit paths.
const DEFAULT_IMAGES = {
  idle:     ["images/bb_stare.png", "images/mochi_relax.png", "images/bascaSharon.png", "images/basecaHi.png"],
  excited:  ["images/bascaPog.png"],
  nervous:  ["images/bb_upset.png", "images/mochi_concern.png"],
  shocked:  ["images/coco_wow.png", "images/basecaDark.png"],
  relieved: ["images/mochi_whatever.png", "images/basecaCoco.png"],
  speed:    ["images/bb_wink.png", "images/hellok13ProChuck.png"],
  slowdown: ["images/coco_ohno.png", "images/basecaOff.png"],
  swap:     ["images/bb_earflip.png", "images/hellok13Malcolmlaugh.png"],
  reverse:  ["images/basecaExcuseme.png", "images/basecaNou.png"],
  explode:  ["images/bb_angry.png", "images/basecaFail.png"],
  winner:   ["images/coco_happy.png", "images/bb_rainbow.png", "images/basecaApprove.png"],
  nobody:   ["images/mochi_sadeyes.png", "images/mochi_ohno.png", "images/basecaDed.png", "images/basecaWeslyCrusherMemorial.png"],
};

// Labels shown in the settings UI for each image state.
const IMAGE_STATE_LABELS = {
  idle:"😻 Idle", excited:"🤩 Excited", nervous:"😬 Nervous",
  shocked:"😮 Shocked", relieved:"😅 Relieved", speed:"😜 Speed Boost",
  slowdown:"🫣 Slowdown", swap:"🌀 Late Shuffle", reverse:"🔄 Reverse Spin",
  explode:"💥 Explode", winner:"🥳 Winner", nobody:"🙀 Nobody Wins",
};

// ── Sound system ──────────────────────────────────────────────
// DEFAULT_SOUNDS: edit these paths to change what ships with the app.
const DEFAULT_SOUNDS = {
  bg:       "sounds/bg.wav",
  tick:     "sounds/tick.wav",
  boost:    "sounds/boost.wav",
  explode:  "sounds/explode.wav",
  fanfare:  "sounds/fanfare.wav",
  reverse:  "sounds/reverse.wav",
  shuffle:  "sounds/shuffle.wav",
  slowdown: "sounds/slowdown.wav",
};

// Labels shown in the settings UI for each sound key.
const SOUND_LABELS = {
  bg:       "🎵 Background",
  tick:     "🎯 Tick",
  boost:    "😜 Speed Boost",
  explode:  "💥 Explode",
  fanfare:  "🥳 Winner",
  reverse:  "🔄 Reverse",
  shuffle:  "🌀 Late Shuffle",
  slowdown: "🫣 Slowdown",
};

// Per-sound volume multipliers applied via the Web Audio gain node.
// Keys not listed here default to 0.8 in playSound().
const BG_VOL    = 0.3;
const SOUND_VOLS = {
  explode: 0.9, reverse: 0.8, slowdown: 0.8,
  boost: 0.8, shuffle: 0.8, fanfare: 0.85,
};

// ── Wheel title sizing ────────────────────────────────────────
const WHEEL_TITLE_MIN_FONT = 14;
const WHEEL_TITLE_MAX_FONT = 72;

// ── Idle rotation ─────────────────────────────────────────────
const IDLE_RPS = 1 / 45; // one full rotation every 45 seconds

// ── Confetti / explosion ──────────────────────────────────────
// Cubic bezier segments of the heart clip-path (objectBoundingBox, 0-1).
// Mirrors the SVG path in #heart-clip exactly so confetti spawns on the outline.
const HEART_SEGS = [
  [[0.50,0.25],[0.50,0.18],[0.43,0.11],[0.33,0.11]],
  [[0.33,0.11],[0.16,0.11],[0.05,0.26],[0.05,0.43]],
  [[0.05,0.43],[0.05,0.68],[0.50,0.93],[0.50,0.93]],
  [[0.50,0.93],[0.50,0.93],[0.95,0.68],[0.95,0.43]],
  [[0.95,0.43],[0.95,0.26],[0.84,0.11],[0.67,0.11]],
  [[0.67,0.11],[0.57,0.11],[0.50,0.18],[0.50,0.25]],
];
const HEART_CX = 0.50, HEART_CY = 0.52; // approximate visual centre
